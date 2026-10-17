import type {Env,Post} from './types';
import {PHOTO_AI_ROOT,PHOTO_AI_VERSION,validSource} from './photoMaps.ts';
import {enqueuePhotoPost,runPhotoAI,requeuePhotoConnectionFailure} from './photoAI.ts';
import {publicPostVisibilitySql} from './archive.ts';
export const PHOTO_TRAFFIC_KEY=PHOTO_AI_ROOT+'traffic-batches/active';
interface TrafficBatch {id:string;day:string;createdAt:number;expiresAt:number;articleIds:number[];sources:string[];preparedIds:number[];reservedSources:string[];skippedIds:number[];status:'requested'|'preparing'|'active'|'complete';connectionRecovery?:'requested'|'complete';recoverySources?:string[];recoveredSources?:string[];completedSlots?:number[];lastScheduledMinute?:number;prepareUntil?:number;error?:string}
const options={httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}};
function valid(x:TrafficBatch):boolean{return !!x&&/^[a-z0-9-]{1,80}$/.test(x.id)&&/^\d{4}-\d{2}-\d{2}$/.test(x.day)&&Number.isFinite(x.createdAt)&&Number.isFinite(x.expiresAt)&&x.expiresAt>x.createdAt&&x.expiresAt<=x.createdAt+6*3600000&&Array.isArray(x.articleIds)&&x.articleIds.length>0&&x.articleIds.length<=500&&new Set(x.articleIds).size===x.articleIds.length&&x.articleIds.every(i=>Number.isSafeInteger(i)&&i>0)&&Array.isArray(x.sources)&&x.sources.length<=4000&&new Set(x.sources).size===x.sources.length&&x.sources.every(validSource)&&Array.isArray(x.preparedIds)&&x.preparedIds.every(i=>x.articleIds.includes(i))&&Array.isArray(x.skippedIds)&&x.skippedIds.every(i=>x.articleIds.includes(i))&&Array.isArray(x.reservedSources)&&x.reservedSources.length<=x.sources.length&&new Set(x.reservedSources).size===x.reservedSources.length&&x.reservedSources.every(s=>x.sources.includes(s))&&(!x.connectionRecovery||['requested','complete'].includes(x.connectionRecovery))&&(!x.recoverySources||Array.isArray(x.recoverySources)&&x.recoverySources.length<=100&&new Set(x.recoverySources).size===x.recoverySources.length&&x.recoverySources.every(s=>x.sources.includes(s)))&&(!x.recoveredSources||Array.isArray(x.recoveredSources)&&new Set(x.recoveredSources).size===x.recoveredSources.length&&x.recoveredSources.every(s=>x.recoverySources?.includes(s)))&&x.reservedSources.length+(x.recoveredSources?.length||0)<=x.sources.length&&(!x.completedSlots||Array.isArray(x.completedSlots)&&x.completedSlots.every(i=>Number.isInteger(i)&&i>=0&&i<Math.min(12,x.articleIds.length)))&&['requested','preparing','active','complete'].includes(x.status);}
async function read(env:Env){const o=await env.IMAGES.get(PHOTO_TRAFFIC_KEY);if(!o)return null;const batch=await o.json<TrafficBatch>();if(!valid(batch))throw Error('Manifesto do lote inválido.');return {o,batch};}
async function change(env:Env,id:string,fn:(b:TrafficBatch)=>boolean){for(let i=0;i<24;i++){const item=await read(env);if(!item||item.batch.id!==id||!fn(item.batch))return false;const saved=await env.IMAGES.put(PHOTO_TRAFFIC_KEY,JSON.stringify(item.batch),{...options,onlyIf:{etagMatches:item.o.etag}});if(saved)return true;}return false;}
export async function photoTrafficView(env:Env){const item=await read(env);if(!item)return null;const b=item.batch;const state=await env.IMAGES.get(PHOTO_AI_ROOT+'state');const data=state?await state.json<{articles:{id:number;total:number;ready:number;static:number;failed:number;processing:number;cost:number}[]}>():null;const selected=(data?.articles||[]).filter(a=>b.articleIds.includes(a.id));const sum=(key:'total'|'ready'|'static'|'failed'|'processing'|'cost')=>selected.reduce((n,a)=>n+a[key],0);return {ready:sum('ready'),static:sum('static'),failed:sum('failed'),processing:sum('processing'),queued:Math.max(0,sum('total')-sum('ready')-sum('static')-sum('failed')-sum('processing')),estimatedCostUsd:sum('cost'),id:b.id,day:b.day,status:b.status,articles:b.articleIds.length,images:b.sources.length,prepared:b.preparedIds.length,reserved:b.reservedSources.length+(b.recoveredSources?.length||0),recoveries:b.recoveredSources?.length||0,maxReservedUsd:b.sources.length*.02,expiresAt:b.expiresAt,skipped:b.skippedIds.length,error:b.error};}
/** Private manifest is written by the authorized operator; GET never creates work. */
export async function preparePhotoTraffic(env:Env,now=Date.now(),enqueue:typeof enqueuePhotoPost=enqueuePhotoPost){
 const item=await read(env);if(!item)return null;const b=item.batch;
 if(now>b.expiresAt)return {...await photoTrafficView(env),status:'expired'};
 if(b.status==='active'||b.status==='complete')return photoTrafficView(env);
 if(!await change(env,b.id,x=>{if(x.status==='active'||x.status==='complete'||(x.prepareUntil||0)>now)return false;x.prepareUntil=now+120000;x.status='preparing';return true;}))return photoTrafficView(env);
 try{
  const ids=b.articleIds.filter(id=>!b.preparedIds.includes(id)).slice(0,8);
  const since=Date.parse(b.day+'T03:00:00Z')-10*86400000;
  const posts=ids.length?await env.DB.prepare(`SELECT p.* FROM posts p WHERE p.id IN (${ids.map(()=>'?').join(',')}) AND p.pub_date>=? AND p.pub_date<=? AND ${publicPostVisibilitySql('p')}`).bind(...ids,since,b.createdAt).all<Post>():{results:[] as Post[]};
  for(const id of ids){const post=posts.results?.find(p=>p.id===id);if(post)await enqueue(env,post,true);}
  await change(env,b.id,x=>{x.preparedIds=[...new Set([...x.preparedIds,...ids])];x.skippedIds=[...new Set([...x.skippedIds,...ids.filter(id=>!posts.results?.some(p=>p.id===id))])];x.prepareUntil=0;if(x.preparedIds.length===x.articleIds.length)x.status='active';delete x.error;return true;});
 }catch(e){await change(env,b.id,x=>{x.prepareUntil=0;x.error='Falha ao preparar o lote; nenhuma nova chamada de IA nesta etapa.';return true;});throw e;}
 return photoTrafficView(env);
}
/** Additional paid work is restricted to this fixed, expiring list and one reservation per source. */
export async function runPhotoTraffic(env:Env,now=Date.now(),run:typeof runPhotoAI=runPhotoAI,random=Math.random,forcedSlot?:number){
 const item=await read(env);if(!item)return {status:'not_prepared'};const b=item.batch;
 if(b.status==='complete')return {status:'complete'};
 if(now>b.expiresAt)return {status:'expired'};
 if(b.status!=='active'||b.connectionRecovery==='requested')return {status:'preparing'};
 const slots=Math.min(12,b.articleIds.length),available=Array.from({length:slots},(_,i)=>i).filter(i=>!b.completedSlots?.includes(i));
 if(!available.length)return {status:'complete'};
 if(forcedSlot!==undefined&&!available.includes(forcedSlot))return {status:'reconciled'};
 const slot=forcedSlot??available[Math.min(available.length-1,Math.floor(random()*available.length))];
 const result=await run(env,now,undefined,{articleIds:b.articleIds.filter((id,i)=>i%slots===slot&&!b.skippedIds.includes(id)),sources:b.sources,maxConcurrent:12,leaseKey:PHOTO_AI_ROOT+'traffic-batches/'+b.id+'/slot-'+slot,holdLease:true,reserve:source=>change(env,b.id,x=>{if(x.status!=='active'||x.connectionRecovery==='requested'||Date.now()>x.expiresAt||x.reservedSources.length+(x.recoveredSources?.length||0)>=x.sources.length||!x.sources.includes(source))return false;if(x.reservedSources.includes(source)){if(!x.recoverySources?.includes(source)||x.recoveredSources?.includes(source))return false;(x.recoveredSources??=[]).push(source);}else x.reservedSources.push(source);return true;})});
 if(result.status==='complete'){await change(env,b.id,x=>{x.completedSlots=[...new Set([...(x.completedSlots||[]),slot])];if(x.completedSlots.length===slots)x.status='complete';return true;});return {status:(await photoTrafficView(env))?.status==='complete'?'complete':'reconciled'};}
 if(result.status==='outside_scope'&&result.articleId){await change(env,b.id,x=>{x.skippedIds=[...new Set([...x.skippedIds,result.articleId!])];return true;});return {...result,status:'reconciled'};}
 return result;
}

/** Fixed expiring batch only: one cron reservation/minute, at most four concurrent calls. */
export async function runScheduledPhotoTraffic(env:Env,now=Date.now(),run:typeof runPhotoTraffic=runPhotoTraffic):Promise<boolean>{
 const before=await read(env);if(before?.batch.connectionRecovery==='requested'&&now<=before.batch.expiresAt)await recoverPhotoTrafficConnections(env,now);
 const item=await read(env);if(!item||item.batch.status!=='active'||now>item.batch.expiresAt)return false;
 const b=item.batch,minute=Math.floor(now/60000);
 if(!await change(env,b.id,x=>{if(x.status!=='active'||now>x.expiresAt||(x.lastScheduledMinute??-1)>=minute)return false;x.lastScheduledMinute=minute;return true;}))return true;
 const count=Math.min(12,b.articleIds.length);
 for(let start=0;start<2*count;start+=4)await Promise.allSettled(Array.from({length:Math.min(4,2*count-start)},(_,i)=>run(env,Date.now(),undefined,Math.random,(start+i)%count)));
 return true;
}

/** One explicit, bounded infrastructure recovery; previous failures are archived before reset. */
export async function recoverPhotoTrafficConnections(env:Env,now=Date.now()){
 const item=await read(env);if(!item)return null;const b=item.batch;
 if(b.connectionRecovery!=='requested'||now>b.expiresAt)return photoTrafficView(env);
 if(!await change(env,b.id,x=>{if(x.connectionRecovery!=='requested'||(x.prepareUntil||0)>now)return false;x.status='preparing';x.prepareUntil=now+600000;return true;}))return photoTrafficView(env);
 try{
  const stateObject=await env.IMAGES.get(PHOTO_AI_ROOT+'state');const state=stateObject?await stateObject.json<{articles:{id:number;failed:number}[]}>():null;
  const selected=(state?.articles||[]).filter(a=>a.failed>0&&b.articleIds.includes(a.id));const prepared=new Set(b.recoverySources||[]);
  for(const a of selected){
   const object=await env.IMAGES.get(PHOTO_AI_ROOT+'articles/'+a.id+'.json');if(!object)continue;
   const job=await object.json<{images:{source:string;status:string;reason?:string;cost:number}[]}>();
   for(const image of job.images){
    if(prepared.size>=100&&!prepared.has(image.source))continue;
    if(image.status!=='failed'||image.reason!=='Response closed due to connection limit'||image.cost!==0||!b.sources.includes(image.source))continue;
    const key=PHOTO_AI_ROOT+'images/'+PHOTO_AI_VERSION+'/'+image.source.slice(5)+'.json';const backupKey=PHOTO_AI_ROOT+'traffic-batches/'+b.id+'/connection-errors/'+image.source.slice(5)+'.json';
    const cachedObject=await env.IMAGES.get(key);const cached=cachedObject?await cachedObject.json<{status:string;error?:string;partialCost?:number;at:number}>():null;
    if(cached&&(cached.status!=='failed'||cached.error!=='Response closed due to connection limit'||(cached.partialCost||0)!==0))continue;
    let archive=await env.IMAGES.get(backupKey);if(!archive&&cached){await env.IMAGES.put(backupKey,JSON.stringify(cached),{...options,onlyIf:{etagDoesNotMatch:'*'}});archive=await env.IMAGES.get(backupKey);}
    if(!archive)continue;const original=await archive.json<{at:number}>();if(cached&&cached.at!==original.at)continue;
    if(!await change(env,b.id,x=>{x.recoverySources=[...new Set([...(x.recoverySources||[]),image.source])];x.completedSlots=(x.completedSlots||[]).filter(slot=>slot!==x.articleIds.indexOf(a.id)%Math.min(12,x.articleIds.length));return x.recoverySources.length<=100;}))throw Error('Reserva de recuperação ocupada.');
    if(cached)await env.IMAGES.delete(key);
    await requeuePhotoConnectionFailure(env,a.id,image.source);prepared.add(image.source);
   }
  }
  await change(env,b.id,x=>{x.connectionRecovery='complete';x.status='active';x.prepareUntil=0;delete x.error;return true;});
 }catch(e){await change(env,b.id,x=>{x.prepareUntil=0;x.error='Falha na recuperação de conexão; execução paga suspensa nesta etapa.';return true;});throw e;}
 return photoTrafficView(env);
}
