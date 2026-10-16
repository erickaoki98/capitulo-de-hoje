import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./photoExperiment.ts',import.meta.url),'utf8').catch(()=> '');
const module = source ? await import('./photoExperiment.ts') : {};
const cfg = {enabled:true,id:'photo-v1',startedAt:100,share:50};
function run(config=cfg,{store=new Map(),random=0,blocked=false,eligible=true}={}) {
  const context = {window:{},localStorage:{getItem:k=>store.get(k)??null,setItem(k,v){if(blocked)throw Error('blocked');store.set(k,v);}},crypto:{getRandomValues(a){a[0]=random;return a;}}};
  vm.runInNewContext(module.renderPhotoBootstrap(config,eligible).replace(/^<script>|<\/script>$/g,''),context);
  return {context,store,state:context.window.cdhPhotoExperiment};
}
test('photo config is off by default, validates ids and clamps numeric input',()=>{
  assert.equal(typeof module.parsePhotoConfig,'function');
  assert.deepEqual(module.parsePhotoConfig(null),{enabled:false,id:'photo-v1',startedAt:0,share:50});
  assert.deepEqual(module.parsePhotoConfig('{bad'),module.parsePhotoConfig(null));
  assert.deepEqual(module.parsePhotoConfig('{"enabled":"yes","id":"</script>","startedAt":-1,"share":101}'),{enabled:false,id:'photo-v1',startedAt:0,share:100});
  assert.equal(module.parsePhotoConfig('{"id":"trial-2","enabled":true,"share":12.6}').share,13);
});
test('secure per-experiment assignment persists and GA property is queued before config',()=>{
  assert.equal(typeof module.renderPhotoBootstrap,'function');
  const a=run();assert.equal(a.context.window.cdhPhotoVariant,'motion');assert.equal(a.state.enrolled,true);
  const b=run(cfg,{store:a.store,random:0xffffffff});assert.equal(b.state.variant,'motion');
  const c=run({...cfg,id:'photo-v2'},{store:a.store,random:0xffffffff});assert.equal(c.state.variant,'static');
  assert.equal(a.context.window.dataLayer[0][0],'set');assert.equal(a.context.window.dataLayer[0][1],'user_properties');assert.equal(a.context.window.dataLayer[0][2].photo_ab_v1,'motion');
});
test('disabled config and failed persistence stay static without experiment enrollment',()=>{
  assert.equal(typeof module.renderPhotoBootstrap,'function');
  const a=run({...cfg,enabled:false});assert.equal(a.state.enrolled,false);assert.equal(a.store.size,0);assert.equal(a.context.window.dataLayer?.[0]?.[2]?.photo_ab_v1,null);
  const b=run(cfg,{blocked:true});assert.equal(b.state.enrolled,false);assert.equal(b.state.variant,'static');assert.equal(b.context.window.dataLayer?.[0]?.[2]?.photo_ab_v1,null);
});
test('loader stays inert for static arm and emits motion-specific square styles',()=>{
  assert.equal(typeof module.renderPhotoScript,'function');
  assert.equal(module.renderPhotoScript({...cfg,enabled:false}),'');
  const html=module.renderPhotoScript(cfg);assert.match(html,/cdhPhotoVariant.*motion/);assert.match(html,/photo-motion\.js/);assert.match(html,/aspect-ratio:1/);
});

test('non-article pages only restore existing assignment, never enroll a new reader',()=>{
  const fresh=run(cfg,{eligible:false});assert.equal(fresh.state.enrolled,false);assert.equal(fresh.store.size,0);assert.equal(fresh.context.window.dataLayer?.[0]?.[2]?.photo_ab_v1,null);
  const article=run();const home=run(cfg,{store:article.store,eligible:false,random:0xffffffff});assert.equal(home.state.variant,'motion');assert.equal(home.state.enrolled,true);
});
