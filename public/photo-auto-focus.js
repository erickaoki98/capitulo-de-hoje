const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
/** Production candidate v1: one geometry policy for every source, with no editorial presets. */
export function selectPhotoFocus({width,height,faces=[]}) {
  if(![width,height].every(Number.isFinite)||width<=0||height<=0||Math.abs(width/height-1)>.02||!Array.isArray(faces))return [];
  const visible=faces.filter(f=>{
    const b=f?.box;
    return b&&[f.score,b.x,b.y,b.width,b.height].every(Number.isFinite)&&f.score>=.8&&b.x>=0&&b.y>=0&&b.width>=32&&b.height>=40&&b.x+b.width<=width&&b.y+b.height<=height;
  });
  const candidates=visible.filter(f=>f.box.width*f.box.height>=width*height*.006&&Array.isArray(f.landmarks)&&f.landmarks.length===68&&f.landmarks.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<=width&&p.y<=height)).sort((a,b)=>b.box.width*b.box.height-a.box.width*a.box.height);
  if(!candidates.length)return [];
  const largest=candidates[0].box.width*candidates[0].box.height;
  const selected=candidates.filter(f=>f.box.width*f.box.height>=largest*.45).slice(0,3);
  return selected.flatMap(face=>{
    const b=face.box;
    for(const margin of [1.7,1.5,1.3]){
      const size=Math.max(b.width,b.height)*margin;
      if(size>Math.min(width,height)*.6)continue;
      const crop={x:clamp(b.x+b.width/2-size/2,0,width-size),y:clamp(b.y+b.height*.45-size/2,0,height-size),width:size,height:size};
      if(crop.x>b.x||crop.y>b.y||crop.x+size<b.x+b.width||crop.y+size<b.y+b.height)continue;
      if(visible.some(other=>other!==face&&overlap(crop,other.box)))continue;
      return [{...crop,kind:'face',score:face.score,box:{...b}}];
    }
    return [];
  }).sort((a,b)=>a.x-b.x);
}

const cache=new Map();let queue=Promise.resolve();
/** Same local detector already shipped by the blog; bounded and sequential, no paid/external service. */
export function analyzePhotoFocus(src) {
  const url=new URL(src,window.location.origin);
  if(url.origin!==window.location.origin||!/^\/img\/[a-zA-Z0-9_-]{1,120}\.(?:jpg|jpeg|png|webp)$/.test(url.pathname))return Promise.reject(Error('Imagem local inválida'));
  if(cache.has(url.href))return cache.get(url.href);
  if(cache.size>=8)return Promise.reject(Error('Limite de oito imagens por página'));
  const promise=queue.then(async()=>{
    const {detectImage}=await import('./related-faces.js');
    const start=performance.now(),data=await detectImage(url.href);
    return {...data,points:selectPhotoFocus(data),durationMs:Math.round(performance.now()-start),policy:'browser-face-v1'};
  });
  queue=promise.catch(()=>{});cache.set(url.href,promise);return promise;
}
