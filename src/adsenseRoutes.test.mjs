import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createSession } from './auth.ts';
import { seal, digest } from './adsenseReports.ts';
const built=await build({entryPoints:['src/adsenseRoutes.ts'],bundle:true,write:false,format:'esm',platform:'neutral'});
const {handleAdSenseRoute}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const e={ SESSION_SECRET:'test-local-secret', ADSENSE_CLIENT_ID:'client', ADSENSE_CLIENT_SECRET:'secret', ADSENSE_GOOGLE_EMAIL:'expected@example.com',CANONICAL_URL:'https://example.com',IMAGES:{get:async()=>null} };
const render=(view,message)=>JSON.stringify({view,message});
const session=await createSession(e.SESSION_SECRET);
const cookie=`session=${session}`;
test('unauthenticated access never reads reports or calls Google',async()=>{
 const res=await handleAdSenseRoute(new Request('https://example.com/admin/adsense'),e,false,()=>{throw Error('must not render');});
 assert.equal(res.status,303); assert.equal(res.headers.get('location'),'/admin');
 assert.match(res.headers.get('cache-control'),/no-store/);
});
test('cross-origin and missing Origin mutations are forbidden',async()=>{
 for(const origin of [undefined,'https://evil.example']){
 const res=await handleAdSenseRoute(new Request('https://example.com/admin/adsense/connect',{method:'POST',headers:{Cookie:cookie,...(origin?{Origin:origin}:{})}}),e,true,render);
 assert.equal(res.status,403);
 }
});
test('OAuth start uses PKCE, minimal scope, offline access and encrypted HttpOnly state bound to session',async()=>{
 const res=await handleAdSenseRoute(new Request('https://example.com/admin/adsense/connect',{method:'POST',headers:{Cookie:cookie,Origin:'https://example.com'}}),e,true,render);
 const url=new URL(res.headers.get('location'));
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.searchParams.get('redirect_uri'),'https://example.com/admin/adsense/callback');
 assert.equal(url.searchParams.get('scope'),'openid email https://www.googleapis.com/auth/adsense.readonly');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('access_type'),'offline');
 assert.match(res.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
 assert.ok(!res.headers.get('set-cookie').includes(session));
});
test('callback rejects missing, tampered, expired and other-session state before token exchange and redirects away from codes',async()=>{
 const before=globalThis.fetch; let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not fetch');};
 try {
  for(const stateCookie of ['', 'bad.payload', await seal(e,'oauth-state',{nonce:'nonce',expires:Date.now()-1,session:await digest(session)}),await seal(e,'oauth-state',{nonce:'nonce',expires:Date.now()+10000,session:'another-session'})]){
   const res=await handleAdSenseRoute(new Request('https://example.com/admin/adsense/callback?state=nonce&code=private-code',{headers:{Cookie:cookie+'; __Secure-adsense-oauth='+stateCookie}}),e,true,render);
   assert.equal(res.status,303); assert.equal(res.headers.get('location'),'/admin/adsense?status=oauth_error');
   assert.match(res.headers.get('set-cookie'),/Max-Age=0/); assert.equal(await res.text(),'');
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=before;}
});
test('dashboard GET never makes upstream calls and has private no-store headers',async()=>{
 const before=globalThis.fetch;globalThis.fetch=async()=>{throw Error('must not fetch');};
 try {
 const res=await handleAdSenseRoute(new Request('https://example.com/admin/adsense'),e,true,render);
 assert.equal(res.status,200); assert.match(res.headers.get('cache-control'),/private, no-store/);
 assert.equal(JSON.parse(await res.text()).view.connected,false);
 }finally{globalThis.fetch=before;}
});
test('successful callback validates identity, stores encrypted connection and only then redirects',async()=>{
 const objects=new Map(); const local={...e,IMAGES:{get:async()=>null,put:async(k,v)=>{objects.set(k,v);return{etag:'1'};}},DB:{prepare(sql){assert.match(sql,/settings/);return{bind(){return{first:async()=>({value:'ca-pub-9160979665550731'})}}};}}};
 const state=await seal(local,'oauth-state',{nonce:'nonce',verifier:'pkce-verifier',expires:Date.now()+60000,session:await digest(session)});
 const old=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,init)=>{
 calls.push(String(url));
 if(String(url).includes('/token')){assert.equal(new URLSearchParams(init.body).get('code_verifier'),'pkce-verifier');return Response.json({access_token:'private-access',refresh_token:'private-refresh',scope:'openid email https://www.googleapis.com/auth/adsense.readonly'});}
 if(String(url).includes('userinfo'))return Response.json({email:'expected@example.com',email_verified:true});
 return Response.json({name:'accounts/pub-9160979665550731',timeZone:{id:'America/Sao_Paulo'}});
 };
 try {
 const res=await handleAdSenseRoute(new Request('https://example.com/admin/adsense/callback?state=nonce&code=private-code',{headers:{Cookie:cookie+'; __Secure-adsense-oauth='+state}}),local,true,render);
 assert.equal(res.headers.get('location'),'/admin/adsense?status=connected');assert.equal(calls.length,3);
 assert.equal(objects.size,1);assert.ok(![...objects.values()][0].includes('private-refresh'));assert.match(res.headers.get('set-cookie'),/Max-Age=0/);
 }finally{globalThis.fetch=old;}
});
