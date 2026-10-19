import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createSession } from './auth.ts';

const built = await build({entryPoints:['src/index.ts'],bundle:true,write:false,format:'esm',platform:'neutral',mainFields:['module','main'],plugins:[{
  name:'unused-photon',setup(b){b.onResolve({filter:/^@cf-wasm\/photon$/},()=>({path:'photon',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export class PhotonImage {} export const SamplingFilter = {}; export function crop(){} export function resize(){}',loader:'js'}));}
}]});
const {default:worker} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function harness(){
  const settings=new Map(), reads=[];
  const env={SESSION_SECRET:'test-only-session',SITE_TITLE:'Capítulo de Hoje',SITE_DESCRIPTION:'Teste',CANONICAL_URL:'https://example.com',DB:{prepare(sql){reads.push(sql);let args=[];return {bind(...a){args=a;return this;},async first(){return settings.has(args[0])?{value:settings.get(args[0])}:null;},async all(){return {results:/SELECT value FROM settings/i.test(sql)&&settings.has(args[0])?[{value:settings.get(args[0])}]:[]};},async run(){if(/INSERT.*settings/is.test(sql))settings.set(args[0],args[1]);return {meta:{}};}};}},IMAGES:{async get(){return null;}}};
  return {env,settings,reads};
}
const context={waitUntil(){throw Error('GET must not launch work');}};
test('blog photo panel requires login before reading settings, reports or contacting Google',async()=>{
  const {env,reads}=harness();
  const res=await worker.fetch(new Request('https://example.com/admin/teste-fotos'),env,context);
  assert.equal(res.status,303);assert.equal(res.headers.get('location'),'/admin');assert.equal(reads.length,0);
});
test('blog panel shows honest setup state, no fake revenue or claim of active test',async()=>{
  const {env}=harness();const session=await createSession(env.SESSION_SECRET);
  const res=await worker.fetch(new Request('https://example.com/admin/teste-fotos',{headers:{Cookie:`session=${session}`}}),env,context);
  assert.equal(res.status,200);assert.match(res.headers.get('cache-control'),/private, no-store/);
  const html=await res.text();assert.match(html,/Teste de fotos/);assert.match(html,/Ainda não iniciado/);assert.match(html,/Receita por mil/);assert.match(html,/Conectar Analytics/);assert.doesNotMatch(html,/R\$\s*0,00|US\$\s*0,00|test-only-session/);
});
test('all photo panel POSTs require the same exact Origin before any storage mutation',async()=>{
  const {env,reads}=harness();const session=await createSession(env.SESSION_SECRET);
  for(const route of ['config','connect','sync','map']){
    const res=await worker.fetch(new Request(`https://example.com/admin/teste-fotos/${route}`,{method:'POST',headers:{Cookie:`session=${session}`,Origin:'https://evil.example'}}),env,context);
    assert.equal(res.status,403);assert.equal(reads.length,0);
  }
});
test('visual map rejects external sources and out-of-bounds crops without writing settings',async()=>{
  const {env,settings}=harness();const session=await createSession(env.SESSION_SECRET);
  const res=await worker.fetch(new Request('https://example.com/admin/teste-fotos/map',{method:'POST',headers:{Cookie:`session=${session}`,Origin:'https://example.com'},body:new URLSearchParams({source:'https://evil.example/picture.jpg',shots:JSON.stringify([{x:.9,y:0,size:.5,label:'Rosto'},{x:0,y:0,size:.5,label:'Interação'}])})}),env,context);
  assert.equal(res.status,400);assert.equal(settings.size,0);
});
test('test starts without Google or revenue linkage and never inserts a manual map',async()=>{
  const {env,settings}=harness();const session=await createSession(env.SESSION_SECRET);
  const res=await worker.fetch(new Request('https://example.com/admin/teste-fotos/config',{method:'POST',headers:{Cookie:`session=${session}`,Origin:'https://example.com'},body:new URLSearchParams({action:'start'})}),env,context);
  assert.equal(res.headers.get('location'),'/admin/teste-fotos?status=saved');const config=JSON.parse(settings.get('photo.experiment'));assert.equal(config.enabled,true);assert.equal(config.share,50);assert.ok(config.startedAt>0);assert.equal(settings.has('photo.maps'),false);
});
test('start, duplicate start, pause and resume preserve one population and the original start time',async()=>{
  const {env,settings,reads}=harness();
  Object.assign(env,{ADSENSE_CLIENT_ID:'local-client',ADSENSE_CLIENT_SECRET:'local-secret'});
  settings.set('adsense.publisher_id','pub-9160979665550731');
  const {seal}=await import('./adsenseReports.ts');const objects=new Map();
  const root='_internal/photo-analytics-v1/';
  objects.set(root+'connection',await seal(env,root+'connection',{id:'conn-1',email:'test@example.com',refreshToken:'private',timeZone:'America/Sao_Paulo'}));
  objects.set(root+'readiness',await seal(env,root+'readiness',{connectionId:'conn-1',checkedAt:Date.now(),revenueLinked:true,validFrom:Date.now()-3*86400000,publisherId:'ca-pub-9160979665550731',revenueStatus:'verified'}));
  env.IMAGES.get=async key=>objects.has(key)?{text:async()=>objects.get(key)}:null;
  const session=await createSession(env.SESSION_SECRET);
  async function action(value){return worker.fetch(new Request('https://example.com/admin/teste-fotos/config',{method:'POST',headers:{Cookie:`session=${session}`,Origin:'https://example.com'},body:new URLSearchParams({action:value})}),env,context);}
  const first=await action('start');assert.equal(first.status,303);
  const initial=JSON.parse(settings.get('photo.experiment'));assert.equal(initial.enabled,true);assert.equal(initial.share,50);assert.ok(initial.startedAt>0);
  const writes=()=>reads.filter(sql=>/INSERT.*settings/is.test(sql)).length;
  const before=writes();await action('start');assert.equal(writes(),before,'duplicate start does not rewrite config or invalidate cache');
  await action('pause');assert.equal(JSON.parse(settings.get('photo.experiment')).enabled,false);
  await action('start');assert.deepEqual(JSON.parse(settings.get('photo.experiment')),initial);
  assert.deepEqual([...settings.keys()].sort(),['adsense.publisher_id','cache.last_purged_at','cache.version','photo.experiment']);
});
test('Analytics connect uses separate least-privilege grant and the existing registered callback',async()=>{
  const {env}=harness();Object.assign(env,{ADSENSE_CLIENT_ID:'local-client',ADSENSE_CLIENT_SECRET:'local-secret'});
  const session=await createSession(env.SESSION_SECRET);
  const res=await worker.fetch(new Request('https://example.com/admin/teste-fotos/connect',{method:'POST',headers:{Cookie:`session=${session}`,Origin:'https://example.com'}}),env,context);
  const target=new URL(res.headers.get('location'));
  assert.equal(target.origin,'https://accounts.google.com');assert.equal(target.searchParams.get('redirect_uri'),'https://example.com/admin/adsense/callback');
  assert.equal(target.searchParams.get('scope'),'openid email https://www.googleapis.com/auth/analytics.readonly');assert.equal(target.searchParams.get('code_challenge_method'),'S256');assert.equal(target.searchParams.get('login_hint'),null);
  assert.match(res.headers.get('set-cookie'),/Path=\/admin\/adsense; HttpOnly; Secure; SameSite=Lax/);
  const {unseal,digest}=await import('./adsenseReports.ts');
  const state=await unseal(env,'oauth-state',res.headers.get('set-cookie').split(';')[0].split('=').slice(1).join('='));
  assert.equal(state.service,'photo_analytics');assert.equal(state.session,await digest(session));assert.ok(state.verifier);assert.ok(state.expires>Date.now());
});
test('article bootstrap precedes ads and first Analytics page view; home never newly enrolls',async()=>{
  const builtRender=await build({entryPoints:['src/render.ts'],bundle:true,write:false,format:'esm',platform:'neutral'});
  const {renderPost,renderHome}=await import('data:text/javascript;base64,'+Buffer.from(builtRender.outputFiles[0].text).toString('base64'));
  const config={enabled:true,id:'photo-v1',startedAt:Date.now(),share:50};
  const env={SITE_TITLE:'Blog',SITE_DESCRIPTION:'Teste'};
  const post={id:1,slug:'teste',title:'Teste',description:'Descrição',content:'<figure><img src="/img/9e5335709590212c.jpg" alt="Cena"></figure>',category:'Novela',tags:'',author:'Autor',hero_image:null,draft:0,pub_date:Date.now(),updated_date:Date.now(),source_url:null};
  const html=renderPost(env,new Request('https://example.com/teste'),post,[],undefined,undefined,[],undefined,'G-TEST12345',null,null,true,config,{'/img/9e5335709590212c.jpg':{reviewedAt:Date.now(),shots:[{x:.17,y:0,size:.3,label:'Rosto'},{x:.66,y:.105,size:.3,label:'Reação'}]}});
  assert.ok(html.indexOf('cdhPhotoExperiment')<html.indexOf("gtag('config'"));assert.match(html,/eligible=true/);assert.match(html,/photo-motion\.js/);
  assert.match(renderHome(env,new Request('https://example.com/'),[],undefined,undefined,'G-TEST12345',true,config),/eligible=false/);
});
test('approved map survives a new admin GET and cache invalidation; active test freezes map writes',async()=>{
  const {env,settings}=harness();const session=await createSession(env.SESSION_SECRET);
  const shots=[{x:.17,y:0,size:.3,label:'Rosto'},{x:.66,y:.105,size:.3,label:'Reação'}];
  const save=()=>worker.fetch(new Request('https://example.com/admin/teste-fotos/map',{method:'POST',headers:{Cookie:`session=${session}`,Origin:'https://example.com'},body:new URLSearchParams({source:'/img/9e5335709590212c.jpg',shots:JSON.stringify(shots)})}),env,context);
  assert.equal((await save()).headers.get('location'),'/admin/teste-fotos?status=map_saved');
  const saved=settings.get('photo.maps');assert.deepEqual(JSON.parse(saved)['/img/9e5335709590212c.jpg'].shots,shots);assert.ok(settings.has('cache.version'));
  const read=await worker.fetch(new Request('https://example.com/admin/teste-fotos',{headers:{Cookie:`session=${session}`}}),env,context);assert.doesNotMatch(await read.text(),/photo-map-form|photo-map-data|photo-map-editor/);
  settings.set('photo.experiment',JSON.stringify({enabled:true,id:'photo-v1',startedAt:Date.now()}));
  assert.equal((await save()).headers.get('location'),'/admin/teste-fotos?status=map_locked');assert.equal(settings.get('photo.maps'),saved);
});

test('changed Publisher hides only money and preserves the last engagement snapshot on GET',async()=>{
  const {env,settings}=harness();Object.assign(env,{ADSENSE_CLIENT_ID:'local-client',ADSENSE_CLIENT_SECRET:'local-secret'});
  settings.set('photo.experiment',JSON.stringify({enabled:true,id:'photo-v1',startedAt:Date.now()-3*86400000,share:50}));
  settings.set('adsense.publisher_id','pub-0000000000000000');
  const {seal}=await import('./adsenseReports.ts');const root='_internal/photo-analytics-v1/',objects=new Map();
  const readiness={connectionId:'conn-1',publisherId:'ca-pub-9160979665550731',validFrom:1,checkedAt:Date.now(),revenueLinked:true,revenueStatus:'verified'};
  objects.set(root+'connection',await seal(env,root+'connection',{id:'conn-1',email:'test@example.com',refreshToken:'private',timeZone:'America/Sao_Paulo'}));
  objects.set(root+'readiness',await seal(env,root+'readiness',readiness));
  objects.set(root+'report',await seal(env,root+'report',{connectionId:'conn-1',publisherId:readiness.publisherId,revenueValidFrom:1,testId:'photo-v1',generatedAt:Date.now(),start:'2026-10-13',end:'2026-10-15',currency:'USD',revenueLinked:true,revenueStatus:'verified',warnings:[],rows:[{date:'2026-10-15',variant:'static',adArm:'adsense',device:'mobile',views:743,sessions:50,engagedSessions:30,engagementSeconds:500,revenue:9}]}));
  env.IMAGES.get=async key=>objects.has(key)?{text:async()=>objects.get(key)}:null;
  const session=await createSession(env.SESSION_SECRET);const response=await worker.fetch(new Request('https://example.com/admin/teste-fotos',{headers:{Cookie:`session=${session}`}}),env,context);
  const html=await response.text();assert.equal(response.status,200);assert.match(html,/743/);assert.match(html,/Publisher ID mudou/);assert.doesNotMatch(html,/US\$\s*9,00/);
});
