import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  buildRankingSnapshot, readRankingSnapshot, refreshRankingSnapshot, rankingsForArticle,
  REFRESH_MS, MAX_AGE_MS, MAX_VIEW_ROWS, MAX_POST_ROWS, MAX_ARCHIVE_ROWS,
  VIEW_SQL, POST_SQL, STATE_KEY,
} from './rankingSnapshot.ts';
import { publicCacheKeyUrl } from './publicCacheKey.ts';

const NOW = Date.parse('2026-09-12T12:30:00Z');
const snapshot = { generatedAt: NOW, top48h: [{path:'/ativa',views:20}], top24h: [{path:'/ativa',views:10}] };
function memoryBucket(initial = null) {
  let value = initial && JSON.stringify(initial), revision = initial ? 1 : 0;
  return {
    reads: 0,
    async get(key) {
      assert.equal(key, STATE_KEY);
      this.reads++;
      if (!value) return null;
      const body = value, etag = String(revision);
      return { etag, async json() { return JSON.parse(body); } };
    },
    async put(key, next, {onlyIf} = {}) {
      assert.equal(key, STATE_KEY);
      if (onlyIf?.etagDoesNotMatch === '*' && value) return null;
      if (onlyIf?.etagMatches && onlyIf.etagMatches !== String(revision)) return null;
      value = next; revision++;
      return { etag: String(revision) };
    },
    state() { return JSON.parse(value); },
  };
}
function memoryCache() {
  const entries = new Map();
  return { async match(key) { return entries.get(key.url)?.clone(); }, async put(key,res) { entries.set(key.url,res.clone()); } };
}
function dbStub({posts=[{slug:'ativa',category:'Novela',draft:0}], archives=[], views=[{bucket:'2026-09-12T12',path:'/ativa',count:20}]}={}) {
  const db = { calls: [], prepare(sql) {
    return {bind(limitOrSince,limit){
      db.calls.push({sql,binds:[limitOrSince,limit]});
      return {async all(){return {results: sql.includes('FROM posts') ? posts : sql.includes('FROM archived_categories') ? archives : views};}};
    }};
  }};
  return db;
}

test('agrega janelas separadas e exclui rascunhos e categorias arquivadas antes do ranking', async () => {
  const db=dbStub({posts:[{slug:'ativa',category:'Novela',draft:0},{slug:'legada',category:'CORAÇÃO💓ACELERADO',draft:0},{slug:'rascunho',category:null,draft:1}],archives:[{category_key:'coracao acelerado'}],views:[
    {bucket:'2026-09-12T10',path:'/ativa',count:5},
    {bucket:'2026-09-10T20',path:'/ativa',count:10},
    {bucket:'2026-09-12T10',path:'/legada',count:1000},
    {bucket:'2026-09-12T10',path:'/rascunho',count:1000},
    {bucket:'2026-09-12T10',path:'/inexistente',count:1000},
  ]});
  const result=await buildRankingSnapshot(db,NOW);
  assert.deepEqual(result.top48h,[{path:'/ativa',views:15}]);
  assert.deepEqual(result.top24h,[{path:'/ativa',views:5}]);
  assert.deepEqual(rankingsForArticle(result,'/ativa'),{topViews:[],top24h:[]});
});

test('50 crons concorrentes e retries consomem apenas uma reserva global; volta após 30 minutos', async () => {
  const bucket=memoryBucket(),db=dbStub();
  await Promise.all(Array.from({length:50},()=>refreshRankingSnapshot(bucket,db,NOW)));
  assert.equal(db.calls.length,3);
  assert.equal(bucket.state().status,'ready');
  await refreshRankingSnapshot(bucket,db,NOW+REFRESH_MS-1);
  assert.equal(db.calls.length,3);
  await refreshRankingSnapshot(bucket,db,NOW+REFRESH_MS);
  assert.equal(db.calls.length,6);
});

test('falha do R2/reserva impede qualquer consulta D1', async () => {
  const db=dbStub();
  const unavailable={async get(){throw Error('offline');}};
  assert.equal(await refreshRankingSnapshot(unavailable,db,NOW,()=>{}),'blocked');
  const failedPut={async get(){return null;},async put(){throw Error('offline');}};
  assert.equal(await refreshRankingSnapshot(failedPut,db,NOW,()=>{}),'blocked');
  assert.equal(db.calls.length,0);
});

test('erro D1 mantém último resultado e não abre retries durante a reserva', async () => {
  const bucket=memoryBucket({snapshot,nextAttemptAt:NOW-1,status:'ready'});
  let calls=0;
  const db={prepare(){calls++;throw Error('D1 offline');}};
  assert.equal(await refreshRankingSnapshot(bucket,db,NOW,()=>{}),'blocked');
  assert.deepEqual(bucket.state().snapshot,snapshot);
  for(let i=1;i<100;i++) await refreshRankingSnapshot(bucket,db,NOW+i,()=>{});
  assert.equal(calls,1);
});

test('excesso de linhas bloqueia atualização, preserva snapshot e não amplia limite', async () => {
  for (const [field,limit] of [['archives',MAX_ARCHIVE_ROWS],['posts',MAX_POST_ROWS],['views',MAX_VIEW_ROWS]]) {
    const bucket=memoryBucket({snapshot,nextAttemptAt:NOW-1,status:'ready'});
    const row=field==='archives'?{category_key:'x'}:field==='posts'?{slug:'ativa',draft:0,category:null}:{bucket:'2026-09-12T12',path:'/ativa',count:1};
    const db=dbStub({[field]:Array.from({length:limit+1},()=>row)});
    assert.equal(await refreshRankingSnapshot(bucket,db,NOW,()=>{}),'blocked');
    assert.deepEqual(bucket.state().snapshot,snapshot);
    const count=db.calls.length;
    await refreshRankingSnapshot(bucket,db,NOW+1,()=>{});
    assert.equal(db.calls.length,count);
  }
});

test('1000 visitantes, cache frio/indisponível ou objeto ausente usam somente R2/cache', async () => {
  const bucket=memoryBucket({snapshot,nextAttemptAt:NOW+REFRESH_MS,status:'ready'});
  const cache=memoryCache();
  for(let i=0;i<1000;i++) assert.deepEqual(await readRankingSnapshot(bucket,cache,'https://example.com',NOW),snapshot);
  assert.equal(bucket.reads,1);
  const brokenCache={async match(){throw Error('offline');},async put(){throw Error('offline');}};
  assert.deepEqual(await readRankingSnapshot(bucket,brokenCache,'https://example.com',NOW),snapshot);
  const unavailable={async get(){throw Error('offline');}};
  assert.equal((await readRankingSnapshot(unavailable,brokenCache,'https://example.com',NOW)).top48h.length,0);
  assert.equal((await readRankingSnapshot(memoryBucket(),cache,'https://empty.com',NOW)).top48h.length,0);
});

test('snapshot com mais de 48h ou conteúdo inválido não é servido', async () => {
  for (const invalid of [{...snapshot,generatedAt:NOW-MAX_AGE_MS-1},{...snapshot,top48h:'invalid'}]) {
    const result=await readRankingSnapshot(memoryBucket({snapshot:invalid}),memoryCache(),'https://example.com',NOW);
    assert.equal(result.top48h.length,0);
  }
});

test('SQLite real: consulta usa índice de cobertura e LIMIT na entrada, nunca ordena todo histórico', () => {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE pageviews_hourly(bucket TEXT,path TEXT,count INTEGER); CREATE INDEX idx_ph_bucket_path_count ON pageviews_hourly(bucket DESC,path,count); CREATE TABLE posts(id INTEGER PRIMARY KEY,slug TEXT,category TEXT,draft INTEGER);');
  const plan=sqlite.prepare('EXPLAIN QUERY PLAN '+VIEW_SQL).all('2026-09-10T12',MAX_VIEW_ROWS+1);
  assert.ok(plan.some(r=>/SEARCH.*COVERING INDEX idx_ph_bucket_path_count/.test(r.detail)));
  assert.ok(plan.every(r=>!/TEMP B-TREE/.test(r.detail)));
  sqlite.exec("INSERT INTO pageviews_hourly VALUES ('2026-09-12T12','/a',1),('2026-09-12T11','/b',2),('2026-09-01T12','/old',1);");
  assert.equal(sqlite.prepare(VIEW_SQL).all('2026-09-10T12',1).length,1);
  const postPlan=sqlite.prepare('EXPLAIN QUERY PLAN '+POST_SQL).all(MAX_POST_ROWS+1);
  assert.ok(postPlan.every(r=>!/TEMP B-TREE/.test(r.detail)));
  sqlite.exec('DROP INDEX idx_ph_bucket_path_count');
  assert.throws(()=>sqlite.prepare(VIEW_SQL),/no such index/);
  sqlite.close();
});

test('parâmetros únicos de campanhas não fragmentam cache; parâmetros funcionais e versão são preservados', () => {
  const base=publicCacheKeyUrl('https://example.com/artigo?page=2','9');
  for (let i=0;i<1000;i++) assert.equal(publicCacheKeyUrl(`https://example.com/artigo?fbclid=${i}&utm_source=${i}&page=2&gclid=${i}`,'9'),base);
  assert.notEqual(publicCacheKeyUrl('https://example.com/artigo?page=3','9'),base);
  assert.notEqual(publicCacheKeyUrl('https://example.com/artigo?page=2','10'),base);
});

test('orçamento de regressão: menos de 180 milhões de linhas de entrada por mês no produtor', () => {
  assert.ok(REFRESH_MS >= 30*60_000, 'não aumentar frequência silenciosamente');
  assert.ok(MAX_VIEW_ROWS <= 100_000);
  assert.ok(MAX_POST_ROWS <= 20_000);
  assert.ok(MAX_ARCHIVE_ROWS <= 100);
  const maximumRows=(MAX_VIEW_ROWS+MAX_POST_ROWS+MAX_ARCHIVE_ROWS+3)*Math.ceil(31*86400_000/REFRESH_MS);
  assert.ok(maximumRows < 180_000_000);
});
