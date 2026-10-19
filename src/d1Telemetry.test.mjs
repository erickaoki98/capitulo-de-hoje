import test from 'node:test';
import assert from 'node:assert/strict';
import {withD1Telemetry} from './d1Telemetry.ts';
function harness(meta={rows_read:1,rows_written:0,duration:1}){
 const calls=[];const logs=[];const raw={prepare(sql){const stmt={bind(...args){calls.push(['bind',args]);return stmt},async all(){calls.push(['all']);return {results:[{n:7}],meta}},async run(){calls.push(['run']);return {results:[],meta}},async raw(){calls.push(['raw']);return [[7]]}};return stmt},async batch(stmts){calls.push(['batch',stmts]);return stmts.map(()=>({results:[{n:7}],meta}))}};
 return {raw,calls,logs,db:withD1Telemetry(raw,'fetch',e=>logs.push(e))};
}
test('all, first, bind, run and batch preserve values and execute exactly once',async()=>{
 const h=harness();assert.equal(await h.db.prepare('SELECT ?').bind('secret').first('n'),7);
 assert.deepEqual(await h.db.prepare('SELECT 7').first(),{n:7});
 await h.db.prepare('UPDATE x').run();const s=h.db.prepare('SELECT 7');const r=await h.db.batch([s]);assert.equal(r[0].results[0].n,7);
 assert.equal(h.calls.filter(x=>x[0]==='all').length,2);assert.equal(h.calls.filter(x=>x[0]==='run').length,1);
 assert.equal(h.calls.filter(x=>x[0]==='batch').length,1);assert.equal(h.logs.length,0);
 assert.deepEqual(await s.raw(),[[7]]);
});
test('cost and latency warnings never block successful requests or log SQL/values',async()=>{
 const h=harness({rows_read:200000,rows_written:2000,duration:500});
 for(let i=0;i<20;i++)assert.equal((await h.db.prepare("SELECT 'sensitive-sql'").bind('private-token').all()).results[0].n,7);
 assert.ok(h.logs.length>0&&h.logs.length<=4,'bounded warnings per invocation');
 assert.ok(h.logs.some(e=>e.rowsRead>=200000));assert.doesNotMatch(JSON.stringify(h.logs),/sensitive-sql|private-token/);
});
test('overload is logged and rethrown without retry; wrapping twice is idempotent',async()=>{
 const h=harness();assert.equal(withD1Telemetry(h.db,'fetch'),h.db);let calls=0;
 const error=new Error('D1 DB is overloaded. secret payload');const logs=[];
 const db=withD1Telemetry({prepare(){return {async all(){calls++;throw error}}}},'scheduled',e=>logs.push(e));
 await assert.rejects(db.prepare('secret query').all(),e=>e===error);assert.equal(calls,1);assert.equal(logs[0].reason,'overload');assert.doesNotMatch(JSON.stringify(logs),/secret/);
});
