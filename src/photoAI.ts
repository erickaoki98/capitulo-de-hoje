import type {Env,Post} from './types';
import {articlePhotoSources,PHOTO_AI_ROOT,parseShots,type PhotoMaps} from './photoMaps.ts';
import {analyzePhoto,PHOTO_AI_VERSION,type PhotoAIResult} from './photoAIModel.ts';
import {bumpCacheVersion} from './cache.ts';
import {publicPostVisibilitySql} from './archive.ts';
import {getSetting} from './db';
import {parsePhotoConfig} from './photoExperiment.ts';
export const PHOTO_AI_DAILY_MAX=250;
const STATE=PHOTO_AI_ROOT+'state',LEASE=PHOTO_AI_ROOT+'lease';
type Status='queued'|'processing'|'ready'|'static'|'failed';
interface ImageJob {source:string;status:Status;at:number;cost:number;reason?:string;composition?:string}
interface ArticleJob {id:number;slug:string;title:string;images:ImageJob[];maps:PhotoMaps;updatedAt:number;costs?:Record<string,number>;composition?:string}
interface ArticleStats {id:number;slug:string;total:number;ready:number;static:number;failed:number;processing:number;cost:number;updatedAt:number;composition?:string}
interface State {enabled:boolean;seededAt:number;backfillIds:number[];articles:ArticleStats[];nextDiscoveryAt:number;lastUpdated:number;error?:string;composition?:string}
export interface PhotoAIView {enabled:boolean;totalArticles:number;totalImages:number;queued:number;processing:number;ready:number;static:number;failed:number;estimatedCostUsd:number;lastUpdated:number;error?:string;backfillArticles:number}
const initial=():State=>({enabled:false,seededAt:0,backfillIds:[],articles:[],nextDiscoveryAt:0,lastUpdated:0});
const privateOptions={httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}};
async function read<T>(env:Env,key:string):Promise<T|null>{const o=await env.IMAGES.get(key);return o?o.json<T>():null;}
async function mutate(env:Env,fn:(state:State)=>void):Promise<State>{for(let i=0;i<24;i++){const old=await env.IMAGES.get(STATE),state=old?await old.json<State>():initial();fn(state);state.lastUpdated=Date.now();const saved=await env.IMAGES.put(STATE,JSON.stringify(state),{...privateOptions,onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'}});if(saved)return state;}throw Error('Fila ocupada; tente novamente.');}
function stats(job:ArticleJob):ArticleStats{return {id:job.id,slug:job.slug,total:job.images.length,ready:job.images.filter(i=>i.status==='ready').length,static:job.images.filter(i=>i.status==='static').length,failed:job.images.filter(i=>i.status==='failed').length,processing:job.images.filter(i=>i.status==='processing').length,cost:job.costs?Object.values(job.costs).reduce((n,c)=>n+c,0):job.images.reduce((n,i)=>n+i.cost,0),updatedAt:job.updatedAt,composition:job.composition};}
async function changeJob(env:Env,id:number,change:(old:ArticleJob|null)=>ArticleJob|null):Promise<ArticleJob|null>{
  const key=PHOTO_AI_ROOT+'articles/'+id+'.json';
  for(let attempt=0;attempt<6;attempt++){
    const object=await env.IMAGES.get(key),old=object?await object.json<ArticleJob>():null,job=change(old);if(!job)return null;
    job.updatedAt=Math.max(Date.now(),(old?.updatedAt||0)+1);
    const saved=await env.IMAGES.put(key,JSON.stringify(job),{...privateOptions,onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:'*'}});if(!saved)continue;
    await mutate(env,state=>{const summary=stats(job),i=state.articles.findIndex(a=>a.id===id);if(i<0)state.articles.push(summary);else if((state.articles[i].updatedAt||0)<=summary.updatedAt)state.articles[i]=summary;});return job;
  }throw Error('Artigo da fila ocupado; nova descoberta atualizará as fotos.');
}
async function saveProgress(env:Env,job:ArticleJob,image:ImageJob):Promise<ArticleJob|null>{
  const completed=await changeJob(env,job.id,latest=>{
    if(!latest||latest.composition!==job.composition)return null;
    latest.costs??=Object.fromEntries(latest.images.filter(i=>i.cost>0).map(i=>[i.source,i.cost]));
    const costKey=PHOTO_AI_VERSION+':'+image.source;
    if(image.cost>0)latest.costs[costKey]=Math.max(latest.costs[costKey]||0,image.cost);
    const index=latest.images.findIndex(i=>i.source===image.source);if(index<0)return latest;
    latest.images[index]={...image};
    if(job.maps[image.source])latest.maps[image.source]=job.maps[image.source];else delete latest.maps[image.source];return latest;
  });
  // Preparation invalidates once at launch; future articles invalidate once fully processed.
  if(completed&&Object.keys(completed.maps).length&&completed.images.every(i=>i.status!=='queued'&&i.status!=='processing')&&parsePhotoConfig(await getSetting(env.DB,'photo.experiment')).enabled)await bumpCacheVersion(env);
  return completed;
}
/** Publication updates preserve concurrently completed analyses through an R2 conditional write. */
export async function enqueuePhotoPost(env:Env,post:Pick<Post,'id'|'slug'|'title'|'content'|'draft'>,force=false):Promise<void>{
  if(post.draft)return;const state=await read<State>(env,STATE);if(!force&&!state?.enabled)return;
  const sources=articlePhotoSources(post.content);
  await changeJob(env,post.id,old=>{
    const stale=(i:ImageJob)=>i.composition!==PHOTO_AI_VERSION&&['ready','processing'].includes(i.status)||i.status==='ready'&&old?.maps[i.source]?.composition!==PHOTO_AI_VERSION;
    if(old&&old.composition===PHOTO_AI_VERSION&&old.images.map(i=>i.source).join('\n')===sources.join('\n')&&!old.images.some(i=>i.reason==='Artigo fora de publicação.'||stale(i)))return null;
    return {id:post.id,slug:post.slug,title:post.title,composition:PHOTO_AI_VERSION,costs:old?.costs??Object.fromEntries((old?.images||[]).filter(i=>i.cost>0).map(i=>[i.source,i.cost])),images:sources.map(source=>{const previous=old?.images.find(i=>i.source===source);return previous&&previous.reason!=='Artigo fora de publicação.'&&!stale(previous)?{...previous,composition:PHOTO_AI_VERSION}:{source,status:'queued',at:Date.now(),cost:0,composition:PHOTO_AI_VERSION};}),maps:Object.fromEntries(Object.entries(old?.maps||{}).filter(([source,map])=>sources.includes(source)&&map.composition===PHOTO_AI_VERSION)),updatedAt:Date.now()};
  });
}
async function acquire(env:Env,key:string,now:number,ms:number):Promise<string|null>{const old=await env.IMAGES.get(key),previous=old?await old.json<{until:number}>():null;if(previous&&previous.until>now)return null;const value=await env.IMAGES.put(key,JSON.stringify({until:now+ms,nonce:crypto.randomUUID()}),{...privateOptions,onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'}});return value?.etag||null;}
/** One immutable seed snapshot; retries only finish enqueueing the same ids, never choose another thirty. */
export async function startPhotoBackfill(env:Env):Promise<PhotoAIView>{
  const lock=await acquire(env,PHOTO_AI_ROOT+'seed-lease',Date.now(),60000);if(!lock)return photoAIView(env);
  try{
    let state=await read<State>(env,STATE);
    const posts=state?.seededAt
      ? await env.DB.prepare(`SELECT p.* FROM posts AS p WHERE p.id IN (${state.backfillIds.map(()=>'?').join(',')||'NULL'}) AND ${publicPostVisibilitySql('p')}`).bind(...state.backfillIds).all<Post>()
      : await env.DB.prepare(`SELECT p.* FROM posts AS p INDEXED BY idx_posts_pub_date WHERE ${publicPostVisibilitySql('p')} ORDER BY p.pub_date DESC LIMIT 30`).all<Post>();
    if(!state?.seededAt)state=await mutate(env,s=>{s.seededAt=Date.now();s.backfillIds=(posts.results||[]).map(p=>p.id);});
    for(const post of posts.results||[])if(state.backfillIds.includes(post.id))await enqueuePhotoPost(env,post,true);
    await mutate(env,s=>{s.enabled=true;delete s.error;});return photoAIView(env);
  }finally{await env.IMAGES.put(PHOTO_AI_ROOT+'seed-lease',JSON.stringify({until:0}),{...privateOptions,onlyIf:{etagMatches:lock}});}
}
/** Five-minute global discovery budget. Existing article hashes make this read-only unless sources change. */
export async function discoverPhotoPosts(env:Env,now=Date.now()):Promise<void>{
  const state=await read<State>(env,STATE);if(!state?.enabled)return;
  const lock=await acquire(env,PHOTO_AI_ROOT+'discovery',now,300000);if(!lock)return;
  if(state.composition!==PHOTO_AI_VERSION){await bumpCacheVersion(env);await mutate(env,s=>{s.composition=PHOTO_AI_VERSION;});}
  const posts=await env.DB.prepare(`SELECT p.* FROM posts AS p INDEXED BY idx_posts_pub_date WHERE ${publicPostVisibilitySql('p')} ORDER BY p.pub_date DESC LIMIT 30`).all<Post>();
  for(const post of posts.results||[])await enqueuePhotoPost(env,post);
  // Eight tracked older articles per discovery; preserve the original seed and never scan history.
  const legacy=state.articles.filter(a=>a.composition!==PHOTO_AI_VERSION&&!(posts.results||[]).some(p=>p.id===a.id)).slice(0,8).map(a=>a.id);
  if(legacy.length){const older=await env.DB.prepare(`SELECT p.* FROM posts AS p WHERE p.id IN (${legacy.map(()=>'?').join(',')}) AND ${publicPostVisibilitySql('p')}`).bind(...legacy).all<Post>();for(const post of older.results||[])await enqueuePhotoPost(env,post);const found=new Set((older.results||[]).map(p=>p.id));await mutate(env,s=>{for(const a of s.articles)if(legacy.includes(a.id)&&!found.has(a.id))a.composition=PHOTO_AI_VERSION;});}
}
export async function photoAIView(env:Env):Promise<PhotoAIView>{
  const state=await read<State>(env,STATE)||initial(),sum=(key:'total'|'ready'|'static'|'failed'|'processing'|'cost')=>state.articles.reduce((n,a)=>n+a[key],0);
  const total=sum('total'),ready=sum('ready'),still=sum('static'),failed=sum('failed'),processing=sum('processing');
  return {enabled:state.enabled,totalArticles:state.articles.length,totalImages:total,queued:Math.max(0,total-ready-still-failed-processing),processing,ready,static:still,failed,estimatedCostUsd:sum('cost'),lastUpdated:state.lastUpdated,error:state.error,backfillArticles:state.backfillIds.length};
}
async function reserveDaily(env:Env,now:number){const key=PHOTO_AI_ROOT+'budgets/'+new Date(now).toISOString().slice(0,10),old=await env.IMAGES.get(key),budget=old?await old.json<{reserved:number}>():{reserved:0};if(budget.reserved>=PHOTO_AI_DAILY_MAX)return false;return !!await env.IMAGES.put(key,JSON.stringify({reserved:budget.reserved+1,reservedUsd:(budget.reserved+1)*.02,maxImages:PHOTO_AI_DAILY_MAX,maxReservedUsd:PHOTO_AI_DAILY_MAX*.02}),{...privateOptions,onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'}});}
interface CachedImage {status:'processing'|'ready'|'static'|'failed';owner:number;at:number;result?:PhotoAIResult;error?:string;partialCost?:number}
export interface PhotoAIRunScope {articleIds:number[];sources:string[];maxConcurrent?:number;leaseKey?:string;holdLease?:boolean;reserve:(source:string)=>Promise<boolean>}
/** Bounded processor with serialized claims and four normal analyses or the bounded authorized batch scope. Reservations survive errors and expired executions; uncertain API calls are never repeated. */
export async function runPhotoAI(env:Env,now=Date.now(),analyze:typeof analyzePhoto=analyzePhoto,scope?:PhotoAIRunScope):Promise<{status:string;source?:string;articleId?:number;view?:PhotoAIView}>{
  const state=await read<State>(env,STATE);if(!state?.enabled)return {status:'disabled'};if(!env.OPENAI_API_KEY)return {status:'not_configured'};
  const leaseKey=scope?.leaseKey||LEASE;
  const lock=await acquire(env,leaseKey,now,180000);if(!lock)return {status:'limited'};
  let released=false;
  try{
    const fresh=await read<State>(env,STATE);if(!fresh?.enabled)return {status:'disabled'};
    const pending=fresh.articles.filter(a=>a.total>a.ready+a.static+a.failed&&(!scope||scope.articleIds.includes(a.id)));
    if(scope)pending.sort((a,b)=>scope.articleIds.indexOf(a.id)-scope.articleIds.indexOf(b.id));
    if(!pending.length)return {status:'complete'};
    const processing=fresh.articles.reduce((n,a)=>n+a.processing,0);
    const stale=pending.find(a=>a.processing>0&&a.updatedAt<now-180000);
    const concurrency=scope?Math.min(12,Math.max(1,Math.floor(scope.maxConcurrent||4))):4;
    if(processing>=concurrency&&!stale)return {status:'limited'};
    const next=stale||pending.find(a=>a.total>a.ready+a.static+a.failed+a.processing)||pending[0];
    const job=await read<ArticleJob>(env,PHOTO_AI_ROOT+'articles/'+next.id+'.json');if(!job)throw Error('Artigo da fila não encontrado.');
    const scopedImages=scope?job.images.filter(i=>scope.sources.includes(i.source)):job.images;
    const image=scopedImages.find(i=>i.status==='processing'&&i.at<now-180000)||scopedImages.find(i=>i.status==='queued')||scopedImages.find(i=>i.status==='processing');if(!image)return {status:scope?'outside_scope':'reconciled',articleId:job.id};
    const cacheKey=PHOTO_AI_ROOT+'images/'+PHOTO_AI_VERSION+'/'+image.source.slice(5)+'.json';let cached=await read<CachedImage>(env,cacheKey);
    if(cached?.status==='processing'&&cached.at>now-180000)return {status:'limited'};
    if(!cached){
      const published=await env.DB.prepare(`SELECT p.id FROM posts AS p WHERE p.id=? AND ${publicPostVisibilitySql('p')}`).bind(job.id).first();
      if(!published){await changeJob(env,job.id,latest=>{if(!latest)return null;for(const pending of latest.images)if(pending.status==='queued'||pending.status==='processing'){pending.status='static';pending.reason='Artigo fora de publicação.';}return latest;});return {status:'unpublished'};}
      const source=await env.IMAGES.get(image.source.slice(5));if(!source){image.status='static';image.reason='Imagem local ainda indisponível.';await saveProgress(env,job,image);return {status:'static',source:image.source};}
      if((source as any).size>4000000){image.status='static';image.reason='Imagem acima do limite de análise.';await saveProgress(env,job,image);return {status:'static',source:image.source};}
      if(!scope&&!await reserveDaily(env,now)){await mutate(env,s=>{s.error='Teto diário de 250 fotos atingido; a fila continua no próximo dia, sem gasto extra.';});return {status:'budget'};}
      cached={status:'processing',owner:job.id,at:now};const reservation=await env.IMAGES.put(cacheKey,JSON.stringify(cached),{...privateOptions,onlyIf:{etagDoesNotMatch:'*'}});if(!reservation)return {status:'limited'};
      // Independent batch partitions must win the source claim before reserving spend.
      if(scope&&!await scope.reserve(image.source)){
        cached={...cached,status:'failed',error:'Reserva anterior sem resultado confirmado; análise não repetida.'};await env.IMAGES.put(cacheKey,JSON.stringify(cached),privateOptions);
        image.status='failed';image.reason=cached.error;image.at=now;await saveProgress(env,job,image);return {status:'batch_budget',source:image.source};
      }
      if(fresh.error?.startsWith('Teto diário'))await mutate(env,s=>{if(s.error?.startsWith('Teto diário'))delete s.error;});
      image.status='processing';image.at=now;await saveProgress(env,job,image);
      // The global lease serializes claims; the scope bounds concurrent persisted jobs (four normally).
      if(!scope?.holdLease){await env.IMAGES.put(leaseKey,JSON.stringify({until:0}),{...privateOptions,onlyIf:{etagMatches:lock}});released=true;}
      try{
        const result=await analyze(await source.arrayBuffer(),env.OPENAI_API_KEY);
        const shots=result.shots.length>=2?parseShots(result.shots):null;
        if(result.shots.length>=2&&!shots)throw Error('A IA retornou enquadramentos inválidos.');
        cached={...cached,status:shots?'ready':'static',result};
      }catch(error){
        const message=error instanceof Error?error.message.slice(0,180):'Falha na análise.';
        cached={...cached,status:'failed',error:message,partialCost:Math.max(0,Number((error as any)?.estimatedCostUsd)||0)};
        if(/OpenAI HTTP (401|403|404|429)/.test(message))await mutate(env,s=>{s.enabled=false;s.error='A fila foi pausada após falha de acesso ou limite da API. '+message;});
      }
      await env.IMAGES.put(cacheKey,JSON.stringify(cached),privateOptions);
    }
    if(cached.status==='processing')cached={...cached,status:'failed',error:'Execução anterior interrompida; chamada não repetida para evitar cobrança duplicada.'};
    image.status=cached.status;image.at=Date.now();image.composition=PHOTO_AI_VERSION;image.cost=cached.owner===job.id?(cached.result?.estimatedCostUsd||cached.partialCost||0):0;image.reason=cached.error||cached.result?.reason;
    if(cached.status==='ready'&&cached.result){const shots=parseShots(cached.result.shots);if(shots)job.maps[image.source]={shots,reviewedAt:Date.now(),composition:PHOTO_AI_VERSION};else{image.status='failed';image.reason='Mapa inválido.';}}
    else delete job.maps[image.source];
    await saveProgress(env,job,image);
    return {status:image.status,source:image.source,view:await photoAIView(env)};
  }catch(error){await mutate(env,s=>{s.error=error instanceof Error?error.message.slice(0,180):'Falha na fila.';});return {status:'error'};}
  finally{if(!released)await env.IMAGES.put(leaseKey,JSON.stringify({until:0}),{...privateOptions,onlyIf:{etagMatches:lock}});}
}
/** Scheduled events have a longer execution window than publication waitUntil. Never drain without a bound. */
export async function runScheduledPhotoAI(env:Env,run:typeof runPhotoAI=runPhotoAI):Promise<void>{
  for(let i=0;i<8;i++){
    const result=await run(env);
    if(!['ready','static','failed','unpublished','reconciled'].includes(result.status))break;
  }
}
