import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createSession } from './auth.ts';
const built=await build({entryPoints:['src/index.ts'],bundle:true,write:false,format:'esm',platform:'neutral',mainFields:['module','main'],plugins:[{
 name:'unused-photon',setup(builder){builder.onResolve({filter:/^@cf-wasm\/photon$/},()=>({path:'photon',namespace:'test'}));builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export class PhotonImage {} export const SamplingFilter = {}; export function crop(){throw Error("unused")} export function resize(){throw Error("unused")}',loader:'js'}));}
}]});
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('real Worker enforces login, renders unconfigured state without storage and rejects CSRF',async()=>{
 const env={SESSION_SECRET:'test-only-session',SITE_TITLE:'Capítulo de Hoje',SITE_DESCRIPTION:'Teste',CANONICAL_URL:'https://example.com',ADSENSE_GOOGLE_EMAIL:'expected@example.com',DB:{prepare(){throw Error('must not query D1');}},IMAGES:{get(){throw Error('must not read unconfigured reports');}}};
 const context={waitUntil(){throw Error('must not launch background work');}};
 const publicRes=await worker.fetch(new Request('https://example.com/admin/adsense'),env,context);
 assert.equal(publicRes.status,303);assert.equal(publicRes.headers.get('location'),'/admin');
 const session=await createSession(env.SESSION_SECRET);
 const response=await worker.fetch(new Request('https://example.com/admin/adsense',{headers:{Cookie:`session=${session}`}}),env,context);
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
 const html=await response.text();assert.match(html,/Receita do AdSense/);assert.match(html,/aguarda a configuração do cliente OAuth/);assert.doesNotMatch(html,/test-only-session/);
 const csrf=await worker.fetch(new Request('https://example.com/admin/adsense/sync',{method:'POST',headers:{Cookie:`session=${session}`,Origin:'https://evil.example'}}),env,context);
 assert.equal(csrf.status,403);
 const hidden=await worker.fetch(new Request('https://example.com/img/_internal/adsense-v1/connection'),env,context);
 assert.equal(hidden.status,404);
});

test('retired photo admin and API routes are unavailable and cannot schedule work',async()=>{
 const queries=[],keys=[],tasks=[];
 const env={SESSION_SECRET:'test-only-session',SITE_TITLE:'Site',SITE_DESCRIPTION:'Teste',CANONICAL_URL:'https://example.com',DB:{prepare(sql){queries.push(sql);return {bind(){return this},async all(){return {results:/api_keys/i.test(sql)?[{id:1}]:[]}},async first(){return /api_keys/i.test(sql)?{id:1}:null},async run(){return {meta:{}}}}}},IMAGES:{async get(key){keys.push(key);throw Error('retired routes must not read R2')}}};
 const session=await createSession(env.SESSION_SECRET),ctx={waitUntil(p){tasks.push(p)}};
 for(const suffix of ['', '/config','/map','/connect','/sync']){
  const res=await worker.fetch(new Request('https://example.com/admin/teste-fotos'+suffix,{method:suffix?'POST':'GET',headers:{Cookie:`session=${session}`,Origin:'https://example.com'}}),env,ctx);
  assert.equal(res.status,404);
 }
 for(const endpoint of ['status','backfill','run','start-test','report-status','sync-reports','traffic-status','traffic-prepare','traffic-run']){
  const res=await worker.fetch(new Request('https://example.com/api/photo-ai/'+endpoint,{method:endpoint.includes('status')?'GET':'POST',headers:{Authorization:'Bearer cdh_local_test'}}),env,ctx);
  assert.equal(res.status,404);
 }
 await Promise.all(tasks);
 assert.equal(keys.length,0);
 assert.ok(queries.every(sql=>/settings|api_keys/.test(sql)));
});
