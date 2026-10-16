import { PHOTO_IDENTIFY_PROMPT, PHOTO_REVIEW_PROMPT } from './photoAIPrompts.ts';
export const PHOTO_AI_VERSION='luna-v3';
export interface AIShot {id:string;x:number;y:number;size:number;label:string}
export interface PhotoAIResult {shots:AIShot[];estimatedCostUsd:number;inputTokens:number;outputTokens:number;proposals:number;rejected:number;reason:string;model:string}
export function subjectSquare(box:any):{x:number;y:number;size:number}|null {
  if(!box||![box.x1,box.y1,box.x2,box.y2].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)||box.x2<=box.x1||box.y2<=box.y1)return null;
  const size=Math.min(1,Math.max(box.x2-box.x1,box.y2-box.y1)*1.1);if(size<.1||size>.92)return null;
  return {x:Math.max(0,Math.min(1-size,(box.x1+box.x2-size)/2)),y:Math.max(0,Math.min(1-size,(box.y1+box.y2-size)/2)),size};
}
function overlap(a:AIShot,b:AIShot):number {return Math.max(0,Math.min(a.x+a.size,b.x+b.size)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.size,b.y+b.size)-Math.max(a.y,b.y))/Math.min(a.size*a.size,b.size*b.size)}
function permutations<T>(items:T[],count:number):T[][] {if(!count)return [[]];return items.flatMap((item,i)=>permutations(items.filter((_,j)=>i!==j),count-1).map(rest=>[item,...rest]));}
export function selectPhotoSequence(shots:AIShot[]):AIShot[] {
  for(let count=shots.length;count>=2;count--){let best:AIShot[]|null=null,bestScore=Infinity;
    for(const order of permutations(shots,count)){const overlaps=order.map((s,i)=>overlap(s,order[(i+1)%count]));if(Math.max(...overlaps)>.25+1e-9)continue;const score=Math.max(...overlaps)+overlaps.reduce((a,b)=>a+b,0)/10;if(score<bestScore){best=order;bestScore=score;}}
    if(best)return best;
  }return shots.slice(0,1);
}
export function reviewedPhotoShots(candidates:AIShot[],review:any):AIShot[] {
  const decisions=review?.decisions,order=review?.ordered_ids;
  if(!Array.isArray(decisions)||!Array.isArray(order)||decisions.length!==candidates.length||new Set(decisions.map((d:any)=>d.id)).size!==candidates.length||decisions.some((d:any)=>!candidates.some(c=>c.id===d.id)||typeof d.keep!=='boolean')||new Set(order).size!==order.length)throw Error('Invalid visual review');
  const kept=decisions.filter((d:any)=>d.keep).map((d:any)=>d.id);if(order.length!==kept.length||order.some((id:any)=>!kept.includes(id)))throw Error('Invalid reviewed order');
  return selectPhotoSequence(order.map((id:string)=>candidates.find(c=>c.id===id)!));
}
export function photoUsageCost(u:any):number {const n=u?.input_tokens||0,c=u?.input_tokens_details?.cached_tokens||0,w=u?.input_tokens_details?.cache_write_tokens||0,o=u?.output_tokens||0;return ((n-c-w)*.1+c*.01+w*.125+o*.5)/1e6;}
const num={type:'number',minimum:0,maximum:1};
const identifySchema={type:'object',additionalProperties:false,properties:{scene:{type:'string'},subjects:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},label:{type:'string'},kind:{type:'string',enum:['expression','action','object']},box:{type:'object',additionalProperties:false,properties:{x1:num,y1:num,x2:num,y2:num},required:['x1','y1','x2','y2']},reason:{type:'string'}},required:['id','label','kind','box','reason']}},caution:{type:'string'}},required:['scene','subjects','caution']};
const reviewSchema={type:'object',additionalProperties:false,properties:{decisions:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},keep:{type:'boolean'},reason:{type:'string'}},required:['id','keep','reason']}},ordered_ids:{type:'array',maxItems:3,items:{type:'string'}}},required:['decisions','ordered_ids']};
async function response(key:string,content:any[],schema:unknown){
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-6-luna',store:false,max_output_tokens:2300,reasoning:{effort:'none'},input:[{role:'user',content}],text:{format:{type:'json_schema',name:'photo_focus',strict:true,schema}}}),signal:AbortSignal.timeout(25000)});
  const raw:any=await r.json();if(!r.ok)throw Error(`OpenAI HTTP ${r.status}: ${String(raw.error?.code||'request_failed').slice(0,80)}`);
  if(raw.status!=='completed'||!String(raw.model).startsWith('gpt-6-luna'))throw Error('Luna response incomplete or unexpected model');
  const text=raw.output?.flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');return {data:JSON.parse(text),usage:raw.usage};
}
/** No tool calls, no retries, two fixed requests maximum; source and final rendered crops are reviewed. */
export async function analyzePhoto(input:ArrayBuffer,key:string):Promise<PhotoAIResult>{
  const {preparePhoto,renderPhotoCrops}=await import('./photoAIImages.ts');const prepared=preparePhoto(input);
  const base={shots:[] as AIShot[],estimatedCostUsd:0,inputTokens:0,outputTokens:0,proposals:0,rejected:0,reason:'',model:'gpt-6-luna'};
  if(!prepared)return {...base,reason:'Foto não quadrada ou formato não suportado.'};
  const image={type:'input_image',image_url:prepared,detail:'high'};
  const identified=await response(key,[{type:'input_text',text:PHOTO_IDENTIFY_PROMPT},image],identifySchema);
  let cost=photoUsageCost(identified.usage),inputs=identified.usage.input_tokens,outputs=identified.usage.output_tokens;
  try {
  const subjects=identified.data?.subjects;if(!Array.isArray(subjects)||subjects.length>3)throw Error('Invalid Luna subjects');
  const seen=new Set<string>();const candidates:AIShot[]=[];
  for(const subject of subjects){const square=subjectSquare(subject.box);if(!square||typeof subject.id!=='string'||seen.has(subject.id)||typeof subject.label!=='string'||!subject.label.trim()||subject.label.length>80)continue;seen.add(subject.id);candidates.push({...square,id:subject.id,label:subject.label.trim()});}
  if(!candidates.length)return {...base,estimatedCostUsd:cost,inputTokens:inputs,outputTokens:outputs,proposals:subjects.length,reason:'A IA não identificou recortes seguros.'};
  const rendered=renderPhotoCrops(input,candidates),content:any[]=[{type:'input_text',text:PHOTO_REVIEW_PROMPT},{type:'input_text',text:'IMAGEM ORIGINAL'},image];
  candidates.forEach((c,i)=>content.push({type:'input_text',text:`RECORTE id=${c.id}, rótulo descritivo: ${c.label}`},{type:'input_image',image_url:rendered[i],detail:'high'}));
  const reviewed=await response(key,content,reviewSchema);cost+=photoUsageCost(reviewed.usage);inputs+=reviewed.usage.input_tokens;outputs+=reviewed.usage.output_tokens;
  const shots=reviewedPhotoShots(candidates,reviewed.data);
  return {...base,shots,estimatedCostUsd:cost,inputTokens:inputs,outputTokens:outputs,proposals:subjects.length,rejected:subjects.length-shots.length,reason:shots.length<2?'Menos de dois recortes distintos aprovados; foto original preservada.':String(identified.data.caution||'').slice(0,240)};
  } catch(error) {
    const failure=error instanceof Error?error:new Error('Falha na revisão visual.');
    Object.assign(failure,{estimatedCostUsd:cost,inputTokens:inputs,outputTokens:outputs});throw failure;
  }
}
