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
      const res=await worker.fetch(new Request(`https://example.com/artigo?fbclid=${i}&utm_source=teste`),env,{waitUntil(p){tasks.push(p);}});
      assert.equal(res.status,200);
      assert.match(await res.text(),/Conteúdo público/);
      await Promise.all(tasks);
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

test('fetch real: heartbeats preserve writes without CREATE TABLE per request', async () => {
  const queries = [];
  const DB = { prepare(sql) {
    queries.push(sql);
    return { bind() { return this; }, async run() { return { success: true }; } };
  } };
  for (let i = 0; i < 100; i++) {
    const tasks = [];
    const response = await worker.fetch(new Request('https://example.com/api/heartbeat', {
      method: 'POST', body: JSON.stringify({ vid: `visitor-${i}`, path: '/artigo' }),
    }), { DB, SESSION_SECRET: 'test' }, { waitUntil(p) { tasks.push(p); } });
    assert.equal(response.status, 200);
    await Promise.all(tasks);
  }
  assert.equal(queries.filter(sql => /INSERT INTO active_visitors/.test(sql)).length, 100);
  assert.equal(queries.filter(sql => /CREATE TABLE/.test(sql)).length, 0);
});

test('fetch real: cached images avoid R2 reads, HEAD still uses original metadata', async () => {
  const previous = globalThis.caches;
  const entries = new Map();
  globalThis.caches = { default: {
    async match(request) { return entries.get(request.url)?.clone(); },
    async put(request, response) { entries.set(request.url, response.clone()); },
  } };
  let gets = 0, heads = 0;
  const IMAGES = {
    async get(key) {
      gets++;
      assert.equal(key, 'photo.svg');
      return {
        body: 'svg-bytes', size: 9, httpEtag: '"original"',
        writeHttpMetadata(h) { h.set('Content-Type', 'image/svg+xml'); },
      };
    },
    async head(key) {
      heads++;
      return {
        size: 9, httpEtag: '"original"',
        writeHttpMetadata(h) { h.set('Content-Type', 'image/svg+xml'); },
      };
    },
  };
  const env = { IMAGES, SESSION_SECRET: 'test' };
  try {
    for (let i = 0; i < 20; i++) {
      const tasks = [];
      const response = await worker.fetch(new Request(`https://example.com/img/photo.svg?utm_source=${i}`), env, { waitUntil(p) { tasks.push(p); } });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'svg-bytes');
      await Promise.all(tasks);
    }
    assert.equal(gets, 1);
    const response = await worker.fetch(new Request('https://example.com/img/photo.svg', { method: 'HEAD' }), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Length'), '9');
    assert.equal(await response.text(), '');
    assert.equal(heads, 1);
  } finally { globalThis.caches = previous; }
});
