// Local-only reproduction: node scripts/photo-focus-lab.mjs, then open http://127.0.0.1:8766.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const samples=JSON.parse(await fs.readFile(new URL('./photo-focus-samples.json',import.meta.url),'utf8'));
const images=new Map();
http.createServer(async(req,res)=>{
 try{
  const route=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  if(route==='/samples.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(samples));return;}
  const sample=samples.find(s=>s.source===route);
  if(sample){
   if(!images.has(route))images.set(route,(async()=>{
    const response=await fetch('https://capitulodehoje.com.br'+route,{headers:{'User-Agent':'Mozilla/5.0',Referer:sample.url},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Foto indisponível');
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>8*1024*1024)throw Error('Foto acima do limite');return bytes;
   })());
   res.setHeader('Content-Type','image/png');res.end(await images.get(route));return;
  }
  let file;
  if(route==='/')file=path.join(root,'scripts/photo-focus-lab.html');
  else if(/^\/[a-z-]+\.js$/.test(route)||/^\/vendor\/related-faces-v1\/[a-z0-9_.-]+$/.test(route))file=path.join(root,'public',route);
  if(!file){res.writeHead(404);res.end('Not found');return;}
  res.setHeader('Content-Type',route==='/'?'text/html;charset=utf-8':route.endsWith('.js')?'text/javascript':route.endsWith('.json')?'application/json':'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(502);res.end('Arquivo de teste indisponível. Nenhum serviço pago foi chamado.');}
}).listen(8766,'127.0.0.1',()=>console.log('Teste local: http://127.0.0.1:8766'));
