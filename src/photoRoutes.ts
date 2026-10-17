import {photoAIView} from './photoAI.ts';
import type { Env } from './types';
import { getSetting, setSetting } from './db';
import { getSessionFromRequest } from './auth';
import { bumpCacheVersion } from './cache';
import { callbackUrl, digest, randomToken, seal } from './adsenseReports.ts';
import { parsePhotoConfig, type PhotoExperimentConfig } from './photoExperiment.ts';
import { ANALYTICS_SCOPE, photoReportsConfigured, photoReportsView, syncPhotoReports, type PhotoReportsView } from './photoReports.ts';

import { parsePhotoMaps, parseShots, validSource, type PhotoMaps } from './photoMaps.ts';

export const PHOTO_PANEL_PATH = '/admin/teste-fotos';
export interface PhotoPanelData { ai?: {enabled:boolean;totalArticles:number;totalImages:number;queued:number;processing:number;ready:number;static:number;failed:number;estimatedCostUsd:number;lastUpdated:number;error?:string}; config: PhotoExperimentConfig; maps: PhotoMaps; reports: PhotoReportsView; adArm: string; device: string }
const headers = { 'Cache-Control':'private, no-store', 'Referrer-Policy':'same-origin', 'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'SAMEORIGIN' };
const redirect = (location: string, extra: Record<string,string> = {}) => new Response(null,{status:303,headers:{...headers,Location:location,...extra}});

export async function handlePhotoRoute(request: Request, env: Env, authed: boolean, render: (view: PhotoPanelData, message?: string) => string): Promise<Response> {
  if (!authed) return redirect('/admin');
  const url=new URL(request.url);
  if(request.method==='POST' && request.headers.get('Origin')!==url.origin) return new Response('Origem inválida.',{status:403,headers});
  if(url.pathname===PHOTO_PANEL_PATH && request.method==='GET') {
    const [raw,rawMaps,publisher,reports]=await Promise.all([getSetting(env.DB,'photo.experiment'),getSetting(env.DB,'photo.maps'),getSetting(env.DB,'adsense.publisher_id'),photoReportsView(env)]);
    const publisherId=normalizePublisher(publisher);
    if(reports.snapshot && reports.snapshot.publisherId!==publisherId) reports.snapshot={...reports.snapshot,revenueLinked:false,revenueStatus:'link_unverified',rows:reports.snapshot.rows.map(row=>({...row,revenue:null})),warnings:[...reports.snapshot.warnings,'O Publisher ID mudou. O engajamento foi preservado; a receita precisa de nova verificação.']};
    if(reports.readiness?.publisherId!==publisherId) reports.readiness=null;
    const config=parsePhotoConfig(raw);
    if(reports.snapshot?.testId!==config.id) reports.snapshot=null;
    const messages: Record<string,string>={saved:'Configuração salva.',map_saved:'Mapa de enquadramentos aprovado e salvo.',map_locked:'Pause o teste antes de revisar os enquadramentos.',ready:'Conexão verificada. Os resultados disponíveis foram consultados; a comparação usa somente dias encerrados.',limited:'Aguarde antes de atualizar novamente.',error:'A atualização falhou. O último relatório válido foi preservado.',not_connected:'Conecte o Analytics para atualizar.',connected:'Analytics conectado para leitura. Atualize as métricas.',oauth_error:'A conexão não foi concluída. Use uma conta com acesso de leitura ao Analytics do Capítulo de Hoje.'};
    Object.assign(messages,{oauth_api_disabled:'Ative Google Analytics Admin API e Google Analytics Data API no projeto Google Cloud do aplicativo.',oauth_access_denied:'Esta conta não confirmou acesso de leitura à propriedade Analytics do Capítulo de Hoje. Conecte com a conta que já administra essa propriedade.',oauth_expired:'A autorização Google expirou. Inicie a conexão novamente pelo painel.'});
    const data:PhotoPanelData={config,ai:await photoAIView(env),maps:parsePhotoMaps(rawMaps),reports,adArm:['adsense','nativo','(not set)'].includes(url.searchParams.get('anuncios')||'')?url.searchParams.get('anuncios')!:'',device:['mobile','desktop','tablet'].includes(url.searchParams.get('aparelho')||'')?url.searchParams.get('aparelho')!:''};
    return new Response(render(data,messages[url.searchParams.get('status')||'']),{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
  }
  if(url.pathname===PHOTO_PANEL_PATH+'/config' && request.method==='POST') {
    const form=await request.formData();
    if(!['start','pause'].includes(String(form.get('action')))) return new Response('Ação inválida.',{status:400,headers});
    const current=parsePhotoConfig(await getSetting(env.DB,'photo.experiment'));
    const enabled=form.get('action')==='start';
    // One experiment population: pause/resume never resets assignment or start date.
    const next:PhotoExperimentConfig={...current,enabled,startedAt:current.startedAt||(enabled?Date.now():0),share:50};
    if(current.enabled!==next.enabled || current.startedAt!==next.startedAt) {
      await setSetting(env.DB,'photo.experiment',JSON.stringify(next));
      await bumpCacheVersion(env);
    }
    return redirect(PHOTO_PANEL_PATH+'?status=saved');
  }
  if(url.pathname===PHOTO_PANEL_PATH+'/map' && request.method==='POST'){
    const form=await request.formData(),source=String(form.get('source')||'');let shots;
    try{shots=parseShots(JSON.parse(String(form.get('shots')||'')));}catch{}
    if(!validSource(source)||!shots)return new Response('Mapa inválido: use imagem local e 2 a 6 enquadramentos dentro da foto.',{status:400,headers});
    const config=parsePhotoConfig(await getSetting(env.DB,'photo.experiment'));
    if(config.enabled)return redirect(PHOTO_PANEL_PATH+'?status=map_locked');
    const maps=parsePhotoMaps(await getSetting(env.DB,'photo.maps'));
    if(!maps[source]&&Object.keys(maps).length>=100)return new Response('Limite de 100 mapas atingido.',{status:400,headers});
    maps[source]={shots,reviewedAt:Date.now()};const json=JSON.stringify(maps);
    if(json.length>65536)return new Response('Limite de mapas atingido.',{status:400,headers});
    await setSetting(env.DB,'photo.maps',json);await bumpCacheVersion(env);return redirect(PHOTO_PANEL_PATH+'?status=map_saved');
  }
  if(url.pathname===PHOTO_PANEL_PATH+'/sync' && request.method==='POST') return redirect(PHOTO_PANEL_PATH+'?status='+await syncPhotoReports(env,Date.now(),{manual:true}));
  if(url.pathname===PHOTO_PANEL_PATH+'/connect' && request.method==='POST') {
    if(!photoReportsConfigured(env)||url.origin!==new URL(env.CANONICAL_URL!).origin) return new Response('Abra o painel no domínio principal; o cliente Google precisa estar configurado.',{status:503,headers});
    const nonce=randomToken(),verifier=randomToken();
    const state={nonce,verifier,service:'photo_analytics',session:await digest(getSessionFromRequest(request)!),expires:Date.now()+600000};
    // Reuse the already registered callback; keep the grants and encrypted tokens separate.
    const google=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    const params={client_id:env.ADSENSE_CLIENT_ID!,redirect_uri:callbackUrl(env),response_type:'code',scope:`openid email ${ANALYTICS_SCOPE}`,access_type:'offline',prompt:'select_account consent',state:nonce,code_challenge:await digest(verifier),code_challenge_method:'S256'};
    Object.entries(params).forEach(([key,value])=>google.searchParams.set(key,value));
    return redirect(google.href,{'Set-Cookie':`__Secure-adsense-oauth=${await seal(env,'oauth-state',state)}; Path=/admin/adsense; HttpOnly; Secure; SameSite=Lax; Max-Age=600`});
  }
  return new Response('Not found',{status:404,headers});
}

export const normalizePublisher=(value:string|null|undefined)=>/^((?:ca-)?pub-)([0-9]{16})$/.test(value||'')?'ca-pub-'+value!.split('-').at(-1):'';
