import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {getPublicPostsBySlugList, getPostsBySlugList, recordHeartbeat} from './db.ts';
import {POST_SQL} from './rankingSnapshot.ts';
function harness(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('schema.sql','utf8'));sql.exec(readFileSync('migrations/0003-settings-analytics-api.sql','utf8'));sql.exec(readFileSync('migrations/0007_d1_cost_guard.sql','utf8'));
 const calls=[];const db={prepare(query){calls.push(query);let args=[];return {bind(...v){args=v;return this},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return {meta:sql.prepare(query).run(...args)}}}}};
 return {sql,db,calls};
}
test('recommendation metadata preserves cards and visibility without reading article bodies',async()=>{
 const h=harness();try{
 h.sql.prepare("INSERT INTO posts(slug,title,description,content,category,pub_date,updated_date) VALUES(?,?,?,?,?,?,?)").run('visible','Title','Summary','private full body','Ativa',1,1);
 h.sql.prepare("INSERT INTO posts(slug,title,content,draft,pub_date,updated_date) VALUES('draft','Draft','body',1,1,1)").run();
 for(const fn of [getPublicPostsBySlugList,getPostsBySlugList]){
  const rows=await fn(h.db,['visible','draft']);assert.equal(rows.length,1);assert.equal(rows[0].title,'Title');assert.equal(rows[0].description,'Summary');assert.equal(rows[0].content,undefined);
 }
 assert.ok(h.calls.every(q=>! /SELECT (?:p\.)?\*/i.test(q)));
 }finally{h.sql.close()}
});
test('duplicate heartbeats preserve latest location but do not rewrite unchanged active visitors',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1000000});const h=harness();try{
 await recordHeartbeat(h.db,'v','/a');const changes=h.sql.prepare('SELECT total_changes() AS n').get().n;
 await recordHeartbeat(h.db,'v','/a');assert.equal(h.sql.prepare('SELECT total_changes() AS n').get().n,changes);
 await recordHeartbeat(h.db,'v','/b');assert.equal(h.sql.prepare('SELECT path FROM active_visitors').get().path,'/b');
 t.mock.timers.tick(60000);await recordHeartbeat(h.db,'v','/b');assert.equal(h.sql.prepare('SELECT last_seen FROM active_visitors').get().last_seen,1060000);
 }finally{h.sql.close()}
});
test('ranking metadata scan must be covered and bounded',()=>{
 const h=harness();try{
 const migration=readFileSync('migrations/0008_d1_overload.sql','utf8');h.sql.exec(migration);h.sql.exec(migration);
 const plan=h.sql.prepare('EXPLAIN QUERY PLAN '+POST_SQL).all(20001);
 assert.ok(plan.some(r=>/COVERING INDEX idx_posts_ranking_metadata/.test(r.detail)));assert.ok(plan.every(r=>!/TEMP B-TREE/.test(r.detail)));
 }finally{h.sql.close()}
});

test('section recommendation query preserves content image fallback and alternative image',async()=>{
 const {renderSectionCard}=await import('./sectionRecommendations.ts');
 const h=harness();try{
 h.sql.prepare("INSERT INTO posts(slug,title,content,pub_date,updated_date) VALUES(?,?,?,?,?)").run('image-fallback','Title','<img src="/img/first.jpg"><img src="/img/alternate.jpg">',Date.now(),Date.now());
 const [post]=await getPublicPostsBySlugList(h.db,['image-fallback'],{includeContent:true});
 const html=renderSectionCard(post,1);assert.match(html,/src="\/img\/first.jpg"/);assert.match(html,/data-fallback/);assert.match(html,/alternate.jpg/);
 }finally{h.sql.close()}
});
