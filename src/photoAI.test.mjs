import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {createHash} from 'node:crypto';
const built=await build({entryPoints:['src/photoAI.ts'],bundle:true,write:false,format:'esm',platform:'neutral',mainFields:['module','main'],plugins:[{name:'unused-images',setup(b){b.onResolve({filter:/^@cf-wasm\/photon$/},()=>({path:'photon',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export class PhotonImage {} export const SamplingFilter={};export function crop(){throw Error("unused")}export function resize(){throw Error("unused")}',loader:'js'}));}}]});
const {startPhotoBackfill,runPhotoAI,photoAIView,enqueuePhotoPost,runScheduledPhotoAI,discoverPhotoPosts,PHOTO_AI_DAILY_MAX}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

function harness(count=30){let seq=0;const objects=new Map();const posts=Array.from({length:count},(_,i)=>({id:i+1,slug:'post-'+i,title:'Post '+i,content:`<figure><img src="/img/source-${i}.png"></figure>`,draft:0,pub_date:Date.now()-i*1000}));const bucket={async get(k){const o=objects.get(k);return o?{etag:o.etag,json:async()=>structuredClone(o.value),arrayBuffer:async()=>new ArrayBuffer(4)}:null},async put(k,v,opts){const current=objects.get(k);if(opts?.onlyIf?.etagDoesNotMatch==='*'&&current||opts?.onlyIf?.etagMatches&&current?.etag!==opts.onlyIf.etagMatches)return null;const o={etag:createHash('sha256').update(v).digest('hex'),value:JSON.parse(v)};objects.set(k,o);return o}};const env={OPENAI_API_KEY:'not-real',IMAGES:bucket,DB:{prepare(){return {bind(){return this},async all(){return {results:posts}},async first(){return {value:'1'}},async run(){return {success:true}}}}}};return {env,objects,posts};}
const model=async()=>({shots:[{id:'a',x:0,y:0,size:.3,label:'Rosto'},{id:'b',x:.7,y:.7,size:.3,label:'Objeto'}],estimatedCostUsd:.001,inputTokens:1000,outputTokens:100,proposals:2,rejected:0,reason:'',model:'gpt-6-luna'});
test('backfill snapshots exactly thirty articles once and duplicate start never adds more spend',async()=>{const {env,posts}=harness(30);await startPhotoBackfill(env);posts.unshift({...posts[0],id:999});await startPhotoBackfill(env);const v=await photoAIView(env);assert.equal(v.totalArticles,30);assert.equal(v.totalImages,30);assert.equal(v.queued,30)});
test('persistent completed analysis blocks duplicate model spending across repeated runs',async()=>{const {env,objects}=harness(1);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});let calls=0;await runPhotoAI(env,Date.now(),async()=>{calls++;return model()});await runPhotoAI(env,Date.now()+2000,async()=>{calls++;return model()});assert.equal(calls,1);const v=await photoAIView(env);assert.equal(v.ready,1);assert.equal(v.estimatedCostUsd,.001)});
test('failed model attempt is persisted and never automatically repeated',async()=>{const {env,objects}=harness(1);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});let calls=0;await runPhotoAI(env,Date.now(),async()=>{calls++;throw Error('upstream failure')});await runPhotoAI(env,Date.now()+2000,async()=>{calls++;return model()});assert.equal(calls,1);assert.equal((await photoAIView(env)).failed,1)});
test('daily image budget refuses paid work before calling model',async()=>{const {env,objects}=harness(1);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});const day=new Date().toISOString().slice(0,10);objects.set('_internal/photo-ai-v3/budgets/'+day,{etag:'budget',value:{reserved:PHOTO_AI_DAILY_MAX}});let calls=0;const result=await runPhotoAI(env,Date.now(),async()=>{calls++;return model()});assert.equal(calls,0);assert.equal(result.status,'budget');assert.equal((await photoAIView(env)).queued,1)});
test('a successful new daily reservation clears the previous day budget notice',async()=>{const {env,objects}=harness(1);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});objects.get('_internal/photo-ai-v3/state').value.error='Teto diário de 250 fotos atingido; a fila continua no próximo dia, sem gasto extra.';await runPhotoAI(env,Date.now(),model);assert.equal((await photoAIView(env)).error,undefined)});

test('partial paid usage is retained when visual review fails',async()=>{const {env,objects}=harness(1);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});await runPhotoAI(env,Date.now(),async()=>{throw Object.assign(Error('review timed out'),{estimatedCostUsd:.0004})});assert.equal((await photoAIView(env)).estimatedCostUsd,.0004);});
test('API authorization failure pauses remaining work instead of burning through the queue',async()=>{const {env,objects}=harness(2);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});let calls=0;await runPhotoAI(env,Date.now(),async()=>{calls++;throw Error('OpenAI HTTP 401: invalid_api_key')});await runPhotoAI(env,Date.now()+2000,async()=>{calls++;return model()});assert.equal(calls,1);assert.equal((await photoAIView(env)).enabled,false);});

test('an article unpublished after enqueue cannot start paid analysis',async()=>{const {env,objects}=harness(1);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});env.DB.prepare=()=>({bind(){return this},async first(){return null}});let calls=0;const result=await runPhotoAI(env,Date.now(),async()=>{calls++;return model()});assert.equal(calls,0);assert.equal(result.status,'unpublished');assert.equal((await photoAIView(env)).queued,0);});

test('concurrent runners cannot analyze the same photo or exceed four in flight',async()=>{const {env,objects,posts}=harness(1);posts[0].content=Array.from({length:6},(_,i)=>`<figure><img src="/img/p-${i}.png"></figure>`).join('');await startPhotoBackfill(env);for(let i=0;i<6;i++)objects.set('p-'+i+'.png',{etag:'image',value:{}});let active=0,max=0,calls=0,releases=[];const analyze=async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>releases.push(r));active--;return model()};const running=[];for(let i=0;i<6;i++){running.push(runPhotoAI(env,Date.now(),analyze));await new Promise(r=>setTimeout(r,15));}assert.equal(calls,4);assert.equal(max,4);for(const release of releases)release();await Promise.all(running);assert.equal((await photoAIView(env)).ready,4);assert.equal((await photoAIView(env)).queued,2);});

test('public cache is invalidated once for a fully processed article, not after each photo',async()=>{const {env,objects,posts}=harness(1);posts[0].content+='<figure><img src="/img/last.png"></figure>';await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});objects.set('last.png',{etag:'image',value:{}});let bumps=0;env.DB.prepare=()=>{let args=[];return {bind(...values){args=values;return this},async first(){return {value:args[0]==='photo.experiment'?JSON.stringify({enabled:true}):'1'}},async run(){if(args[0]==='cache.version')bumps++;return {success:true}}}};await runPhotoAI(env,Date.now(),model);assert.equal(bumps,0);await runPhotoAI(env,Date.now()+2000,async()=>({...await model(),shots:[]}));assert.equal(bumps,1);});

test('the last missing or oversized photo still invalidates ready maps exactly once',async()=>{for(const oversized of [false,true]){const {env,objects,posts}=harness(1);posts[0].content+='<figure><img src="/img/last.png"></figure>';await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});if(oversized){objects.set('last.png',{etag:'image',value:{}});const get=env.IMAGES.get;env.IMAGES.get=async key=>{const value=await get(key);return key==='last.png'?{...value,size:5000001}:value}}let bumps=0;env.DB.prepare=()=>{let args=[];return {bind(...values){args=values;return this},async first(){return {value:args[0]==='photo.experiment'?JSON.stringify({enabled:true}):'1'}},async run(){if(args[0]==='cache.version')bumps++;return {success:true}}}};await runPhotoAI(env,Date.now(),model);assert.equal(bumps,0);await runPhotoAI(env,Date.now()+2000,model);assert.equal(bumps,1);assert.equal((await photoAIView(env)).static,1);}});

test('confirmed analysis cost stays cumulative when photos are removed and restored',async()=>{const {env,objects,posts}=harness(1);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});objects.set('replacement.png',{etag:'image',value:{}});await runPhotoAI(env,Date.now(),model);posts[0].content='<figure><img src="/img/replacement.png"></figure>';await enqueuePhotoPost(env,posts[0]);assert.equal((await photoAIView(env)).estimatedCostUsd,.001);await runPhotoAI(env,Date.now()+2000,model);posts[0].content='<figure><img src="/img/source-0.png"></figure>';await enqueuePhotoPost(env,posts[0]);let calls=0;await runPhotoAI(env,Date.now()+4000,async()=>{calls++;return model()});assert.equal(calls,0);assert.equal((await photoAIView(env)).estimatedCostUsd,.002);});

test('new article cron processing is bounded to eight photos and stops on budget or contention',async()=>{let calls=0;await runScheduledPhotoAI({},async()=>{calls++;return {status:'ready'}});assert.equal(calls,8);for(const status of ['budget','limited','disabled','complete','error']){calls=0;await runScheduledPhotoAI({},async()=>{calls++;return {status}});assert.equal(calls,1);}});
test('approved composition revision requeues legacy maps once, retains costs and blocks repeat spend',async()=>{
 const {env,objects,posts}=harness(1);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});await runPhotoAI(env,Date.now(),model);
 const root='_internal/photo-ai-v3/',job=objects.get(root+'articles/1.json').value;
 delete job.composition;for(const image of job.images)delete image.composition;for(const map of Object.values(job.maps))delete map.composition;job.costs={'/img/source-0.png':.001};
 for(const key of [...objects.keys()].filter(k=>k.startsWith(root+'images/')))objects.delete(key);
 await enqueuePhotoPost(env,posts[0]);assert.equal((await photoAIView(env)).queued,1);assert.equal(Object.keys(objects.get(root+'articles/1.json').value.maps).length,0);
 let calls=0;await runPhotoAI(env,Date.now()+2000,async()=>{calls++;return model()});await enqueuePhotoPost(env,posts[0]);await runPhotoAI(env,Date.now()+4000,async()=>{calls++;return model()});
 assert.equal(calls,1);assert.equal((await photoAIView(env)).estimatedCostUsd,.002);assert.ok(objects.get(root+'articles/1.json').value.maps['/img/source-0.png'].composition);
});
test('discovery revises at most eight tracked older articles and invalidates legacy HTML only once',async()=>{
 const {env,objects,posts}=harness(12);await startPhotoBackfill(env);const root='_internal/photo-ai-v3/',older=[...posts],state=objects.get(root+'state').value;
 for(const a of state.articles){delete a.composition;const job=objects.get(root+'articles/'+a.id+'.json').value;delete job.composition;for(const i of job.images){i.status='ready';delete i.composition;job.maps[i.source]={shots:(await model()).shots,reviewedAt:Date.now()};}a.ready=1;}
 const recent=Array.from({length:20},(_,i)=>({...older[0],id:101+i,content:`<img src="/img/new-${i}.png">`}));let bumps=0;
 env.DB.prepare=sql=>{let args=[];return {bind(...v){args=v;return this},async all(){return {results:sql.includes('p.id IN')?older.filter(p=>args.includes(p.id)):recent}},async first(){return {value:'1'}},async run(){if(args[0]==='cache.version')bumps++;return {success:true}}}};
 const now=Date.now();await discoverPhotoPosts(env,now);const revised=()=>older.filter(p=>objects.get(root+'articles/'+p.id+'.json').value.images[0].status==='queued').length;
 assert.equal(revised(),8);assert.equal(bumps,1);await discoverPhotoPosts(env,now+1000);assert.equal(revised(),8);await discoverPhotoPosts(env,now+300001);assert.equal(revised(),12);assert.equal(bumps,1);
});

test('explicit traffic scope bypasses only the daily queue cap and never spends outside its fixed ids and sources',async()=>{
 const {env,objects,posts}=harness(2);posts[0].content+='<img src="/img/outside.png">';await startPhotoBackfill(env);
 for(const key of ['source-0.png','source-1.png','outside.png'])objects.set(key,{etag:'image',value:{}});
 const day=new Date().toISOString().slice(0,10);objects.set('_internal/photo-ai-v3/budgets/'+day,{etag:'daily',value:{reserved:250}});
 let reservations=0,calls=0;const scope={articleIds:[2],sources:['/img/source-1.png'],reserve:async source=>{assert.equal(source,'/img/source-1.png');reservations++;return true}};
 const run=()=>runPhotoAI(env,Date.now(),async()=>{assert.equal(reservations,1);calls++;return model()},scope);
 await run();await run();assert.equal(calls,1);assert.equal((await photoAIView(env)).ready,1);assert.equal((await photoAIView(env)).queued,2);
 assert.equal(objects.get('_internal/photo-ai-v3/budgets/'+day).value.reserved,250);
 scope.articleIds=[1];scope.reserve=async()=>false;assert.equal((await run()).status,'outside_scope');assert.equal(calls,1);
 scope.sources=['/img/source-0.png'];assert.equal((await run()).status,'batch_budget');assert.equal(calls,1);
});

test('fixed traffic batches allow up to twelve concurrent analyses while ordinary runs retain four',async()=>{
 const {env,objects,posts}=harness(1);posts[0].content=Array.from({length:13},(_,i)=>`<img src="/img/batch-${i}.png">`).join('');await startPhotoBackfill(env);
 for(let i=0;i<13;i++)objects.set('batch-'+i+'.png',{etag:'image',value:{}});
 let active=0,max=0,calls=0;const releases=[];const analyze=async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>releases.push(r));active--;return model()};
 const scope={articleIds:[1],sources:Array.from({length:13},(_,i)=>'/img/batch-'+i+'.png'),maxConcurrent:12,reserve:async()=>true};
 const pending=[];for(let i=0;i<13;i++){pending.push(runPhotoAI(env,Date.now(),analyze,scope));await new Promise(r=>setTimeout(r,5));}
 assert.equal(calls,12);assert.equal(max,12);for(const release of releases)release();await Promise.all(pending);assert.equal((await photoAIView(env)).queued,1);
});

test('partitioned traffic claims deduplicate a shared source before reserving any paid work',async()=>{
 const {env,objects,posts}=harness(1);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});
 let calls=0,reservations=0;const releases=[];const analyze=async()=>{calls++;await new Promise(r=>releases.push(r));return model()};
 const scope={articleIds:[1],sources:['/img/source-0.png'],holdLease:true,maxConcurrent:12,reserve:async()=>{assert.ok([...objects.keys()].some(k=>k.includes('/images/')&&objects.get(k).value.status==='processing'));reservations++;return true}};
 const pending=Array.from({length:12},(_,i)=>runPhotoAI(env,Date.now(),analyze,{...scope,leaseKey:'_internal/test-slot-'+i}));
 await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);assert.equal(reservations,1);releases.forEach(r=>r());await Promise.all(pending);
});

test('independent article leases permit real parallel work and block another owner of the same partition',async()=>{
 const {env,objects,posts}=harness(12);await startPhotoBackfill(env);for(let i=0;i<12;i++)objects.set('source-'+i+'.png',{etag:'image',value:{}});
 let active=0;const releases=[];const analyze=async()=>{active++;await new Promise(r=>releases.push(r));return model()};
 const scope=i=>({articleIds:[i+1],sources:['/img/source-'+i+'.png'],maxConcurrent:12,leaseKey:'_internal/partition-'+i,holdLease:true,reserve:async()=>true});
 const pending=posts.map((_,i)=>runPhotoAI(env,Date.now(),analyze,scope(i)));await new Promise(r=>setTimeout(r,30));assert.equal(active,12);
 assert.equal((await runPhotoAI(env,Date.now(),analyze,scope(0))).status,'limited');assert.equal(active,12);releases.forEach(r=>r());await Promise.all(pending);assert.equal((await photoAIView(env)).ready,12);
});

test('the source body is consumed before a batch claim opens more storage operations',async()=>{
 const {env,objects}=harness(1);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});let consumed=false;const get=env.IMAGES.get;
 env.IMAGES.get=async key=>{const o=await get(key);return key==='source-0.png'?{...o,arrayBuffer:async()=>{consumed=true;return new ArrayBuffer(4)}}:o};
 const scope={articleIds:[1],sources:['/img/source-0.png'],reserve:async()=>{assert.equal(consumed,true);return true}};
 assert.equal((await runPhotoAI(env,Date.now(),model,scope)).status,'ready');
});

test('an oversized image closes its body without reserving or calling the model',async()=>{
 const {env,objects}=harness(1);await startPhotoBackfill(env);objects.set('source-0.png',{etag:'image',value:{}});const get=env.IMAGES.get;let cancelled=false,calls=0;
 env.IMAGES.get=async key=>{const o=await get(key);return key==='source-0.png'?{...o,size:5000000,body:{cancel:async()=>{cancelled=true}}}:o};
 const result=await runPhotoAI(env,Date.now(),async()=>{calls++;return model()});assert.equal(result.status,'static');assert.equal(cancelled,true);assert.equal(calls,0);
});
