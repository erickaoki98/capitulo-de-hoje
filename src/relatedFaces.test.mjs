import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Import browser ES modules without changing the Worker's CommonJS package mode.
const policySource = await readFile(new URL('../public/related-face-policy.js', import.meta.url), 'utf8').catch(() => '');
const policy = await import(`data:text/javascript;base64,${Buffer.from(policySource).toString('base64')}`);

function face(overrides = {}) {
  const points = Array.from({ length: 68 }, () => ({ x: 150, y: 140 }));
  const eye = (start, x) => [[0,0],[6,-3],[14,-3],[20,0],[14,3],[6,3]].forEach(([dx,dy],i) => { points[start+i] = {x:x+dx,y:130+dy}; });
  eye(36,115); eye(42,165);
  points[30] = { x: 150, y: 150 };
  points[48] = { x: 128, y: 170 }; points[54] = { x: 172, y: 170 };
  return { score: .96, box: { x: 100, y: 95, width: 100, height: 110 }, landmarks: points, ...overrides };
}

test('only clear frontal faces pass; largest approved face comes first', () => {
  assert.equal(typeof policy.approvedFaces, 'function');
  const good = face();
  const small = face({box:{x:100,y:95,width:25,height:30}});
  const low = face({score:.7});
  const truncated = face({box:{x:-5,y:95,width:100,height:110}});
  const profile = face(); profile.landmarks[30].x = 174;
  const rear = face(); rear.landmarks[42] = rear.landmarks[36];
  const missing = face({landmarks:[]});
  const larger = face({box:{x:80,y:70,width:140,height:160}});
  assert.deepEqual(policy.approvedFaces([good,small,low,truncated,profile,rear,missing,larger],800,450),[larger,good]);
});

test('rejects invisible mouth, invalid geometry and faces with collapsed eyes', () => {
  const mouth = face(); mouth.landmarks[48].y = mouth.landmarks[54].y = 128;
  const eye = face(); eye.landmarks[37].y = eye.landmarks[41].y;
  const invalid = face({box:{x:NaN,y:95,width:100,height:110}});
  assert.deepEqual(policy.approvedFaces([mouth,eye,invalid],800,450),[]);
});

test('crop stays entirely inside source and keeps constant face scale across sizes', () => {
  assert.equal(typeof policy.faceCrop,'function');
  const a = policy.faceCrop(face(),800,450,100,140);
  assert.ok(a.x >= 0 && a.y >= 0 && a.x+a.width <= 800 && a.y+a.height <= 450);
  assert.ok(Math.abs(a.width/a.height - 100/140) < .0001);
  const b = policy.faceCrop(face({box:{x:200,y:90,width:200,height:220}}),800,450,100,140);
  assert.equal(a.height/110,b.height/220);
  const edge = policy.faceCrop(face({box:{x:0,y:0,width:100,height:110}}),800,450,100,140);
  assert.equal(edge.x,0); assert.equal(edge.y,0);
  const huge = policy.faceCrop(face({box:{x:0,y:0,width:800,height:450}}),800,450,100,140);
  assert.ok(huge.width <= 800 && huge.height <= 450);
});

test('source list permits only two unique same-origin managed images', () => {
  assert.equal(typeof policy.faceSources,'function');
  assert.deepEqual(policy.faceSources('/img/a.jpg','["/img/a.jpg","/img/b.jpg","/img/c.jpg"]','https://example.com'),['https://example.com/img/a.jpg','https://example.com/img/b.jpg']);
  assert.deepEqual(policy.faceSources('https://bad.test/img/a.jpg','["javascript:bad","/else/a.jpg"]','https://example.com'),[]);
  assert.deepEqual(policy.faceSources('/img/a.jpg','invalid','https://example.com'),['https://example.com/img/a.jpg']);
});

test('real preview frontal face is accepted at detector score; lower confidence is rejected', () => {
  const actual = face({score:.813,box:{x:119.46,y:170.5,width:129.92,height:110.93}});
  const pts = [[178.15,198.16],[184.16,198.26],[189.11,198.21],[193.49,201.21],[189.26,202.89],[183.29,201.46],[215.23,201.77],[221.68,199.33],[226.5,199.68],[229.14,201.11],[225.68,203.6],[220.56,203.93]];
  pts.forEach(([x,y],i) => actual.landmarks[36+i]={x,y});
  actual.landmarks[30]={x:207.95,y:231.96};actual.landmarks[48]={x:185.07,y:245.05};actual.landmarks[54]={x:214.25,y:247.02};
  assert.equal(policy.approvedFaces([actual],1080,1080).length,1);
  assert.equal(policy.approvedFaces([face({score:.79})],800,450).length,0);
});

const runtimeSource = await readFile(new URL('../public/related-faces.js',import.meta.url),'utf8').catch(()=>'');
const runtime = await import(`data:text/javascript;base64,${Buffer.from(runtimeSource.replace("'./related-face-policy.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(policySource).toString('base64')}`))).toString('base64')}`);

function harness(count=1) {
  class Element {
    constructor(){this.dataset={};this.style={};this.children=[];this.attrs={};this.listeners={};this.classList={values:new Set(),add:v=>this.classList.values.add(v),remove:v=>this.classList.values.delete(v)};}
    setAttribute(k,v){this.attrs[k]=v;}
    append(...children){this.children.push(...children);}
    addEventListener(k,fn){this.listeners[k]=fn;}
    cloneNode(){return new Element();}
    remove(){this.removed=true;}
    getBoundingClientRect(){return {width:100,height:140};}
  }
  const cards=Array.from({length:count},()=>{const card=new Element(),photo=new Element(),image=new Element();image.src='https://example.com/img/a.jpg';card.querySelector=s=>s.includes('photo')?photo:image;photo.append(image);card.photo=photo;return card;});
  const observers=[];const intervals=new Set();const media={matches:false,addEventListener(k,f){this.change=f;}};
  const view={location:{origin:'https://example.com'},IntersectionObserver:class {constructor(fn,options){this.fn=fn;this.options=options;observers.push(this);}observe(){}unobserve(){}},ResizeObserver:class{observe(){}},matchMedia:()=>media,setInterval(fn){intervals.add(fn);return fn;},clearInterval(fn){intervals.delete(fn);},addEventListener(){}};
  const doc={hidden:false,querySelectorAll:()=>cards,createElement:()=>new Element(),addEventListener(k,fn){this[k]=fn;}};
  return {doc,view,cards,observers,intervals,media};
}
const settle=async()=>{for(let i=0;i<30;i++)await new Promise(resolve=>setImmediate(resolve));};

test('runtime is lazy, processes at most 12 cards sequentially and reuses source detection',async()=>{
  assert.equal(typeof runtime.enhanceRelatedCards,'function');
  const h=harness(14);let calls=0,active=0,maxActive=0;
  runtime.enhanceRelatedCards({...h,detect:async()=>{calls++;maxActive=Math.max(maxActive,++active);await settle();active--;return {width:800,height:450,faces:[face()]};}});
  assert.equal(calls,0);
  h.observers[0].fn(h.cards.map(target=>({target,isIntersecting:true})));
  await settle();await settle();
  assert.equal(calls,1);assert.equal(maxActive,1);
  assert.equal(h.cards.filter(c=>c.dataset.faceStatus==='ready').length,12);
  assert.equal(h.cards[12].dataset.faceStatus,'fallback');assert.ok(!h.cards[12].classList.values.has('section-rec--text-only'));
});

test('model failure preserves photos and does not retry a failed source',async()=>{
  const h=harness(2);let calls=0;
  runtime.enhanceRelatedCards({...h,detect:async()=>{calls++;throw Error('model unavailable');}});
  h.observers[0].fn(h.cards.map(target=>({target,isIntersecting:true})));await settle();
  assert.equal(calls,1);assert.ok(h.cards.every(c=>c.dataset.faceStatus==='fallback' && !c.classList.values.has('section-rec--text-only')));
  h.observers[0].fn(h.cards.map(target=>({target,isIntersecting:true})));await settle();assert.equal(calls,1);
});

test('multiple approved faces rotate with pause for visibility, motion and keyboard control',async()=>{
  const h=harness();runtime.enhanceRelatedCards({...h,detect:async()=>({width:800,height:450,faces:[face(),face({box:{x:101,y:95,width:100,height:110}})]})});
  h.observers[0].fn([{target:h.cards[0],isIntersecting:true}]);await settle();
  const visibility=h.observers[1];visibility.fn([{target:h.cards[0],isIntersecting:true}]);
  assert.equal(h.intervals.size,1);
  const button=h.cards[0].children[0];button.listeners.click();assert.equal(h.intervals.size,0);assert.equal(button.attrs['aria-pressed'],'true');
  button.listeners.click();assert.equal(h.intervals.size,1);
  h.doc.hidden=true;h.doc.visibilitychange();assert.equal(h.intervals.size,0);
  h.doc.hidden=false;h.doc.visibilitychange();assert.equal(h.intervals.size,1);
  h.media.matches=true;h.media.change();assert.equal(h.intervals.size,0);
  h.media.matches=false;h.media.change();visibility.fn([{target:h.cards[0],isIntersecting:false}]);assert.equal(h.intervals.size,0);
});

test('alternate on photo is tried after an unusable hero, with sequential work and two source cap',async()=>{
  const h=harness(2);h.cards[0].photo.dataset.faceAlternatives='["/img/b.jpg","/img/ignored.jpg"]';
  h.cards[1].querySelector('.section-rec__image').src='https://example.com/img/c.jpg';
  let active=0,maxActive=0;const calls=[];
  runtime.enhanceRelatedCards({...h,detect:async src=>{calls.push(src);maxActive=Math.max(maxActive,++active);await settle();active--;return {width:800,height:450,faces:src.endsWith('/b.jpg')?[face()]:[]};}});
  h.observers[0].fn(h.cards.map(target=>({target,isIntersecting:true})));await settle();await settle();await settle();await settle();
  assert.deepEqual(calls,['https://example.com/img/a.jpg','https://example.com/img/b.jpg','https://example.com/img/c.jpg']);
  assert.equal(maxActive,1);assert.equal(h.cards[0].dataset.faceStatus,'ready');assert.equal(h.cards[1].dataset.faceStatus,'fallback');
});

test('tall narrow frames preserve full face width with margin and source bounds',()=>{
  const actual=face({box:{x:119.46,y:170.5,width:129.92,height:110.93}});
  const crop=policy.faceCrop(actual,1080,1080,94,220);
  assert.ok(crop.width >= actual.box.width*1.15);
  assert.ok(crop.x <= actual.box.x && crop.x+crop.width >= actual.box.x+actual.box.width);
  assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x+crop.width <=1080 && crop.y+crop.height<=1080);
  assert.ok(Math.abs(crop.width/crop.height-94/220)<.0001);
});

test('approved alternate restores image hidden by an earlier image error',async()=>{
  const h=harness();h.cards[0].photo.dataset.faceAlternatives='["/img/b.jpg"]';
  const image=h.cards[0].querySelector('.section-rec__image');image.style.display='none';image.dataset.broken='true';
  runtime.enhanceRelatedCards({...h,detect:async src=>({width:800,height:450,faces:src.endsWith('/b.jpg')?[face()]:[]})});
  h.observers[0].fn([{target:h.cards[0],isIntersecting:true}]);await settle();
  assert.equal(h.cards[0].dataset.faceStatus,'ready');assert.equal(image.style.display,'');assert.equal(image.src,'https://example.com/img/b.jpg');
});


test('no approved face preserves the original photo without face zoom',async()=>{
  const h=harness();const image=h.cards[0].querySelector('.section-rec__image');
  runtime.enhanceRelatedCards({...h,detect:async()=>({width:800,height:450,faces:[]})});
  h.observers[0].fn([{target:h.cards[0],isIntersecting:true}]);await settle();
  assert.equal(h.cards[0].dataset.faceStatus,'fallback');assert.equal(image.src,'https://example.com/img/a.jpg');
  assert.ok(!h.cards[0].classList.values.has('section-rec--text-only'));assert.equal(image.style.width,undefined);
});

test('unsupported observer preserves native photo and never loads models',()=>{
  const h=harness();delete h.view.IntersectionObserver;let calls=0;
  runtime.enhanceRelatedCards({...h,detect:async()=>{calls++;return {};}});
  assert.equal(calls,0);assert.equal(h.cards[0].dataset.faceStatus,'fallback');
  assert.ok(!h.cards[0].classList.values.has('section-rec--text-only'));
});

test('native image failure tries alternate even when model fails; only both native errors hide photo',async()=>{
  const h=harness();const image=h.cards[0].querySelector('.section-rec__image');h.cards[0].photo.dataset.faceAlternatives='["/img/b.jpg"]';
  runtime.enhanceRelatedCards({...h,detect:async()=>{throw Error('model503');}});
  h.observers[0].fn([{target:h.cards[0],isIntersecting:true}]);await settle();
  assert.equal(typeof image.listeners.error,'function');image.listeners.error();
  assert.equal(image.src,'https://example.com/img/b.jpg');assert.equal(h.cards[0].dataset.faceStatus,'fallback');
  assert.ok(!h.cards[0].classList.values.has('section-rec--text-only'));
  image.listeners.error();assert.equal(h.cards[0].dataset.faceStatus,'unavailable');
  assert.ok(h.cards[0].classList.values.has('section-rec--text-only'));
  image.listeners.error();assert.equal(image.src,'https://example.com/img/b.jpg');
});

test('already broken hero uses valid unzoomed alternate with no approved faces',async()=>{
  const h=harness();const image=h.cards[0].querySelector('.section-rec__image');
  image.complete=true;image.naturalWidth=0;image.style.display='none';h.cards[0].photo.dataset.faceAlternatives='["/img/b.jpg"]';
  runtime.enhanceRelatedCards({...h,detect:async()=>({width:800,height:450,faces:[]})});
  h.observers[0].fn([{target:h.cards[0],isIntersecting:true}]);await settle();
  assert.equal(image.src,'https://example.com/img/b.jpg');assert.equal(image.style.display,'');assert.equal(image.style.opacity,'1');
  assert.equal(h.cards[0].dataset.faceStatus,'fallback');assert.ok(!h.cards[0].classList.values.has('section-rec--text-only'));
});


test('native error after approved crop clears zoom and animation for safe alternate',async()=>{
  const h=harness();const image=h.cards[0].querySelector('.section-rec__image');h.cards[0].photo.dataset.faceAlternatives='["/img/b.jpg"]';
  runtime.enhanceRelatedCards({...h,detect:async()=>({width:800,height:450,faces:[face(),face()]})});
  h.observers[0].fn([{target:h.cards[0],isIntersecting:true}]);await settle();
  h.observers[1].fn([{target:h.cards[0],isIntersecting:true}]);assert.equal(h.intervals.size,1);
  const clone=h.cards[0].photo.children[1],button=h.cards[0].children[0];image.listeners.error();
  assert.equal(h.intervals.size,0);assert.ok(clone.removed && button.removed);
  assert.equal(image.style.width,'');assert.equal(image.style.height,'');assert.equal(image.style.opacity,'1');
  assert.equal(image.src,'https://example.com/img/b.jpg');assert.equal(h.cards[0].dataset.faceStatus,'fallback');
});

test('only absence of a safe display image removes initial photo',()=>{
  const h=harness();h.cards[0].querySelector('.section-rec__image').src='http://external.test/photo.jpg';
  runtime.enhanceRelatedCards({...h,detect:async()=>{throw Error('must not detect');}});
  assert.equal(h.cards[0].dataset.faceStatus,'unavailable');assert.ok(h.cards[0].classList.values.has('section-rec--text-only'));
});


test('valid external HTTPS hero remains visible without loading inference',async()=>{
  const h=harness();const image=h.cards[0].querySelector('.section-rec__image');image.src='https://legacy-cdn.test/r2/hero.jpg';let calls=0;
  runtime.enhanceRelatedCards({...h,detect:async()=>{calls++;throw Error('external must not infer');}});
  h.observers[0].fn([{target:h.cards[0],isIntersecting:true}]);await settle();
  assert.equal(calls,0);assert.equal(image.src,'https://legacy-cdn.test/r2/hero.jpg');
  assert.equal(h.cards[0].dataset.faceStatus,'fallback');assert.ok(!h.cards[0].classList.values.has('section-rec--text-only'));
});

test('external hero uses just one safe alternate after native error without inferring remote URLs',async()=>{
  const h=harness();const image=h.cards[0].querySelector('.section-rec__image');image.src='https://legacy-cdn.test/r2/hero.jpg';
  h.cards[0].photo.dataset.faceAlternatives='["/img/b.jpg","/img/ignored.jpg"]';const calls=[];
  runtime.enhanceRelatedCards({...h,detect:async src=>{calls.push(src);return {width:800,height:450,faces:[]};}});
  h.observers[0].fn([{target:h.cards[0],isIntersecting:true}]);await settle();
  assert.equal(image.src,'https://legacy-cdn.test/r2/hero.jpg');assert.ok(calls.every(src=>src.startsWith('https://example.com/img/')));
  image.listeners.error();assert.equal(image.src,'https://example.com/img/b.jpg');assert.equal(h.cards[0].dataset.faceStatus,'fallback');
  image.listeners.error();assert.equal(h.cards[0].dataset.faceStatus,'unavailable');assert.equal(image.src,'https://example.com/img/b.jpg');
});
