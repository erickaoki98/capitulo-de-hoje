import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/photo-map-editor.js',import.meta.url),'utf8').catch(()=>'');
const editor=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function harness(){
  class Element {
    constructor(){this.value='';this.style={};this.children=[];this.listeners={};this.attrs={};this.complete=false;this.naturalWidth=this.naturalHeight=1080;}
    addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
    fire(type,event={}){for(const fn of this.listeners[type]||[])fn(event);}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    setAttribute(k,v){this.attrs[k]=v;}
    setCustomValidity(message){this.validationMessage=message;}
    reportValidity(){}
    getBoundingClientRect(){return {left:10,top:20,width:400,height:400};}
  }
  const ids=Object.fromEntries(['photo-map-form','photo-map-load','photo-map-image','photo-map-stage','photo-map-box','photo-map-label','photo-map-add','photo-map-list'].map(id=>[id,new Element()]));
  const inputs=Object.fromEntries(['source','x','y','size','shots'].map(name=>[name,new Element()]));inputs.source.value='/img/example.jpg';inputs.x.value='.1';inputs.y.value='.1';inputs.size.value='.3';
  ids['photo-map-form'].querySelector=s=>inputs[s.match(/name=["']?(\w+)/)?.[1]];
  const doc={getElementById:id=>ids[id]??null,createElement:()=>new Element()};
  return {doc,ids,inputs};
}
test('editor crop clamps a square to image bounds without inventing semantic content',()=>{
  assert.equal(typeof editor.normalizeCrop,'function');
  assert.deepEqual(editor.normalizeCrop({x:.9,y:-.5,size:.3}),{x:.7,y:0,size:.3});
  assert.deepEqual(editor.normalizeCrop({x:NaN,y:Infinity,size:0}),{x:0,y:0,size:.1});
});
test('click and sliders update overlay, labeled shots persist in hidden JSON and can be removed',()=>{
  assert.equal(typeof editor.initMapEditor,'function');
  const h=harness();editor.initMapEditor(h.doc);h.ids['photo-map-image'].fire('load');
  h.ids['photo-map-image'].fire('click',{clientX:210,clientY:220});assert.equal(Number(h.inputs.x.value),.35);assert.equal(Number(h.inputs.y.value),.35);assert.equal(h.ids['photo-map-box'].style.width,'30%');
  h.ids['photo-map-label'].value='Carta nas mãos da personagem';h.ids['photo-map-add'].fire('click');
  let shots=JSON.parse(h.inputs.shots.value);assert.equal(shots.length,1);assert.equal(shots[0].label,'Carta nas mãos da personagem');
  h.inputs.size.value='.4';h.inputs.x.value='.9';h.inputs.x.fire('input');assert.equal(Number(h.inputs.x.value),.6);
  h.ids['photo-map-label'].value='Reação de quem descobriu';h.ids['photo-map-add'].fire('click');shots=JSON.parse(h.inputs.shots.value);assert.equal(shots.length,2);assert.equal(h.ids['photo-map-list'].children.length,2);
  const remove=h.ids['photo-map-list'].children[0].children.find(child=>child.type==='button');assert.equal(remove.style.minHeight,'44px');remove.fire('click');assert.equal(JSON.parse(h.inputs.shots.value).length,1);
});
test('existing approved source map restores; invalid or short maps cannot submit; source switches clear old shots',()=>{
  assert.equal(typeof editor.initMapEditor,'function');
  const h=harness();h.ids['photo-map-data']={textContent:JSON.stringify({'/img/example.jpg':{reviewedAt:100,shots:[{x:.17,y:0,size:.3,label:'Rosto'},{x:.66,y:.1,size:.3,label:'Reação'}]}})};
  editor.initMapEditor(h.doc);h.ids['photo-map-image'].fire('load');assert.equal(JSON.parse(h.inputs.shots.value).length,2);
  let blocked=false;h.ids['photo-map-form'].fire('submit',{preventDefault(){blocked=true;}});assert.equal(blocked,false);
  h.inputs.source.value='/img/another.jpg';h.inputs.source.fire('input');assert.equal(h.inputs.shots.value,'[]');h.ids['photo-map-form'].fire('submit',{preventDefault(){blocked=true;}});assert.equal(blocked,true);
  h.ids['photo-map-load'].fire('click');h.ids['photo-map-image'].naturalHeight=720;h.ids['photo-map-image'].fire('load');h.ids['photo-map-label'].value='Inválido';h.ids['photo-map-add'].fire('click');assert.equal(h.inputs.shots.value,'[]');
});
test('editor refuses external image sources and has no network, AI or analytics side effects',()=>{
  assert.equal(typeof editor.initMapEditor,'function');
  const h=harness();h.inputs.source.value='https://elsewhere.test/img/example.jpg';editor.initMapEditor(h.doc);assert.equal(h.ids['photo-map-image'].src,undefined);
  assert.doesNotMatch(source,/\b(?:fetch|gtag|sendBeacon|XMLHttpRequest|faceapi|localStorage)\b/);
});
test('editor recovers native form validation after adding the missing labeled crop',()=>{
  const h=harness();editor.initMapEditor(h.doc);h.ids['photo-map-image'].fire('load');h.ids['photo-map-label'].value='Ação principal';h.ids['photo-map-add'].fire('click');
  h.ids['photo-map-form'].fire('submit',{preventDefault(){}});assert.ok(h.inputs.source.validationMessage);
  h.inputs.x.value='.6';h.inputs.x.fire('input');h.ids['photo-map-label'].value='Reação importante';h.ids['photo-map-add'].fire('click');assert.equal(h.inputs.source.validationMessage,'');
});
test('duplicate geometry is rejected in the editor before server submission',()=>{
  const h=harness();editor.initMapEditor(h.doc);h.ids['photo-map-image'].fire('load');h.ids['photo-map-label'].value='Rosto principal';h.ids['photo-map-add'].fire('click');
  h.ids['photo-map-label'].value='Mesmo recorte com outro nome';h.ids['photo-map-add'].fire('click');assert.equal(JSON.parse(h.inputs.shots.value).length,1);assert.match(h.ids['photo-map-label'].validationMessage,/já/);
  h.inputs.x.value='.5';h.inputs.x.fire('input');h.ids['photo-map-add'].fire('click');assert.equal(JSON.parse(h.inputs.shots.value).length,2);assert.equal(h.ids['photo-map-label'].validationMessage,'');
});
test('editor source validation matches server file names and lowercase extensions',()=>{
  for(const path of ['/img/example.more.jpg','/img/example.JPG','/img/'+ 'a'.repeat(121)+'.jpg']){const h=harness();h.inputs.source.value=path;editor.initMapEditor(h.doc);assert.equal(h.ids['photo-map-image'].src,undefined,path);}
  for(const path of ['/img/example.jpg','/img/AbC-123_test.webp']){const h=harness();h.inputs.source.value=path;editor.initMapEditor(h.doc);assert.equal(h.ids['photo-map-image'].src,path);}
});
