/**
 * Eventos do Google Analytics 4 para medir anúncios e engajamento.
 *
 * Só é injetado quando o GA está ativo (gaId) e fora do /admin — ver layout() em render.ts.
 * Tudo por delegação de eventos (1 listener por tipo), sem biblioteca externa.
 *
 * Eventos (nomes/parâmetros pensados para cair em dimensões que o GA4 JÁ TEM, sempre que dá):
 *  - ad_unit_click   {ad_source, ad_position, ad_format, ad_slot, ad_creative, ad_index}
 *        AdSense: estimado pelo foco no iframe do anúncio (o clique acontece dentro do iframe
 *        do Google, que não avisa a página). Banner nativo: clique real no link.
 *        Obs.: `ad_click`/`ad_impression` são nomes RESERVADOS no GA4, por isso ad_unit_click.
 *  - read_progress   {percent_scrolled: 25|50|75|100}  — quanto do TEXTO do artigo (.prose) foi lido.
 *        percent_scrolled é dimensão nativa ("Porcentagem rolada").
 *  - select_content  {content_type, link_url}  — cliques de recirculação (Em alta, relacionados,
 *        botões do fim do artigo, links no texto, cards da home…). content_type é dimensão nativa.
 *  - share           {method, content_type, item_id}  — evento recomendado do GA4.
 *  - click           {link_url, link_domain, outbound: true}  — link para fora do site, no mesmo
 *        formato da "medição otimizada" (dimensões nativas). NÃO ligar "Cliques de saída" na
 *        medição otimizada, senão conta em dobro.
 *  - adblock_detected (1× por sessão) — o script do AdSense não carregou; mede a fatia do público
 *        que só os banners nativos alcançam.
 *
 * Além disso o config do GA recebe content_group = novela (dimensão nativa "Grupo de conteúdo"),
 * então dá para ver tempo de engajamento, leitura e cliques por novela sem configurar nada.
 *
 * Dimensões personalizadas a registrar no GA (Administrador → Definições personalizadas,
 * escopo Evento): ad_source, ad_position, ad_format, ad_slot, ad_creative, ad_index.
 *
 * Este módulo não importa nada em runtime (roda direto no `node --test`).
 */

/** Grupo de conteúdo do GA para a página: a novela no artigo, "Home" na home. */
export function gaContentGroup(opts: { type?: string; category?: string; path: string }): string {
  if (opts.type === 'article') {
    const c = (opts.category ?? '').trim();
    return c && c !== 'Sem categoria' ? c.slice(0, 100) : 'Sem novela';
  }
  if (opts.path === '/') return 'Home';
  return 'Institucional';
}

/** Parâmetros do gtag('config') como JSON seguro dentro de <script>. */
export function gaConfigParams(contentGroup: string): string {
  return JSON.stringify({ content_group: contentGroup })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Script de eventos (fim do <body>). ES5 de propósito (Android antigo).
 * Não faz nada se o gtag não existir.
 */
export function renderGaEventsScript(): string {
  return `<script>
(function(){
if(typeof window.gtag!=='function')return;
var W=window,D=document;
function ev(n,p){try{gtag('event',n,p);}catch(e){}}
function slug(){return location.pathname.replace(/^\\/+|\\/+$/g,'')||'home';}

/* ---------- Anúncios ---------- */
var WRAPS=[['ad-slot--before-post','beforePost'],['ad-slot--top','topOfContent'],['ad-slot--after','afterContent'],['ad-slot--bottom','bottomOfPage'],['ad-inarticle','inContent'],['post-card--ad','betweenCards'],['ad-sticky-footer','stickyFooter']];
function adPosition(el){
  var mix=el.closest('[data-pl]');if(mix)return mix.getAttribute('data-pl');
  for(var i=0;i<WRAPS.length;i++){if(el.closest('.'+WRAPS[i][0]))return WRAPS[i][1];}
  var ins=el.closest('ins.adsbygoogle');
  if(ins&&ins.hasAttribute('data-anchor-status'))return 'auto_anchor';
  if(ins&&ins.hasAttribute('data-vignette-loaded'))return 'auto_vignette';
  return 'auto_ads';
}
/* N-ésimo anúncio dentro do texto (1 = o mais alto). */
function adIndex(el){
  var unit=el.closest('.prose > .ad-inarticle, .prose > .cdh-mix');if(!unit)return 0;
  var all=D.querySelectorAll('.prose > .ad-inarticle, .prose > .cdh-mix');
  for(var i=0;i<all.length;i++){if(all[i]===unit)return i+1;}
  return 0;
}
function adParams(el,src,extra){
  var p={ad_source:src,ad_position:adPosition(el)};
  var idx=adIndex(el);if(idx)p.ad_index=idx;
  for(var k in extra){if(extra[k])p[k]=extra[k];}
  return p;
}
/* AdSense: o clique acontece dentro do iframe do Google; a página só percebe que perdeu
   o foco para ele. Estimativa (padrão de mercado); o número oficial vem do AdSense. */
var lastAd=0;
W.addEventListener('blur',function(){
  setTimeout(function(){
    var f=D.activeElement;
    if(!f||f.tagName!=='IFRAME')return;
    var ins=f.closest('ins.adsbygoogle');if(!ins)return;
    var now=Date.now();if(now-lastAd<2000)return;lastAd=now;
    ev('ad_unit_click',adParams(ins,'adsense',{ad_format:ins.getAttribute('data-ad-format')||'',ad_slot:ins.getAttribute('data-ad-slot')||'auto'}));
  },0);
});
/* Ao voltar para a aba, solta o foco do iframe: senão trocar de aba de novo contaria outro clique. */
W.addEventListener('focus',function(){
  var f=D.activeElement;
  if(f&&f.tagName==='IFRAME'&&f.closest('ins.adsbygoogle')){try{f.blur();}catch(e){}}
});

/* ---------- Cliques (delegação) ---------- */
var CT=[
  ['.trend','em_alta'],['.rcmd','relacionados'],['.btn-primary-cta','fim_home'],['.btn-secondary-cta','fim_novela'],
  ['.post__kicker','novela_topo'],['.post-card','card_home'],['.site-logo','logo'],['.site-footer','rodape'],['.author-box','autor']
];
D.addEventListener('click',function(e){
  var t=e.target;if(!t||!t.closest)return;
  var spot=t.closest('a.cdh-spot');
  if(spot){
    var fm=(spot.className.match(/cdh-spot--(\\S+)/)||[])[1]||'';
    ev('ad_unit_click',adParams(spot,'native',{ad_format:fm,ad_creative:spot.getAttribute('data-cr')||'',link_url:spot.href}));
    return;
  }
  var sb=t.closest('.share-bar__btn');
  if(sb){
    var m=/--whats/.test(sb.className)?'whatsapp':/--x\\b/.test(sb.className)?'x':sb.hasAttribute('data-copy')?'copiar_link':'outro';
    ev('share',{method:m,content_type:'artigo',item_id:slug()});
    return;
  }
  var a=t.closest('a[href]');if(!a)return;
  var u;try{u=new URL(a.href,location.href);}catch(x){return;}
  if(u.protocol!=='http:'&&u.protocol!=='https:')return;
  if(u.hostname!==location.hostname){
    ev('click',{link_url:u.href,link_domain:u.hostname,outbound:true});
    return;
  }
  var ct='';
  for(var i=0;i<CT.length;i++){if(a.closest(CT[i][0])){ct=CT[i][1];break;}}
  if(!ct&&a.closest('.prose'))ct='link_no_texto';
  if(ct)ev('select_content',{content_type:ct,link_url:u.pathname+u.search});
},true);

/* ---------- Leitura do artigo ---------- */
var prose=D.querySelector('.prose');
if(prose){
  var marks=[25,50,75,100],done={},ticking=false;
  function check(){
    ticking=false;
    var r=prose.getBoundingClientRect();if(r.height<50)return;
    var pct=(W.innerHeight-r.top)/r.height*100;
    for(var i=0;i<marks.length;i++){
      var mk=marks[i];
      if(!done[mk]&&pct>=(mk===100?98:mk)){done[mk]=1;ev('read_progress',{percent_scrolled:mk});}
    }
    if(done[100])W.removeEventListener('scroll',onScroll);
  }
  /* Só conta depois da 1ª rolagem: artigo curto que cabe na tela não vira "leu 100%" sozinho. */
  function onScroll(){if(!ticking){ticking=true;setTimeout(check,150);}}
  W.addEventListener('scroll',onScroll,{passive:true});
}

/* ---------- Adblock (1× por sessão) ---------- */
W.addEventListener('load',function(){
  setTimeout(function(){
    try{if(sessionStorage.getItem('cdh_adb'))return;}catch(e){}
    var units=D.querySelectorAll('ins.adsbygoogle');if(!units.length)return;
    var loaded=!!(W.adsbygoogle&&W.adsbygoogle.loaded);
    for(var i=0;i<units.length&&!loaded;i++){if(units[i].hasAttribute('data-adsbygoogle-status'))loaded=true;}
    try{sessionStorage.setItem('cdh_adb','1');}catch(e){}
    if(!loaded)ev('adblock_detected',{ad_units:units.length});
  },4000);
});
})();
</script>`;
}
