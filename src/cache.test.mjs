import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const output=await build({entryPoints:['src/cache.ts'],bundle:true,write:false,format:'esm',platform:'neutral'});
const {readCache,writeCache,bumpCacheVersion}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));

test('new renderer ignores old HTML and preserves the read version during concurrent invalidation',async()=>{
 const settings=new Map([['cache.version','7']]),reads=[],writes=[],pending=[];
 const env={DB:{prepare(){let args=[];return {bind(...v){args=v;return this},async first(){return {value:settings.get(args[0])}},async run(){settings.set(args[0],args[1]);return {success:true}}}}}};
 const previous=globalThis.caches;
 globalThis.caches={default:{async match(key){reads.push(key.url);return new URL(key.url).searchParams.get('__cv')==='7'?new Response('retired HTML'):undefined},async put(key){writes.push(key.url)}}};
 try{
  const request=new Request('https://example.com/article');
  assert.equal(await readCache(env,request),null);
  assert.equal(new URL(reads[0]).searchParams.get('__cv'),'2:7');
  await bumpCacheVersion(env);
  writeCache(env,{waitUntil(p){pending.push(p)}},request,new Response('in-flight HTML',{headers:{'Content-Type':'text/html'}}));
  await Promise.all(pending);
  assert.equal(settings.get('cache.version'),'8');
  assert.equal(new URL(writes[0]).searchParams.get('__cv'),'2:7');
 }finally{globalThis.caches=previous;}
});
