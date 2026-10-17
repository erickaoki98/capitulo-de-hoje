import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createHash} from 'node:crypto';
const built=await build({entryPoints:['src/photoAITraffic.ts'],bundle:true,write:false,format:'esm',platform:'neutral',mainFields:['module','main'],plugins:[{name:'no-live-images',setup(b){b.onResolve({filter:/^@cf-wasm\/photon$/},()=>({path:'photon',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export class PhotonImage {} export const SamplingFilter={};export function crop(){}export function resize(){}',loader:'js'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const now=Date.parse('2026-10-17T18:00:00Z');
function harness(n=10){const objects=new Map();const posts=Array.from({length:n},(_,i)=>({id:i+1,slug:'p-'+i,title:'Title',draft:0,pub_date:now-86400000,content:`<img src="/img/p-${i}.jpg">`}));
 const manifest={id:'traffic-test',day:'2026-10-17',createdAt:now,expiresAt:now+6*3600000,articleIds:posts.map(p=>p.id),sources:posts.map((_,i)=>'/img/p-'+i+'.jpg'),preparedIds:[],reservedSources:[],skippedIds:[],status:'requested'};
 const bucket={async get(k){const o=objects.get(k);return o?{etag:o.etag,json:async()=>structuredClone(o.value)}:null},async put(k,v,opts){const old=objects.get(k);if(opts?.onlyIf?.etagMatches&&old?.etag!==opts.onlyIf.etagMatches||opts?.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const item={etag:createHash('sha256').update(v).digest('hex'),value:JSON.parse(v)};objects.set(k,item);return item}};
 objects.set(api.PHOTO_TRAFFIC_KEY,{etag:'first',value:manifest});
 const env={IMAGES:bucket,DB:{prepare(sql){assert.ok(!sql.includes('pageviews_hourly'));let args=[];return {bind(...v){args=v;return this},async all(){return {results:posts.filter(p=>args.slice(0,-2).includes(p.id))}},async first(){return null}}}}};return {env,objects,manifest,posts};}
test('traffic preparation is persisted, bounded to eight ids and idempotent before paid execution',async()=>{
 const h=harness();let calls=[];const enqueue=async(_,post,force)=>{assert.equal(h.objects.get(api.PHOTO_TRAFFIC_KEY).value.status,'preparing');assert.equal(force,true);calls.push(post.id)};
 const first=await api.preparePhotoTraffic(h.env,now,enqueue);assert.equal(first.prepared,8);assert.equal(first.status,'preparing');
 const next=await api.preparePhotoTraffic(h.env,now+1,enqueue);assert.equal(next.prepared,10);assert.equal(next.status,'active');
 await api.preparePhotoTraffic(h.env,now+2,enqueue);assert.equal(calls.length,10);
});
test('a selected source is reserved once before work and no unrelated source can spend',async()=>{
 const h=harness(1);await api.preparePhotoTraffic(h.env,now,async()=>{});let calls=0;
 const run=async(_env,_now,_analyze,scope)=>{calls++;assert.deepEqual(scope.articleIds,[1]);assert.equal(await scope.reserve('/img/p-0.jpg'),true);assert.equal(h.objects.get(api.PHOTO_TRAFFIC_KEY).value.reservedSources.length,1);assert.equal(await scope.reserve('/img/p-0.jpg'),false);assert.equal(await scope.reserve('/img/unrelated.jpg'),false);return {status:'ready'}};
 await api.runPhotoTraffic(h.env,now,run);assert.equal(calls,1);const view=await api.photoTrafficView(h.env);assert.equal(view.reserved,1);assert.equal(view.maxReservedUsd,.02);
});
test('batch expiry, unprepared state and completion cannot trigger paid work',async()=>{
 const h=harness(1);let calls=0;const run=async()=>{calls++;return {status:'complete'}};
 assert.equal((await api.runPhotoTraffic(h.env,now,run)).status,'preparing');assert.equal(calls,0);
 await api.preparePhotoTraffic(h.env,now,async()=>{});assert.equal((await api.runPhotoTraffic(h.env,now+6*3600000+1,run)).status,'expired');assert.equal(calls,0);
 assert.equal((await api.runPhotoTraffic(h.env,now+1,run)).status,'complete');await api.runPhotoTraffic(h.env,now+2,run);assert.equal(calls,1);
});
test('concurrent reservations are conditional and malformed or oversized manifests fail closed',async()=>{
 const h=harness(1);await api.preparePhotoTraffic(h.env,now,async()=>{});let successes=0;
 await api.runPhotoTraffic(h.env,now,async(_env,_now,_analyze,scope)=>{const results=await Promise.all(Array.from({length:12},()=>scope.reserve('/img/p-0.jpg')));successes=results.filter(Boolean).length;return {status:'ready'}});assert.equal(successes,1);
 h.objects.get(api.PHOTO_TRAFFIC_KEY).value.articleIds=Array.from({length:501},(_,i)=>i+1);await assert.rejects(()=>api.preparePhotoTraffic(h.env,now,async()=>{}),/manifesto/i);
});

test('fixed article partitions finish independently and only the final partition completes the batch',async()=>{
 const h=harness(12);await api.preparePhotoTraffic(h.env,now,async()=>{});await api.preparePhotoTraffic(h.env,now+1,async()=>{});
 const ids=[],leases=[];const run=async(_env,_now,_analyze,scope)=>{assert.equal(scope.articleIds.length,1);ids.push(scope.articleIds[0]);leases.push(scope.leaseKey);assert.equal(scope.holdLease,true);return {status:'complete'}};
 for(let i=0;i<11;i++)assert.equal((await api.runPhotoTraffic(h.env,now+2,run,()=>0)).status,'reconciled');
 assert.equal((await api.photoTrafficView(h.env)).status,'active');
 assert.equal((await api.runPhotoTraffic(h.env,now+3,run,()=>0)).status,'complete');assert.equal(new Set(ids).size,12);assert.equal(new Set(leases).size,12);
});

test('native scheduled execution reserves one minute globally and processes at most twenty-four photos',async()=>{
 const h=harness(12);await api.preparePhotoTraffic(h.env,now,async()=>{});await api.preparePhotoTraffic(h.env,now+1,async()=>{});
 let active=0,max=0;const seen=[];const run=async(_env,_now,_worker,_random,slot)=>{seen.push(slot);active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;return {status:'ready'}};
 assert.equal(await api.runScheduledPhotoTraffic(h.env,now,run),true);assert.equal(seen.length,24);assert.equal(max,12);assert.equal(new Set(seen).size,12);
 await api.runScheduledPhotoTraffic(h.env,now+100,run);assert.equal(seen.length,24);
 await api.runScheduledPhotoTraffic(h.env,now+60000,run);assert.equal(seen.length,48);
 assert.equal(await api.runScheduledPhotoTraffic(h.env,now+6*3600000+1,run),false);assert.equal(seen.length,48);
});
