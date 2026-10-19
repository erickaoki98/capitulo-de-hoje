import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Exerce o fetch real; só WASM de imagens é substituído, fora deste cenário.
const built=await build({entryPoints:['src/index.ts'],bundle:true,write:false,format:'esm',platform:'neutral',mainFields:['module','main'],plugins:[{
  name:'unused-photon',setup(builder){
    builder.onResolve({filter:/^@cf-wasm\/photon$/},()=>({path:'photon',namespace:'test'}));
    builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export class PhotonImage {} export const SamplingFilter = {}; export function crop(){throw Error("unused")} export function resize(){throw Error("unused")}',loader:'js'}));
  },
}]});
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('fetch real: cache indisponível e URLs únicas não executam agregações de pageviews',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  sqlite.exec(await readFile(new URL('../migrations/0003-settings-analytics-api.sql',import.meta.url),'utf8'));
  sqlite.prepare("INSERT INTO posts(slug,title,content,category,pub_date,updated_date) VALUES ('artigo','Artigo','<p>Conteúdo público</p>','Novela',?,?)").run(Date.now(),Date.now());
  const queries=[];
  const DB={prepare(sql){queries.push(sql);let args=[];const stmt={
    bind(...values){args=values;return stmt;},
    async all(){return {results:sqlite.prepare(sql).all(...args)};},
    async first(){return sqlite.prepare(sql).get(...args)??null;},
    async run(){sqlite.prepare(sql).run(...args);return {meta:{}};},
  };return stmt;}};
  const previous=globalThis.caches;
  globalThis.caches={default:{async match(){throw Error('cache unavailable');},async put(){throw Error('cache unavailable');}}};
  const env={DB,IMAGES:{async get(){throw Error('R2 unavailable');}},SITE_TITLE:'Capítulo de Hoje',SITE_DESCRIPTION:'Teste',CANONICAL_URL:'https://example.com',SESSION_SECRET:'local-only-test'};
  // readCache público trata falha de cache como MISS, assim o artigo segue acessível.
  try{
    for(let i=0;i<25;i++){
      const tasks=[];
      const before=queries.length;
      const res=await worker.fetch(new Request(`https://example.com/artigo?fbclid=${i}&utm_source=teste`),env,{waitUntil(p){tasks.push(p);}});
      assert.equal(res.status,200);
      assert.match(await res.text(),/Conteúdo público/);
      await Promise.all(tasks);
      assert.ok(queries.length-before<=40,'orçamento público: no máximo 40 consultas mesmo sem cache/R2');
    }
    assert.ok(queries.length>0);
    assert.equal(queries.filter(sql=>/\bFROM\s+pageviews_hourly\b/i.test(sql)).length,0,'request de leitor jamais pode consultar histórico de pageviews');
    assert.equal(queries.filter(sql=>/INSERT INTO pageviews_hourly/.test(sql)).length,25,'proteção preserva contagem de acessos');
  }finally{globalThis.caches=previous;sqlite.close();}
});

test('Wrangler e CI exigem proteção antes de publicar',async()=>{
  const config=await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  assert.match(config,/"build"\s*:\s*\{\s*"command"\s*:\s*"npm run check:deploy"/);
  const workflow=await readFile(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
  assert.match(workflow, /run: npx wrangler deploy/);
  assert.doesNotMatch(workflow, /wrangler deploy[^\n]*--no-build/);
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(pkg.scripts['check:deploy'],/npm test/);
  assert.match(pkg.scripts.test,/src\/\*\.test\.mjs/);
  assert.match(pkg.scripts['test:d1-protection'],/workerSafety\.test\.mjs/);
});

test('cron aguarda tarefas anteriores liberarem conexões antes de descobrir e processar fotos',async()=>{
  let release;const blocked=new Promise(resolve=>{release=resolve;});const queries=[];const tasks=[];
  const env={DB:{prepare(sql){queries.push(sql);return {async all(){return {results:[]}},bind(){return this},async first(){return null}}}},IMAGES:{
    async get(key){if(key==='_internal/d1-ranking-guard-v1.json'){await blocked;return {json:async()=>({nextAttemptAt:Date.now()+60000})}}if(key==='_internal/photo-ai-v3/state')return {json:async()=>({enabled:true,composition:'luna-shoulders-v1',articles:[]})};return null;},
    async put(){return {etag:'test'};},
  }};
  await worker.scheduled({},env,{waitUntil(p){tasks.push(p)}});
  await new Promise(resolve=>setTimeout(resolve,10));
  const discovers=()=>queries.some(sql=>/ORDER BY p.pub_date DESC LIMIT 30/.test(sql));
  try{assert.equal(discovers(),false,'IA deve esperar ranking, relatórios e migração');}finally{release();await Promise.all(tasks);}
  assert.equal(discovers(),true);
});


test('heartbeat real não executa DDL e requisições repetidas não regravam visitante',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  sqlite.exec(await readFile(new URL('../migrations/0003-settings-analytics-api.sql',import.meta.url),'utf8'));
  sqlite.exec(await readFile(new URL('../migrations/0007_d1_cost_guard.sql',import.meta.url),'utf8'));
  const queries=[];
  const DB={prepare(sql){queries.push(sql);let args=[];const stmt={bind(...v){args=v;return stmt;},async run(){return {meta:sqlite.prepare(sql).run(...args)};}};return stmt;}};
  const env={DB,SESSION_SECRET:'test',CANONICAL_URL:'https://example.com'};
  try{
    const before=sqlite.prepare('SELECT total_changes() AS n').get().n;
    for(let i=0;i<20;i++){
      const tasks=[];
      const res=await worker.fetch(new Request('https://example.com/api/heartbeat',{method:'POST',body:JSON.stringify({vid:'visitor',path:'/artigo'})}),env,{waitUntil(p){tasks.push(p)}});
      assert.equal(res.status,200);await Promise.all(tasks);
    }
    assert.equal(queries.filter(sql=>/CREATE|ALTER|DROP/i.test(sql)).length,0);
    assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n-before,1);
    assert.equal(sqlite.prepare('SELECT path FROM active_visitors').get().path,'/artigo');
    assert.equal(env.DB,DB,'bindings compartilhados nunca são substituídos por proxies');
  }finally{sqlite.close()}
});

test('pressão D1 é visível mesmo quando heartbeat preserva a resposta pública',async()=>{
  const previous=console.warn,logs=[];console.warn=(...args)=>logs.push(args);
  let calls=0;const tasks=[];
  try{
    const env={DB:{prepare(){return {bind(){return this},async run(){calls++;throw new Error('D1 DB is overloaded. private data')}}}}};
    const res=await worker.fetch(new Request('https://example.com/api/heartbeat',{method:'POST',body:JSON.stringify({vid:'private-visitor',path:'/private-path'})}),env,{waitUntil(p){tasks.push(p)}});
    await Promise.all(tasks);assert.equal(res.status,200);assert.equal(calls,1);
    assert.ok(logs.some(args=>args[0]==='[d1-pressure]'&&JSON.parse(args[1]).reason==='overload'));
    assert.doesNotMatch(JSON.stringify(logs),/private/);
  }finally{console.warn=previous}
});
