import type { Env } from './types';
import { parsePhotoConfig } from './photoExperiment.ts';
export interface PhotoShot { x:number; y:number; size:number; label:string }
export interface PhotoMap { shots:PhotoShot[]; reviewedAt:number }
export type PhotoMaps=Record<string,PhotoMap>;
export const PHOTO_SOURCE='/img/9e5335709590212c.jpg';
export const approvedExample=():PhotoMaps=>({[PHOTO_SOURCE]:{reviewedAt:Date.now(),shots:[{x:.17,y:0,size:.30,label:'Rosto de Heitor'},{x:.66,y:.105,size:.30,label:'Reação de Pilar'}]}});
export const validSource=(source:string)=>/^\/img\/[a-zA-Z0-9_-]{1,120}\.(?:jpg|jpeg|png|webp)$/.test(source);
export function parseShots(value:unknown):PhotoShot[]|null {
  if(!Array.isArray(value)||value.length<2||value.length>6)return null;
  const shots:PhotoShot[]=[];
  for(const shot of value){
    if(!shot||typeof shot!=='object')return null;
    const {x,y,size,label}=shot;
    if(![x,y,size].every(v=>typeof v==='number'&&Number.isFinite(v))||x<0||y<0||size<.1||size>1||x+size>1.000001||y+size>1.000001||typeof label!=='string'||!label.trim()||label.trim().length>80)return null;
    if(shots.some(s=>s.x===x&&s.y===y&&s.size===size))return null;
    shots.push({x,y,size,label:label.trim()});
  }
  return shots;
}
export function parsePhotoMaps(raw:string|null):PhotoMaps {
  const maps:PhotoMaps={};if(!raw||raw.length>1048576)return maps;
  try{const data=JSON.parse(raw);for(const [source,map] of Object.entries(data).slice(0,2000)){
    const m=map as PhotoMap,shots=parseShots(m?.shots);
    if(validSource(source)&&shots&&Number.isFinite(m.reviewedAt)&&m.reviewedAt>0)maps[source]={shots,reviewedAt:m.reviewedAt};
  }}catch{}return maps;
}
/** Two exact settings keys; never touches historical pageview tables. */
export async function loadPhotoSettings(env:Env,postId?:number){
  const rows=await env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('photo.experiment','photo.maps')").all<{key:string;value:string}>();
  const data=Object.fromEntries((rows.results||[]).map(r=>[r.key,r.value]));
  return {config:parsePhotoConfig(data['photo.experiment']??null),maps:postId?await loadAutomaticPhotoMaps(env,postId):parsePhotoMaps(data['photo.maps']??null)};
}
// Same quoted-attribute tokenization as section recommendations; raw/inert text is skipped.
const PHOTO_TOKEN=/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noscript)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const PHOTO_VOID=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
const PHOTO_EXCLUDED=new Set(['section-rec','ad-slot','ad-inarticle','cdh-mix','cdh-spot','shopee-inline','shopee-card']);
export function articlePhotoSources(content:string):string[] {
  const selected:Record<string,true>={},stack:Array<{tag:string;excluded:boolean}>=[];
  for(const token of content.matchAll(PHOTO_TOKEN)){
    if(!token[2])continue;
    const tag=token[2].toLowerCase(),closing=token[0][1]==='/';
    if(closing){
      const index=stack.map(frame=>frame.tag).lastIndexOf(tag);
      // ponytail: uncertain malformed nesting stays static instead of recreating a browser parser.
      if(index>=0&&index!==stack.length-1)break;
      if(index>=0)stack.length=index;
      continue;
    }
    const attrs=new Map<string,string>();
    for(const attr of token[0].slice(token[2].length+1,-1).matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)){
      const name=attr[1].toLowerCase();if(!attrs.has(name))attrs.set(name,attr[2]??attr[3]??attr[4]??'');
    }
    const classes=attrs.get('class')||'';
    const excluded=!!stack.at(-1)?.excluded||['a','template','svg','math'].includes(tag)||attrs.has('data-related-card')||attrs.has('data-product-id')||classes.includes('&')||classes.split(/\s+/).some(value=>PHOTO_EXCLUDED.has(value));
    if(tag==='img'&&!excluded){
      const src=attrs.get('src')||'';if(validSource(src))selected[src]=true;

    }
    if(!PHOTO_VOID.test(tag)){stack.push({tag,excluded});if(stack.length>256)break;}
  }
  return Object.keys(selected);
}
export function articlePhotoMaps(content:string,maps:PhotoMaps):PhotoMaps{return Object.fromEntries(articlePhotoSources(content).filter(source=>maps[source]).map(source=>[source,maps[source]]));}
export const PHOTO_AI_ROOT="_internal/photo-ai-v3/";
export async function loadAutomaticPhotoMaps(env:Env,postId:number):Promise<PhotoMaps>{try{const object=await env.IMAGES.get(PHOTO_AI_ROOT+"articles/"+postId+".json");if(!object)return {};const post=await object.json<{maps?:PhotoMaps}>();return parsePhotoMaps(JSON.stringify(post.maps||{}));}catch{return {};}}
export const photoMapsJSON=(maps:PhotoMaps)=>JSON.stringify(maps).replace(/</g,'\\u003c');
