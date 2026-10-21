import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const NOW=Date.UTC(2026,9,16,15);
const post=(slug,extra={})=>({slug,title:slug,pub_date:NOW-3600000,hero_image:'/img/'+slug+'.jpg',...extra});
const lib=()=>import('./sectionRecommendations.ts');

test('um card por seção H2 com conteúdo, inclusive a última, sem card na introdução',async()=>{
 const {injectSectionRecommendations}=await lib();
 const html='<p>Introdução</p><h2>Primeiro</h2><p>Parte um</p><h2>Segundo</h2><p>Parte dois</p><h2>Terceiro</h2><p>Parte três</p>';
 const result=injectSectionRecommendations(html,[post('a'),post('b'),post('c')],'atual',NOW);
 assert.equal((result.html.match(/data-related-card/g)||[]).length,3);
 assert.match(result.html,/<p>Parte um<\/p>[\s\S]*?href="\/a"[\s\S]*?<h2>Segundo/);
 assert.match(result.html,/<p>Parte três<\/p>[\s\S]*?href="\/c"/);
 assert.ok(result.html.indexOf('data-related-card')>result.html.indexOf('Parte um'));
 assert.deepEqual([...result.usedSlugs],['a','b','c']);
});

test('não confunde H2 de citação, figure, script, comentário ou atributo com seção',async()=>{
 const {injectSectionRecommendations}=await lib();
 const html='<h2>Primeiro</h2><p>Um</p><blockquote><h2>Citado</h2><p>Dois</p></blockquote><figure><h2>Legenda</h2><img src="/img/a"></figure><!-- <h2>falso</h2> --><script>var x="<h2>falso</h2>";</script><p title="<h2>falso">Texto</p><h2>Segundo</h2><p>Fim</p>';
 const result=injectSectionRecommendations(html,[post('a'),post('b'),post('c')],'atual',NOW);
 assert.equal((result.html.match(/data-related-card/g)||[]).length,2);
 assert.ok(result.html.indexOf('data-related-card')>result.html.indexOf('</script>'));
});

test('não repete artigo nem o atual para preencher mais seções',async()=>{
 const {injectSectionRecommendations}=await lib();
 const result=injectSectionRecommendations('<h2>A</h2><p>A</p><h2>B</h2><p>B</p><h2>C</h2><p>C</p>',[post('atual'),post('a'),post('a')],'atual',NOW);
 assert.equal((result.html.match(/data-related-card/g)||[]).length,1);
 assert.deepEqual([...result.usedSlugs],['a']);
});

test('preserva ordem do ranking entre novelas e corta vencidos, futuros e rascunhos',async()=>{
 const {selectSectionCandidates}=await lib();
 const candidates=[post('b',{category:'Outra novela'}),post('velho',{pub_date:NOW-73*3600000}),post('a',{category:'Mesma novela'}),post('futuro',{pub_date:NOW+1}),post('rascunho',{draft:1}),post('invalido',{pub_date:NaN})];
 assert.deepEqual(selectSectionCandidates(candidates,'atual',NOW).map(p=>p.slug),['b','a']);
 assert.equal(selectSectionCandidates(Array.from({length:40},(_,i)=>post('p'+i)),'atual',NOW).length,12);
});

test('ignora seções vazias, conserva HTML e aceita um único artigo sem H2',async()=>{
 const {injectSectionRecommendations}=await lib();
 const html='<h2>Vazia</h2>\n<h2>Texto</h2><p>Fim</p>';
 const result=injectSectionRecommendations(html,[post('a'),post('b')],'atual',NOW);
 assert.equal((result.html.match(/data-related-card/g)||[]).length,1);
 assert.ok(result.html.startsWith(html));
 const short=injectSectionRecommendations('<p>Artigo curto</p>',[post('a')],'atual',NOW);
 assert.equal(short.usedSlugs.size,1);
 assert.equal(injectSectionRecommendations('',[post('a')],'atual',NOW).usedSlugs.size,0);
});

test('escapa título, recusa URL de imagem perigosa e não insere Teoria ou slideshow',async()=>{
 const {injectSectionRecommendations}=await lib();
 const result=injectSectionRecommendations('<p>Texto</p>',[post('seguro',{title:'<img src=x onerror=alert(1)> & "oi"',hero_image:'javascript:alert(1)'})],'atual',NOW);
 assert.match(result.html,/&lt;img/);
 assert.match(result.html,/&amp;/);
 assert.doesNotMatch(result.html,/src="javascript:|<img[^>]* onerror=|TEORIA|data-dot|rcmd__dot/i);
 assert.match(result.html,/Notícias quentes do momento/);
 assert.doesNotMatch(result.html,/Ler a matéria|section-rec__cta/);
 assert.match(result.html,/section-rec--text-only/);
});

test('render real substitui Em Alta e não repete cards no rodapé',async()=>{
 const built=await build({entryPoints:['src/render.ts'],bundle:true,write:false,format:'esm',platform:'neutral',mainFields:['module','main']});
 const {renderPost}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const article={id:1,slug:'atual',title:'Atual',description:'Descrição',content:'<h2>Um</h2><p>Texto um.</p><h2>Dois</h2><p>Texto dois.</p>',category:'Novela A',tags:'',author:'Autor',hero_image:null,draft:0,pub_date:Date.now(),updated_date:Date.now(),source_url:null};
 const candidates=[post('a',{pub_date:Date.now()}),post('b',{pub_date:Date.now()})];
 const html=renderPost({SITE_TITLE:'Site',SITE_DESCRIPTION:'Teste'},new Request('https://example.com/atual'),article,candidates,undefined,undefined,candidates);
 assert.equal((html.match(/data-related-card/g)||[]).length,2);
 assert.doesNotMatch(html, /related-faces|data-face-|section-rec__pause/);
 assert.doesNotMatch(html,/class="trend"|>Em Alta</);
 assert.equal((html.match(/href="\/a"/g)||[]).length,1);
 assert.equal((html.match(/href="\/b"/g)||[]).length,1);
});

test('ranking protegido oferece 12 candidatos de 24h sem consultar o D1 novamente',async()=>{
 const {rankingsForArticle}=await import('./rankingSnapshot.ts');
 const rows=Array.from({length:20},(_,i)=>({path:'/p'+i,views:100-i}));
 const result=rankingsForArticle({generatedAt:NOW,top48h:[],top24h:rows},'/p0');
 assert.equal(result.top24h.length,12);
 assert.equal(result.top24h[0].path,'/p1');
 const source=await readFile('src/index.ts','utf8');
 assert.doesNotMatch(source,/topPublicPostsByViews\(env\.DB,\s*24,\s*\d+,\s*pathname\)/);
});

test('imagem dentro de comentário, script ou style não transforma seção vazia em conteúdo',async()=>{
 const {injectSectionRecommendations}=await lib();
 const html='<h2>Vazia</h2><!-- <img src=hidden> --><script>var x="<img src=hidden>";</script><style>/* <img src=hidden> */</style><h2>Texto</h2><p>Real</p>';
 const result=injectSectionRecommendations(html,[post('a'),post('b')],'atual',NOW);
 assert.equal(result.usedSlugs.size,1);
});


test('card separa novela do título, mostra legenda pequena e elimina CTA redundante',async()=>{
 const {renderSectionCard}=await lib();
 const html=renderSectionCard(post('pilar',{title:'Pilar descobre a prova | Quem Ama Cuida',category:'Quem ama cuida'}),1);
 assert.match(html,/section-rec__eyebrow">[\s\S]*?<span>Notícias quentes do momento<\/span>/);
 assert.match(html.replace(/<\/?mark[^>]*>/g,''),/section-rec__title">Pilar descobre a prova</);
 assert.match(html,/section-rec__novela">Quem ama cuida</);
 assert.doesNotMatch(html,/Leia também|Ler a matéria|section-rec__cta/);
});

test('limpa sufixo com barra e preserva nome da novela que faz parte da notícia',async()=>{
 const {renderSectionCard}=await lib();
 const html=renderSectionCard(post('adriana',{title:'Adriana retorna em Quem Ama Cuida / Quem Ama Cuida',category:'Quem Ama Cuida'}),1);
 assert.match(html.replace(/<\/?mark[^>]*>/g,''),/section-rec__title">Adriana retorna em Quem Ama Cuida</);
 const escaped=renderSectionCard(post('titulo',{title:'Personagem revela segredo | Novela & Cia',category:'Novela & Cia'}),1);
 assert.match(escaped,/section-rec__novela">Novela &amp; Cia</);
});

test('card usa foto do conteúdo quando a capa não está preenchida',async()=>{
 const {renderSectionCard}=await lib();
 const html=renderSectionCard(post('sem-capa',{hero_image:null,content:'<p>Texto</p><figure><img src="/img/foto-do-artigo.jpg"></figure>',category:'Novela'}),1);
 assert.match(html,/class="section-rec__image" src="\/img\/foto-do-artigo.jpg"/);
 assert.doesNotMatch(html,/section-rec--text-only/);
});


test('limita o título a uma frase vermelha e uma preta, mantendo o restante sem grifo',async()=>{
 const {renderSectionCard}=await lib();
 const html=renderSectionCard(post('heitor',{title:'Heitor encontra ligação entre fraude da auditoria e morte de Arthur e faz acusação inesperada | Quem Ama Cuida',category:'Quem Ama Cuida'}),1);
 const title=html.match(/<strong class="section-rec__title">([\s\S]*?)<\/strong>/)[1];
 assert.equal((title.match(/<mark\b/g)||[]).length,2);
 assert.match(title,/<mark class="section-rec__highlight section-rec__highlight--hot">encontra ligação<\/mark>/);
 assert.match(title,/<mark class="section-rec__highlight section-rec__highlight--dark">acusação inesperada<\/mark>/);
 assert.match(title,/entre fraude da auditoria e morte de Arthur e faz/);
 assert.equal(title.replace(/<[^>]+>/g,''),'Heitor encontra ligação entre fraude da auditoria e morte de Arthur e faz acusação inesperada');
 assert.deepEqual([...title.matchAll(/highlight--(hot|dark)/g)].map(m=>m[1]),['hot','dark']);
 const safe=renderSectionCard(post('seguro',{title:'<script>alert(1)</script> ameaça & segredo'}),1);
 assert.doesNotMatch(safe,/<script>/);
 assert.match(safe,/&lt;script&gt;/);
 const plain=renderSectionCard(post('normal',{title:'Um encontro em Paris'}),1);
 assert.equal((plain.match(/<mark\b/g)||[]).length,2);
 const word=renderSectionCard(post('palavra',{title:'Ameaçador comenta o segredo'}),1);
 assert.doesNotMatch(word,/>Ameaça<\/mark>/i);
});


test('sempre aplica dois grifos na ordem vermelho/preto nos dez títulos reais e no vocabulário novo',async()=>{
 const {renderSectionCard}=await lib();
 const titles=["Heitor encontra ligação entre fraude da auditoria e morte de Arthur e faz acusação inesperada", "Adriana é absolvida e Pilar recebe notícia que pode levá-la diretamente para prisão", "Juarez é seguido após visitar túmulo de Juli e recebe ameaça sobre acidente", "Virgínia sofre sangramento e Mirinho descobre que pode perder o próprio filho", "Samuca escolhe Bela diante de Peixe e provoca reviravolta na disputa pela guarda", "Binta descobre que Alika está grávida e prepara armadilha contra herdeiro de Tonho", "Margô recebe resultado da biópsia e faz pedido emocionante a Lucas", "Mirinho coloca fortuna em nome de Virgínia e Manoel descobre motivo assustador", "Peixe descobre plano de Vanessa contra Bela e precisa escolher de que lado ficará", "Jendal descobre que rebeldes estão tomando palácio e precisa escolher entre Alika e o trono", "Cecília encontra fotografias na gaveta e entrega documento ao delegado", "Luz do sol ilumina as ruas de uma pequena cidade"];
 for(const title of titles){
  const html=renderSectionCard(post('amostra',{title}),1);
  const rendered=html.match(/<strong class="section-rec__title">([\s\S]*?)<\/strong>/)[1];
  assert.deepEqual([...rendered.matchAll(/highlight--(hot|dark)/g)].map(m=>m[1]),['hot','dark'],title);
  assert.equal(rendered.replace(/<[^>]+>/g,''),title);
  const marked=[...rendered.matchAll(/<mark[^>]*>([^<]+)<\/mark>/g)].map(m=>m[1]);
  assert.ok(marked.every(text=>text.trim().split(/\s+/).length>=2),title);
  assert.ok(marked.join(' ').split(/\s+/).length<title.split(/\s+/).length,title);
  assert.equal(renderSectionCard(post('amostra',{title}),1),html);
 }
});

test('foto estática tenta a alternativa uma vez e mantém o card em texto se ambas falham',async()=>{
 const {runInNewContext}=await import('node:vm');
 const built=await build({entryPoints:['src/render.ts'],bundle:true,write:false,format:'esm',platform:'neutral',mainFields:['module','main']});
 const {renderPost,renderAdminAdSense,renderHome}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const env={SITE_TITLE:'Site',SITE_DESCRIPTION:'Teste'};
 const article=post('atual',{id:1,description:'Descrição',tags:'',author:'Autor',content:'<p>Texto.</p>',pub_date:Date.now(),updated_date:Date.now(),draft:0,category:'Novela',source_url:null});
 const html=renderPost(env,new Request('https://example.com/atual'),article,[post('recomendado',{pub_date:Date.now(),content:'<img src="/img/alternativa.jpg">'})]);
 const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes("document.querySelectorAll('.section-rec__image')"));
 const fallback=script.slice(script.indexOf("    document.querySelectorAll('.section-rec__image')"),script.indexOf("    var hero ="));
 for(const alreadyBroken of [false,true]){
  const classes=new Set(),listeners={};
  const img={src:'/img/primeira.jpg',complete:alreadyBroken,naturalWidth:alreadyBroken?0:1024,getAttribute:()=>'/img/alternativa.jpg',addEventListener:(event,fn)=>{listeners[event]=fn},closest:()=>({classList:{add:c=>classes.add(c)}})};
  runInNewContext(fallback,{document:{querySelectorAll:()=>[img]}});
  if(!alreadyBroken)assert.equal(img.src,'/img/primeira.jpg');
  if(!alreadyBroken)listeners.error();
  assert.equal(img.src,'/img/alternativa.jpg');assert.equal(classes.size,0);
  listeners.error();assert.ok(classes.has('section-rec--text-only'));
 }
 const admin=renderAdminAdSense(env,{configured:false,connected:false});
 assert.doesNotMatch(admin,/teste-fotos|Teste de fotos/);
 assert.match(admin,/Receita do AdSense/);
 assert.doesNotMatch(renderHome(env,new Request('https://example.com/'),[article]),/cdh-photo|photo_ab|photo-motion/);
});
