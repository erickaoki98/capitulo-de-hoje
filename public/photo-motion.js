import { photoShots } from './photo-motion-policy.js';

function syncPhoto(state,doc,view,media) {
    if(state.timer){view.clearInterval(state.timer);state.timer=null;}
    state.layers?.forEach(layer=>{layer.style.transition=media.matches?'none':'opacity 180ms ease';});
    if(!state.layers||!state.visible||doc.hidden||media.matches||state.paused||state.failed)return;
    state.timer=view.setInterval(()=>{
      state.layers[state.index].style.opacity='0';state.index=(state.index+1)%state.layers.length;state.layers[state.index].style.opacity='1';
    },4000);
}

function layoutPhoto(state) {
    if(!state.layers||!state.frame||state.failed)return;
    const size=state.frame.getBoundingClientRect().width;if(!size)return;
    state.layers.forEach((layer,i)=>{const shot=state.shots[i],scale=size/shot.width;Object.assign(layer.style,{width:`${state.width*scale}px`,height:`${state.height*scale}px`,left:`${-shot.x*scale}px`,top:`${-shot.y*scale}px`});});
}

/** Admin-only demonstration; never enrolls, detects faces, or changes analytics. */
export function startPhotoPreview(container,button) {
  if(!container||!button)return ()=>{};
  const doc=container.ownerDocument,view=doc.defaultView,media=view.matchMedia('(prefers-reduced-motion: reduce)');
  const layers=[...container.querySelectorAll('img')].slice(0,2);
  if(layers.length!==2)return ()=>{};
  const shots=photoShots({src:'/img/9e5335709590212c.jpg',width:1080,height:1080});
  const state={frame:container,layers,shots,width:1080,height:1080,index:0,paused:false,visible:false,failed:false};
  const sync=()=>syncPhoto(state,doc,view,media);
  container.classList.add('cdh-photo-motion');
  layers.forEach((layer,i)=>{layer.classList.add('cdh-photo-layer');layer.setAttribute('aria-hidden','true');layer.style.opacity=i===0?'1':'0';layer.addEventListener('error',()=>{state.failed=true;sync();});});
  button.setAttribute('aria-pressed','false');
  button.addEventListener('click',()=>{state.paused=!state.paused;button.setAttribute('aria-pressed',String(state.paused));button.textContent=state.paused?'Retomar prévia':'Pausar prévia';sync();});
  const observer=view.IntersectionObserver?new view.IntersectionObserver(entries=>{state.visible=entries[0]?.isIntersecting===true;sync();}):null;
  observer?.observe(container);
  const resize=view.ResizeObserver?new view.ResizeObserver(()=>layoutPhoto(state)):null;resize?.observe(container);
  doc.addEventListener('visibilitychange',sync);media.addEventListener('change',sync);if(!resize)view.addEventListener('resize',()=>layoutPhoto(state));
  layoutPhoto(state);if(!observer){state.visible=true;sync();}
  return ()=>{state.failed=true;sync();observer?.disconnect?.();resize?.disconnect?.();};
}

export function enhanceArticlePhotos({doc=document,view=window}={}) {
  const media=view.matchMedia('(prefers-reduced-motion: reduce)');
  if(view.cdhPhotoVariant!=='motion'||media.matches||!view.IntersectionObserver)return;
  let maps={};
  try { const text=doc.getElementById('cdh-photo-maps')?.textContent||'{}';if(text.length<=65536){const parsed=JSON.parse(text);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))maps=parsed;} } catch {}
  const approvedMap=image=>{
    try{const url=new URL(image.currentSrc||image.src,view.location.origin);const map=maps[url.pathname];return url.origin===view.location.origin&&/^\/img\/[^/]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)&&map&&Number.isFinite(map.reviewedAt)&&map.reviewedAt>0&&photoShots({width:1080,height:1080,shots:map.shots}).length>=2?map:null;}catch{return null;}
  };
  const states=[];let queue=Promise.resolve();
  const sync=state=>syncPhoto(state,doc,view,media);
  const restore=state=>{
    if(state.failed)return;
    state.failed=true;sync(state);state.image.dataset.photoStatus='static';
    if(state.frame){state.frame.parentNode.insertBefore(state.image,state.frame);state.frame.remove();state.image.classList.remove('cdh-photo-original');state.frame=null;}
  };
  const layout=layoutPhoto;
  const resize=view.ResizeObserver?new view.ResizeObserver(entries=>entries.forEach(entry=>{const state=states.find(s=>s.frame===entry.target);if(state)layout(state);})):null;
  const process=async state=>{
    const {image}=state;
    // Ignore nonsquare photos rather than changing the A/B layout or guessing a crop.
    if(!image.complete||!image.naturalWidth||image.naturalWidth!==image.naturalHeight){image.dataset.photoStatus='static';return;}
    let url;try{url=new URL(image.currentSrc||image.src,view.location.origin);if(url.origin!==view.location.origin||!/^\/img\/[^/]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)){image.dataset.photoStatus='static';return;}}catch{image.dataset.photoStatus='static';return;}
    const src=url.href;
    try{
      const data={src,width:image.naturalWidth,height:image.naturalHeight,shots:state.map.shots};
      const shots=photoShots(data);
      if(shots.length<2||state.failed){image.dataset.photoStatus='static';return;}
      const frame=doc.createElement('span');frame.className='cdh-photo-motion';image.parentNode.insertBefore(frame,image);frame.append(image);image.classList.add('cdh-photo-original');
      Object.assign(state,{frame,shots,width:data.width,height:data.height,index:0,layers:[]});
      shots.forEach((shot,i)=>{const layer=doc.createElement('img');layer.className='cdh-photo-layer';layer.src=src;layer.alt='';layer.setAttribute('aria-hidden','true');layer.style.opacity=i===0?'1':'0';layer.addEventListener('error',()=>restore(state),{once:true});frame.append(layer);state.layers.push(layer);});
      const button=doc.createElement('button');button.type='button';button.className='cdh-photo-pause';button.textContent='Pausar fotos';button.setAttribute('aria-label','Pausar alternância de enquadramentos da foto');button.setAttribute('aria-pressed','false');
      button.addEventListener('click',()=>{state.paused=!state.paused;button.textContent=state.paused?'Retomar fotos':'Pausar fotos';button.setAttribute('aria-label',state.paused?'Retomar alternância de enquadramentos da foto':'Pausar alternância de enquadramentos da foto');button.setAttribute('aria-pressed',String(state.paused));sync(state);});frame.append(button);
      image.dataset.photoStatus='ready';layout(state);resize?.observe(frame);sync(state);
    }catch{restore(state);}
  };
  const near=new view.IntersectionObserver(entries=>entries.forEach(entry=>{
    const state=states.find(s=>s.image===entry.target);if(!entry.isIntersecting||!state||state.requested||media.matches||doc.hidden)return;
    state.requested=true;near.unobserve(state.image);state.image.dataset.photoStatus='loading';queue=queue.then(()=>process(state)).catch(()=>restore(state));
  }),{rootMargin:'240px 0px'});
  const visible=new view.IntersectionObserver(entries=>entries.forEach(entry=>{const state=states.find(s=>s.image===entry.target);if(state){state.visible=entry.isIntersecting;sync(state);}}),{threshold:0});
  [...doc.querySelectorAll('.post .prose img')].filter(image=>!image.closest('a,[data-related-card],.section-rec,.ad-slot,.ad-inarticle,.cdh-mix,.cdh-spot,.shopee-inline,.shopee-card,[data-product-id]')&&approvedMap(image)).slice(0,8).forEach(image=>{
    if(image.dataset.photoStatus)return;
    const state={image,map:approvedMap(image),visible:false,paused:false,requested:false,failed:false};states.push(state);image.dataset.photoStatus='pending';
    image.addEventListener('error',()=>restore(state),{once:true});
    const observe=()=>{near.observe(image);visible.observe(image);};if(image.complete)observe();else image.addEventListener('load',observe,{once:true});
  });
  doc.addEventListener('visibilitychange',()=>states.forEach(sync));media.addEventListener('change',()=>states.forEach(sync));if(!resize)view.addEventListener('resize',()=>states.forEach(layout));
}

if(typeof document!=='undefined'&&typeof window!=='undefined')enhanceArticlePhotos();
