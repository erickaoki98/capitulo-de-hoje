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
      const html = await res.text();
      assert.match(html,/Conteúdo público/);
      assert.doesNotMatch(html,/cdh-photo|photo_ab|photo-motion|related-faces|data-face-/);
      await Promise.all(tasks);
      assert.ok(queries.length-before<=40,'orçamento público: no máximo 40 consultas mesmo sem cache/R2');
    }
    assert.ok(queries.length>0);
    assert.ok(queries.every(sql=>! /photo\./.test(sql)), 'public readers no longer load experiment settings');
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

test('cron preserves rankings, AdSense reports and image migration without retired photo work',async()=>{
  const keys=[],queries=[],tasks=[];
  const env={DB:{prepare(sql){queries.push(sql);return {async all(){return {results:[]}},bind(){return this},async first(){return null},async run(){return {meta:{}}}}}},IMAGES:{
    async get(key){keys.push(key);if(key==='_internal/d1-ranking-guard-v1.json')return {json:async()=>({nextAttemptAt:Date.now()+60000})};return null;},
    async put(key){keys.push(key);return {etag:'test'};},
  }};
  const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('no upstream work expected');};
  try{
    await worker.scheduled({},env,{waitUntil(p){tasks.push(p)}});await Promise.all(tasks);
    assert.ok(keys.includes('_internal/d1-ranking-guard-v1.json'));
    assert.ok(queries.some(sql=>/images_migrated/.test(sql)),'image migration remains active');
    assert.ok(keys.every(key=>! /photo|analytics/i.test(key)), 'no retired AI or comparison storage');
    assert.ok(queries.every(sql=>! /photo\.|ORDER BY p.pub_date DESC LIMIT 30/.test(sql)));
  }finally{globalThis.fetch=old;}
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

test('heartbeat blocks cross-site writes while preserving same-origin sendBeacon and legacy clients',async()=>{
 let writes=0;const tasks=[];
 const env={DB:{prepare(){return {bind(){return this},async run(){writes++;return {meta:{rows_written:1}}}}}}};
 for(const headers of [
  {Origin:'https://other.example','Sec-Fetch-Site':'cross-site'},
  {'Sec-Fetch-Site':'cross-site'},
  {Origin:'https://other.example'},
  {Origin:'null'},
 ]){
  const res=await worker.fetch(new Request('https://example.com/api/heartbeat',{method:'POST',headers,body:JSON.stringify({vid:'visitor',path:'/article'})}),env,{waitUntil(p){tasks.push(p)}});
  assert.equal(res.status,403);
 }
 assert.equal(writes,0);assert.equal(tasks.length,0);
 for(const headers of [
  {Origin:'https://example.com','Sec-Fetch-Site':'same-origin','Content-Type':'text/plain;charset=UTF-8'},
  {'Sec-Fetch-Site':'same-origin'},
  {},
 ]){
  const res=await worker.fetch(new Request('https://example.com/api/heartbeat',{method:'POST',headers,body:JSON.stringify({vid:'visitor',path:'/article'})}),env,{waitUntil(p){tasks.push(p)}});
  assert.equal(res.status,200);assert.equal(await res.text(),'ok');
 }
 await Promise.all(tasks);assert.equal(writes,3);
});

test('500 keeps the existing error markup but never exposes internal error text or HTML',async()=>{
 const previousCache=globalThis.caches,previousError=console.error,logs=[];
 globalThis.caches={default:{async match(){return null},async put(){}}};
 console.error=(...args)=>logs.push(args);
 const error=new Error('private SQL <img src=x onerror=alert(1)>');
 try{
  const env={DB:{prepare(){return {bind(){return this},async all(){throw error}}}}};
  const res=await worker.fetch(new Request('https://example.com/'),env,{waitUntil(){}});
  assert.equal(res.status,500);
  assert.equal(await res.text(),'<h1>Erro interno</h1><pre>Tente novamente mais tarde.</pre>');
  assert.ok(logs.some(args=>args.includes(error)),'error remains available in server logs');
 }finally{globalThis.caches=previousCache;console.error=previousError}
});

test('real image route caches original bytes after skipped optimization, avoiding repeated R2 reads',async()=>{
 const previous=globalThis.caches,entries=new Map(),reads=[],tasks=[];
 globalThis.caches={default:{async match(key){return entries.get(key.url)?.clone()},async put(key,response){entries.set(key.url,response.clone())}}};
 const bytes=new Uint8Array([137,80,78,71]);
 const env={DB:{},IMAGES:{async get(key){reads.push(key);return key.startsWith('_opt3/')?null:{
  size:50000,httpEtag:'"logo"',writeHttpMetadata(h){h.set('Content-Type','image/png')},async arrayBuffer(){return bytes.slice().buffer},
 }}}};
 const ctx={waitUntil(p){tasks.push(p)}};
 try{
  for(let i=0;i<100;i++){
   const res=await worker.fetch(new Request(`https://example.com/img/logo.png?v=2&utm_source=${i}`,{headers:{Accept:'image/webp'}}),env,ctx);
   assert.equal(res.status,200);assert.equal(res.headers.get('Content-Type'),'image/png');
   assert.equal(res.headers.get('X-Image-Cache'),i?'HIT':'MISS');
   assert.deepEqual(new Uint8Array(await res.arrayBuffer()),bytes);
   await Promise.all(tasks);
  }
  assert.deepEqual(reads,['_opt3/logo.png.webp','logo.png']);
 }finally{globalThis.caches=previous}
});

test('cron cleans expired visitors once without waiting for the admin panel',async()=>{
 const calls=[],tasks=[];
 const env={DB:{prepare(sql){calls.push(sql);return {bind(){return this},async run(){return {meta:{}}},async all(){return {results:[]}}}}},IMAGES:{
  async get(key){return key==='_internal/d1-ranking-guard-v1.json'?{json:async()=>({nextAttemptAt:Date.now()+60000})}:null},async put(){return {etag:'test'}},
 }};
 await worker.scheduled({},env,{waitUntil(p){tasks.push(p)}});await Promise.all(tasks);
 assert.equal(calls.filter(sql=>/DELETE FROM active_visitors/.test(sql)).length,1);
 assert.ok(calls.every(sql=>!/CREATE|ALTER|DROP/i.test(sql)));
});
