import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const output=await build({entryPoints:['src/cache.ts'],bundle:true,write:false,format:'esm',platform:'neutral'});
const {readCache,writeCache,bumpCacheVersion}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
test('a photo map invalidation cannot store an older in-flight render under the new version',async()=>{
 const settings=new Map([['cache.version','7']]),writes=[],pending=[];
 const env={DB:{prepare(){let args=[];return {bind(...v){args=v;return this},async first(){return {value:settings.get(args[0])}},async run(){settings.set(args[0],args[1]);return {success:true}}}}}};
 globalThis.caches={default:{async match(){return undefined},async put(key){writes.push(key.url)}}};
 const request=new Request('https://example.com/article');await readCache(env,request);
 await bumpCacheVersion(env);writeCache(env,{waitUntil(p){pending.push(p)}},request,new Response('older maps',{headers:{'Content-Type':'text/html'}}));await Promise.all(pending);
 assert.equal(new URL(writes[0]).searchParams.get('__cv'),'7');
});
