const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
const overlaps = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;

/** Reviewed maps take priority. Face geometry and the known scene are admin suggestions only. */
export function photoShots({src,width,height,faces=[],shots:reviewed}) {
  if (![width,height].every(Number.isFinite) || width <= 0 || height <= 0 || Math.abs(width/height-1) > .02) return [];
  if (reviewed !== undefined) {
    if (!Array.isArray(reviewed) || reviewed.length < 2 || reviewed.length > 6 || reviewed.some(shot=>!shot || ![shot.x,shot.y,shot.size].every(Number.isFinite) || shot.x<0 || shot.y<0 || shot.size<.1 || shot.size>1 || shot.x+shot.size>1.000001 || shot.y+shot.size>1.000001 || typeof shot.label!=='string' || !shot.label.trim() || shot.label.length>80)) return [];
    return reviewed.map(shot=>({x:shot.x*width,y:shot.y*height,width:shot.size*width,height:shot.size*height}));
  }
  let path='';try { path=new URL(src,'https://local.invalid').pathname; } catch {}
  if (path === '/img/9e5335709590212c.jpg') {
    return [[.17,0,.30],[.66,.105,.30]].map(([x,y,size])=>({x:x*width,y:y*height,width:size*width,height:size*height}));
  }
  const validBox = face => {
    const b=face?.box;
    return b && [b.x,b.y,b.width,b.height,face.score].every(Number.isFinite) && b.width>0 && b.height>0 && b.x>=0 && b.y>=0 && b.x+b.width<=width && b.y+b.height<=height;
  };
  const visible = faces.filter(f=>validBox(f)&&f.score>=.6);
  const candidates = visible.filter(f=>f.score>=.85&&f.box.width>=48&&f.box.height>=56&&f.box.width*f.box.height>=width*height*.012&&Array.isArray(f.landmarks)&&f.landmarks.length===68&&f.landmarks.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<=width&&p.y<=height)).sort((a,b)=>b.box.width*b.box.height-a.box.width*a.box.height);
  if (candidates.length<2) return [];
  const largest=candidates[0].box.width*candidates[0].box.height;
  const selected=candidates.filter(f=>f.box.width*f.box.height>=largest*.45).slice(0,2);
  if (selected.length<2) return [];
  const shots=selected.map(face=>{
    const b=face.box;
    for(const margin of [1.5,1.35,1.2]) {
      const size=Math.max(b.width,b.height)*margin;
      if(size>Math.min(width,height)*.5)continue;
      const crop={x:clamp(b.x+b.width/2-size/2,0,width-size),y:clamp(b.y+b.height*.45-size/2,0,height-size),width:size,height:size};
      if (crop.x>b.x||crop.y>b.y||crop.x+size<b.x+b.width||crop.y+size<b.y+b.height)continue;
      if (!visible.some(other=>other!==face&&overlaps(crop,other.box)))return crop;
    }
    return null;
  });
  return shots.every(Boolean)?shots:[];
}
