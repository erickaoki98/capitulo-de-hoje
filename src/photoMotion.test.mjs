import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/photo-motion-policy.js',import.meta.url),'utf8').catch(()=>'');
const policy=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const face=(x,y,w,h,score=.96)=>({score,box:{x,y,width:w,height:h},landmarks:Array.from({length:68},()=>({x:x+w/2,y:y+h/2}))});
const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
test('approved scene uses only two tight foreground portraits, excluding background face',()=>{
  assert.equal(typeof policy.photoShots,'function');
  const shots=policy.photoShots({src:'/img/9e5335709590212c.jpg',width:1080,height:1080,faces:[]});
  assert.equal(shots.length,2);for(const s of shots){assert.equal(s.width,s.height);assert.ok(s.width<=350);assert.equal(overlap(s,{x:585,y:195,width:110,height:150}),false);}
  assert.ok(shots[0].x<400&&shots[1].x>700);
});
test('general photos pick two largest salient faces and never include a background face in a crop',()=>{
  assert.equal(typeof policy.photoShots,'function');
  const faces=[face(100,100,130,160),face(700,110,140,170),face(480,170,50,65)];
  const shots=policy.photoShots({src:'/img/other.jpg',width:1080,height:1080,faces});
  assert.equal(shots.length,2);for(const shot of shots){assert.ok(shot.width<280);assert.equal(shot.width,shot.height);assert.equal(overlap(shot,faces[2].box),false);}
});
test('insufficient, uncertain, overlapping or invalid evidence keeps the photo static',()=>{
  assert.equal(typeof policy.photoShots,'function');
  const data={src:'/img/other.jpg',width:1080,height:1080};
  for(const faces of [[],[face(100,100,140,170)],[face(100,100,140,170,.6),face(700,110,140,170)],[face(100,100,140,170),face(180,120,140,170)],[face(NaN,100,140,170),face(700,110,140,170)]])assert.deepEqual(policy.photoShots({...data,faces}),[]);
});
const runtimeSource=await readFile(new URL('../public/photo-motion.js',import.meta.url),'utf8').catch(()=>'');
const runtime=await import(`data:text/javascript;base64,${Buffer.from(runtimeSource.replace("'./photo-motion-policy.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`))).toString('base64')}`);
function harness(count=1) {
  class Element {
    constructor(){this.dataset={};this.style={};this.children=[];this.attrs={};this.listeners={};this.animations=[];this.classList={add(){},remove(){}};}
    setAttribute(k,v){this.attrs[k]=v;}
    append(...children){for(const child of children){child.remove();child.parentNode=this;this.children.push(child);}}
    insertBefore(child,before){child.remove();child.parentNode=this;this.children.splice(this.children.indexOf(before),0,child);}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}
    animate(frames,options){const animation={frames,options,cancelled:false,cancel(){this.cancelled=true;}};this.animations.push(animation);return animation;}
    addEventListener(k,fn){(this.listeners[k]||=[]).push(fn);}
    fire(k){for(const fn of this.listeners[k]||[])fn();}
    cloneNode(){return new Element();}
    closest(){return null;}
    getBoundingClientRect(){return {width:320,height:320};}
  }
  const images=Array.from({length:count},(_,i)=>{const image=new Element(),parent=new Element();parent.append(image);image.src=`https://example.com/img/${i}.jpg`;image.currentSrc=image.src;image.complete=true;image.naturalWidth=1080;image.naturalHeight=1080;return image;});
  const observers=[],intervals=new Set(),delays=[],events=[],media={matches:false,addEventListener(k,fn){this.change=fn;}};
  const view={gtag:(...args)=>events.push(args),location:{origin:'https://example.com'},cdhPhotoVariant:'motion',matchMedia:()=>media,IntersectionObserver:class{constructor(fn,options){this.fn=fn;this.options=options;observers.push(this);}observe(){}unobserve(){}},ResizeObserver:class{observe(){}},setInterval(fn,delay){intervals.add(fn);delays.push(delay);return fn;},clearInterval(fn){intervals.delete(fn);},addEventListener(k,fn){this[k]=fn;}};
  const doc={hidden:false,getElementById(){return {textContent:this.mapText??JSON.stringify(Object.fromEntries(images.map(image=>[new URL(image.src).pathname,{reviewedAt:100,shots:[{x:.1,y:.1,size:.25,label:'Reação'},{x:.65,y:.1,size:.25,label:'Ação'}]}])))};},querySelectorAll(selector){assert.equal(selector,'.post .prose img');return images;},createElement:tag=>Object.assign(new Element(),{tagName:tag.toUpperCase()}),addEventListener(k,fn){this[k]=fn;}};
  return {doc,view,images,observers,intervals,media,delays,events};
}
const settle=async()=>{for(let i=0;i<30;i++)await new Promise(resolve=>setImmediate(resolve));};
const evidence={width:1080,height:1080,faces:[face(100,100,130,160),face(700,110,140,170)]};
test('approved maps lazily enhance every editorial photo without inference',async()=>{
  const h=harness(10);let calls=0;
  runtime.enhanceArticlePhotos({...h,detect:async()=>{calls++;return evidence;}});
  assert.equal(h.images.filter(i=>i.dataset.photoStatus==='ready').length,0);
  h.observers[0].fn(h.images.map(target=>({target,isIntersecting:true})));await settle();
  assert.equal(calls,0);assert.equal(h.images.filter(i=>i.dataset.photoStatus==='ready').length,10);
});
test('unmapped photos including known scene stay static and never trigger face inference',async()=>{
  const h=harness();h.doc.mapText='{}';h.images[0].src=h.images[0].currentSrc='https://example.com/img/9e5335709590212c.jpg';let calls=0;
  runtime.enhanceArticlePhotos({...h,detect:async()=>{calls++;return evidence;}});h.observers[0]?.fn([{target:h.images[0],isIntersecting:true}]);await settle();assert.equal(calls,0);assert.equal(h.images[0].parentNode.children.length,1);
});
test('reviewed normalized shots support meaningful action objects and reject unapproved geometry',()=>{
  const data={src:'/img/other.jpg',width:1080,height:1080,shots:[{x:.1,y:.2,size:.25,label:'Carta revelada'},{x:.6,y:.1,size:.3,label:'Reação da personagem'}]};
  assert.deepEqual(policy.photoShots(data),[{x:108,y:216,width:270,height:270},{x:648,y:108,width:324,height:324}]);
  assert.deepEqual(policy.photoShots({...data,shots:[{x:.9,y:.9,size:.3,label:'Fora da foto'},data.shots[1]]}),[]);
  assert.deepEqual(policy.photoShots({...data,shots:[{...data.shots[0],label:''},data.shots[1]]}),[]);
});
test('public playback has no pause control and only suspends automatically for visibility or failure',async()=>{
  assert.equal(typeof runtime.enhanceArticlePhotos,'function');
  const h=harness();runtime.enhanceArticlePhotos({...h,detect:async()=>evidence});h.observers[0].fn([{target:h.images[0],isIntersecting:true}]);await settle();
  h.observers[1].fn([{target:h.images[0],isIntersecting:true}]);assert.equal(h.intervals.size,1);
  const frame=h.images[0].parentNode;assert.equal(frame.children.some(child=>child.tagName==='BUTTON'),false);frame.fire('click');assert.equal(h.intervals.size,1);
  h.doc.hidden=true;h.doc.visibilitychange();assert.equal(h.intervals.size,0);h.doc.hidden=false;h.doc.visibilitychange();assert.equal(h.intervals.size,1);
  h.observers[1].fn([{target:h.images[0],isIntersecting:false}]);assert.equal(h.intervals.size,0);h.observers[1].fn([{target:h.images[0],isIntersecting:true}]);assert.equal(h.intervals.size,1);
  frame.children[1].children[0].fire('error');assert.equal(h.intervals.size,0);assert.equal(h.images[0].dataset.photoStatus,'static');
});
test('static cohort, reduced-motion preference and nonsquare photos remain unchanged',async()=>{
  assert.equal(typeof runtime.enhanceArticlePhotos,'function');
  for(const mode of ['static','reduce','nonsquare']){const h=harness();let calls=0;if(mode==='static')h.view.cdhPhotoVariant='static';if(mode==='reduce')h.media.matches=true;if(mode==='nonsquare')h.images[0].naturalHeight=720;runtime.enhanceArticlePhotos({...h,detect:async()=>{calls++;return evidence;}});h.observers[0]?.fn([{target:h.images[0],isIntersecting:true}]);await settle();assert.equal(calls,0);assert.equal(h.images[0].parentNode.children.length,1);}
});

test('explicit admin preview reuses supplied images and button without detection or enrollment',()=>{
  assert.equal(typeof runtime.startPhotoPreview,'function');
  const h=harness(2);const image=h.images[0],container=image.parentNode,button=h.doc.createElement('button');container.append(h.images[1]);container.ownerDocument=h.doc;h.doc.defaultView=h.view;container.querySelectorAll=()=>h.images;delete h.view.cdhPhotoVariant;
  const stop=runtime.startPhotoPreview(container,button);assert.equal(container.children.length,5);assert.equal(h.intervals.size,0);h.observers[0].fn([{target:container,isIntersecting:true}]);assert.equal(h.intervals.size,1);button.fire('click');assert.equal(h.intervals.size,0);button.fire('click');assert.equal(h.intervals.size,1);assert.equal(h.view.cdhPhotoVariant,undefined);h.media.matches=true;h.media.change();assert.equal(h.intervals.size,0);stop();assert.equal(h.intervals.size,0);
});

test('image failure restores the original safely across later errors and viewport resize',async()=>{
  const h=harness();delete h.view.ResizeObserver;runtime.enhanceArticlePhotos({...h,detect:async()=>evidence});h.observers[0].fn([{target:h.images[0],isIntersecting:true}]);await settle();const frame=h.images[0].parentNode;const layers=frame.children[1].children;layers[0].fire('error');assert.doesNotThrow(()=>layers[1].fire('error'));assert.doesNotThrow(()=>h.view.resize());assert.equal(h.images[0].dataset.photoStatus,'static');
});
test('linked images, advertisements and product photos neither animate nor prevent all editorial photos from animating',async()=>{
  const excluded=['a','.ad-slot','.ad-inarticle','.cdh-mix','.cdh-spot','.shopee-inline','[data-product-id]','[data-related-card]','.section-rec'];
  const h=harness(excluded.length+8),calls=[];
  h.images.forEach((image,i)=>{
    if(i<excluded.length){image.src=image.currentSrc=`https://example.com/img/promo-${i}.jpg`;image.closest=selector=>selector.split(',').map(s=>s.trim()).includes(excluded[i])?{}:null;}
    else image.src=image.currentSrc=`https://example.com/img/article-${i-excluded.length}.jpg`;
  });
  runtime.enhanceArticlePhotos({...h,detect:async src=>{calls.push(src);return evidence;}});h.observers[0].fn(h.images.map(target=>({target,isIntersecting:true})));await settle();
  assert.deepEqual(calls,[]);
  assert.ok(h.images.slice(0,excluded.length).every(image=>image.dataset.photoStatus===undefined));
  assert.ok(h.images.slice(excluded.length).every(image=>image.dataset.photoStatus==='ready'));
});

const openPhoto=async(h)=>{runtime.enhanceArticlePhotos(h);h.observers[0].fn(h.images.map(target=>({target,isIntersecting:true})));await settle();h.observers[1].fn(h.images.map(target=>({target,isIntersecting:true})));return h.images[0].parentNode;};
test('each frame is stable until its 2.4-second switch, with a subtle 230ms camera/glitch transition',async()=>{
  const h=harness(),frame=await openPhoto(h),surface=frame.children[1],layers=surface.children;
  assert.equal(h.delays.at(-1),2400);assert.equal(surface.animations.length,0);
  assert.equal(layers[0].style.opacity,'1');assert.equal(layers[1].style.opacity,'0');
  const effects=frame.children.slice(2);assert.equal(effects.length,4);
  for(const effect of effects){assert.equal(effect.attrs['aria-hidden'],'true');assert.equal(effect.style.opacity,'0');}
  [...h.intervals][0]();assert.equal(layers[0].style.opacity,'0');assert.equal(layers[1].style.opacity,'1');
  assert.equal(surface.animations.length,1);assert.equal(surface.animations[0].options.duration,230);
  assert.equal(surface.animations[0].frames.at(-1).transform,'none');
  for(const effect of effects){assert.equal(effect.animations.length,1);assert.equal(effect.animations[0].options.duration,230);assert.equal(effect.animations[0].frames.at(-1).opacity,0);assert.equal(effect.style.opacity,'0');}
  assert.deepEqual(h.events,[]);
  frame.fire('click');assert.equal(h.intervals.size,1);h.doc.hidden=true;h.doc.visibilitychange();assert.equal(h.intervals.size,0);assert.ok(surface.animations.every(a=>a.cancelled));assert.ok(effects.every(effect=>effect.animations.every(a=>a.cancelled)));
});
test('turning on reduced motion restores the original photo and cancels active effects permanently',async()=>{
  const h=harness(),image=h.images[0],originalParent=image.parentNode,frame=await openPhoto(h),surface=frame.children[1];
  [...h.intervals][0]();h.media.matches=true;h.media.change();
  assert.equal(h.intervals.size,0);assert.equal(image.parentNode,originalParent);assert.deepEqual(originalParent.children,[image]);assert.equal(image.dataset.photoStatus,'static');assert.ok(surface.animations.every(a=>a.cancelled));
  h.media.matches=false;h.media.change();assert.equal(h.intervals.size,0);
});
test('control and reduced-motion cohorts do not initialize, observe, run timers or emit exposure',()=>{
  for(const mode of ['static','reduce']){const h=harness();if(mode==='static')h.view.cdhPhotoVariant='static';else h.media.matches=true;runtime.enhanceArticlePhotos(h);assert.equal(h.observers.length,0);assert.equal(h.intervals.size,0);assert.equal(h.images[0].dataset.photoStatus,undefined);assert.deepEqual(h.events,[]);}
});

test('a transition failure restores the original and leaves no playback timer',async()=>{
  const h=harness(),image=h.images[0],parent=image.parentNode,frame=await openPhoto(h);
  frame.children[1].animate=()=>{throw Error('Animation unavailable');};
  assert.doesNotThrow(()=>[...h.intervals][0]());assert.equal(image.parentNode,parent);assert.deepEqual(parent.children,[image]);assert.equal(image.dataset.photoStatus,'static');assert.equal(h.intervals.size,0);
});
test('leaving the viewport or hiding the page immediately cancels the active transition',async()=>{
  const h=harness(),frame=await openPhoto(h),surface=frame.children[1];
  [...h.intervals][0]();h.observers[1].fn([{target:h.images[0],isIntersecting:false}]);assert.equal(h.intervals.size,0);assert.ok(surface.animations.every(a=>a.cancelled));
  h.observers[1].fn([{target:h.images[0],isIntersecting:true}]);[...h.intervals][0]();h.doc.hidden=true;h.doc.visibilitychange();assert.equal(h.intervals.size,0);assert.ok(surface.animations.every(a=>a.cancelled));
});
