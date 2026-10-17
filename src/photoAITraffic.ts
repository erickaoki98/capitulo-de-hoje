import type {Env,Post} from './types';
import {PHOTO_AI_ROOT,validSource} from './photoMaps.ts';
import {enqueuePhotoPost,runPhotoAI} from './photoAI.ts';
import {publicPostVisibilitySql} from './archive.ts';
export const PHOTO_TRAFFIC_KEY=PHOTO_AI_ROOT+'traffic-batches/active';
interface TrafficBatch {id:string;day:string;createdAt:number;expiresAt:number;articleIds:number[];sources:string[];preparedIds:number[];reservedSources:string[];skippedIds:number[];status:'requested'|'preparing'|'active'|'complete';prepareUntil?:number;error?:string}
const options={httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}};
function valid(x:TrafficBatch):boolean{return !!x&&/^[a-z0-9-]{1,80}$/.test(x.id)&&/^\d{4}-\d{2}-\d{2}$/.test(x.day)&&Number.isFinite(x.createdAt)&&Number.isFinite(x.expiresAt)&&x.expiresAt>x.createdAt&&x.expiresAt<=x.createdAt+6*3600000&&Array.isArray(x.articleIds)&&x.articleIds.length>0&&x.articleIds.length<=500&&new Set(x.articleIds).size===x.articleIds.length&&x.articleIds.every(i=>Number.isSafeInteger(i)&&i>0)&&Array.isArray(x.sources)&&x.sources.length<=4000&&new Set(x.sources).size===x.sources.length&&x.sources.every(validSource)&&Array.isArray(x.preparedIds)&&x.preparedIds.every(i=>x.articleIds.includes(i))&&Array.isArray(x.skippedIds)&&x.skippedIds.every(i=>x.articleIds.includes(i))&&Array.isArray(x.reservedSources)&&x.reservedSources.length<=x.sources.length&&new Set(x.reservedSources).size===x.reservedSources.length&&x.reservedSources.every(s=>x.sources.includes(s))&&['requested','preparing','active','complete'].includes(x.status);}
async function read(env:Env){const o=await env.IMAGES.get(PHOTO_TRAFFIC_KEY);if(!o)return null;const batch=await o.json<TrafficBatch>();if(!valid(batch))throw Error('Manifesto do lote inválido.');return {o,batch};}
async function change(env:Env,id:string,fn:(b:TrafficBatch)=>boolean){for(let i=0;i<6;i++){const item=await read(env);if(!item||item.batch.id!==id||!fn(item.batch))return false;const saved=await env.IMAGES.put(PHOTO_TRAFFIC_KEY,JSON.stringify(item.batch),{...options,onlyIf:{etagMatches:item.o.etag}});if(saved)return true;}return false;}
export async function photoTrafficView(env:Env){const item=await read(env);if(!item)return null;const b=item.batch;const state=await env.IMAGES.get(PHOTO_AI_ROOT+'state');const data=state?await state.json<{articles:{id:number;total:number;ready:number;static:number;failed:number;processing:number;cost:number}[]}>():null;const selected=(data?.articles||[]).filter(a=>b.articleIds.includes(a.id));const sum=(key:'total'|'ready'|'static'|'failed'|'processing'|'cost')=>selected.reduce((n,a)=>n+a[key],0);return {ready:sum('ready'),static:sum('static'),failed:sum('failed'),processing:sum('processing'),queued:Math.max(0,sum('total')-sum('ready')-sum('static')-sum('failed')-sum('processing')),estimatedCostUsd:sum('cost'),id:b.id,day:b.day,status:b.status,articles:b.articleIds.length,images:b.sources.length,prepared:b.preparedIds.length,reserved:b.reservedSources.length,maxReservedUsd:b.sources.length*.02,expiresAt:b.expiresAt,skipped:b.skippedIds.length,error:b.error};}
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
export async function runPhotoTraffic(env:Env,now=Date.now(),run:typeof runPhotoAI=runPhotoAI){
 const item=await read(env);if(!item)return {status:'not_prepared'};const b=item.batch;
 if(b.status==='complete')return {status:'complete'};
 if(now>b.expiresAt)return {status:'expired'};
 if(b.status!=='active')return {status:'preparing'};
 const result=await run(env,now,undefined,{articleIds:b.articleIds.filter(id=>!b.skippedIds.includes(id)),sources:b.sources,maxConcurrent:12,reserve:source=>change(env,b.id,x=>{if(x.status!=='active'||Date.now()>x.expiresAt||x.reservedSources.length>=x.sources.length||!x.sources.includes(source)||x.reservedSources.includes(source))return false;x.reservedSources.push(source);return true;})});
 if(result.status==='complete')await change(env,b.id,x=>{x.status='complete';return true;});
 if(result.status==='outside_scope'&&result.articleId){await change(env,b.id,x=>{x.skippedIds=[...new Set([...x.skippedIds,result.articleId!])];return true;});return {...result,status:'reconciled'};}
 return result;
}
