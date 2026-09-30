/**
 * Banners nativos (anúncios próprios, ex.: Toda Fase) × AdSense, com split POR USUÁRIO.
 *
 * Settings (D1): native.config → JSON (NativeConfig). Eventos (D1): tabela `ad_mix_events`.
 *
 * Como funciona (o HTML é CACHEADO na borda, então nada é sorteado no servidor):
 *  - Cada visitante cai num grupo, fixo por teste (localStorage): `share`% → grupo NATIVO,
 *    o resto → grupo ADSENSE.
 *  - Grupo AdSense: tudo como sempre. O runtime carrega o adsbygoogle.js (com Auto ads: âncora
 *    e vinheta) e cada posição recebe o seu <ins> com exatamente 1 push.
 *  - Grupo nativo: o adsbygoogle.js NEM CARREGA. Cada posição ligada no teste recebe um banner
 *    nativo (até `maxPerPage`); as demais ficam vazias. Âncora e vinheta NATIVAS entram no lugar
 *    das do Google — são os formatos que mais rendem no AdSense (RPM ~5x o dos blocos).
 *  - A comparação é por PAGEVIEW (receita por mil páginas), porque âncora e vinheta fazem metade
 *    da receita do AdSense e não aparecem como impressão de bloco.
 *  - Os banners VARIAM ao longo da página (sem repetir) e a ordem é sorteada a cada página. Por
 *    isso o ranking entre banners usa o CTR AJUSTADO À POSIÇÃO (padronização indireta: cliques
 *    reais ÷ cliques esperados se o banner tivesse o CTR médio de cada posição/formato em que
 *    apareceu) — âncora e topo recebem mais clique que o meio do texto por natureza.
 *  - Eventos em lote (sendBeacon) para /api/ev → 1 batch de escrita no D1 por envio.
 *  - O grupo vai para o GA como user property `ad_arm` (nativo | adsense).
 *
 * Este módulo não importa nada em runtime (só tipos) para rodar direto no `node --test`.
 */

// ============== Tipos e constantes ==============

/** Tamanhos de criativo suportados. '16x9' = nativo 1200x675 (ou qualquer 16:9). */
export type NativeFormat = '16x9' | '300x250' | '320x100' | '728x90' | '320x50';
export const NATIVE_FORMATS: NativeFormat[] = ['16x9', '300x250', '320x100', '728x90', '320x50'];

/** Formato pedido por uma posição. 'faixa' = 320x100 no celular / 728x90 no desktop. */
export type SlotFormat = '16x9' | '300x250' | 'faixa' | '320x50';
export const SLOT_FORMATS: SlotFormat[] = ['16x9', '300x250', 'faixa', '320x50'];

/**
 * Posições. As 7 do AdSense usam as mesmas chaves do AdConfig e viram slot misto no HTML.
 * `anchor` (faixa fixa no rodapé) e `vignette` (tela cheia ao trocar de página) existem só no
 * grupo nativo: o runtime cria, no lugar da âncora e da vinheta automáticas do Google.
 */
export type MixPlacement =
  | 'anchor' | 'vignette'
  | 'beforePost' | 'topOfContent' | 'inContent' | 'afterContent'
  | 'bottomOfPage' | 'betweenCards' | 'stickyFooter';
export const MIX_PLACEMENTS: MixPlacement[] = [
  'anchor', 'vignette', 'beforePost', 'topOfContent', 'inContent', 'afterContent', 'bottomOfPage', 'betweenCards', 'stickyFooter',
];

/** Formatos que fazem sentido em cada posição (o 1º é o recomendado). */
export const PLACEMENT_FORMATS: Record<MixPlacement, SlotFormat[]> = {
  anchor: ['faixa', '320x50'],
  vignette: ['16x9', '300x250'],
  beforePost: ['faixa', '300x250', '16x9'],
  topOfContent: ['300x250', '16x9', 'faixa'],
  inContent: ['16x9', '300x250', 'faixa'],
  afterContent: ['300x250', '16x9', 'faixa'],
  bottomOfPage: ['300x250', '16x9', 'faixa'],
  betweenCards: ['16x9', '300x250'],
  stickyFooter: ['320x50', 'faixa'],
};

export interface NativeImage {
  src: string;   // '/img/nv-xxxx.jpg' (cópia no R2) ou URL https
  href: string;  // destino do clique (com UTM)
  w: number;
  h: number;
}

export interface NativeCreative {
  id: string;      // 'v1-nova-fase'
  label: string;   // 'V1 · Nova fase'
  alt: string;     // headline / texto alternativo
  active: boolean;
  images: Partial<Record<NativeFormat, NativeImage>>;
}

export interface NativePlacementCfg {
  on: boolean;
  format: SlotFormat;
}

export interface NativeConfig {
  enabled: boolean;
  /** % dos USUÁRIOS no grupo nativo (0–100): esses não veem AdSense nenhum. */
  share: number;
  /** Teto de banners nativos DENTRO da página no grupo nativo (0 = sem limite). Âncora e
   *  vinheta não contam. O que passar do teto fica vazio — nunca AdSense. */
  maxPerPage: number;
  /** Id do teste atual. Muda ao "reiniciar contagem"; eventos antigos deixam de contar. */
  testId: string;
  startedAt: number;
  /** RPM DE PÁGINA do AdSense (R$ por mil pageviews, somando blocos + âncora + vinheta),
   *  digitado pelo admin a partir do relatório do AdSense. */
  adsensePageRpm: number;
  /** Quanto vale um clique no banner nativo (R$) = conversão × lucro por venda. */
  valuePerClick: number;
  /** Última URL usada no importador. */
  sourceUrl: string;
  placements: Record<MixPlacement, NativePlacementCfg>;
  creatives: NativeCreative[];
}

/**
 * Padrão = imitar onde o AdSense mais rende neste site: âncora (RPM US$ 0,96) e vinheta
 * (US$ 1,17) primeiro; depois o bloco logo abaixo do compartilhar (US$ 0,33, 64% visível).
 * "Antes do título" fica de fora (pior visibilidade e causa o pulo de layout).
 */
export const DEFAULT_NATIVE_PLACEMENTS: Record<MixPlacement, NativePlacementCfg> = {
  anchor:       { on: true,  format: 'faixa' },
  vignette:     { on: true,  format: '16x9' },
  beforePost:   { on: false, format: 'faixa' },
  topOfContent: { on: true,  format: '300x250' },
  inContent:    { on: true,  format: '16x9' },
  afterContent: { on: true,  format: '300x250' },
  bottomOfPage: { on: false, format: '300x250' },
  betweenCards: { on: true,  format: '16x9' },
  stickyFooter: { on: false, format: '320x50' },
};

export const DEFAULT_NATIVE_CONFIG: NativeConfig = {
  enabled: false,
  share: 20,
  maxPerPage: 4,
  testId: '',
  startedAt: 0,
  adsensePageRpm: 0,
  valuePerClick: 0,
  sourceUrl: '',
  placements: DEFAULT_NATIVE_PLACEMENTS,
  creatives: [],
};

export const PLACEMENT_LABELS: Record<MixPlacement, string> = {
  anchor: 'Âncora (faixa fixa no rodapé)',
  vignette: 'Vinheta (tela cheia ao trocar de página)',
  beforePost: 'Antes do título',
  topOfContent: 'Topo do conteúdo',
  inContent: 'No meio do texto',
  afterContent: 'Final do conteúdo',
  bottomOfPage: 'Rodapé da página',
  betweenCards: 'Entre cards (home)',
  stickyFooter: 'Sticky mobile',
};

export const SLOT_FORMAT_LABELS: Record<SlotFormat, string> = {
  '16x9': 'Nativo 16:9',
  '300x250': 'Retângulo 300x250',
  faixa: 'Faixa (320x100 / 728x90)',
  '320x50': 'Sticky 320x50',
};

// ============== Config: parse / sanitize ==============

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Aceita só http(s) — nada de javascript:, data: etc. */
export function safeHttpUrl(u: unknown): string {
  if (typeof u !== 'string') return '';
  try {
    const url = new URL(u.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/** src de imagem: cópia local (/img/<arquivo>) ou URL http(s). */
function safeImageSrc(u: unknown): string {
  if (typeof u !== 'string') return '';
  const s = u.trim();
  if (/^\/img\/[A-Za-z0-9._-]+$/.test(s)) return s;
  return safeHttpUrl(s);
}

export function slugifyId(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function sanitizeCreative(raw: unknown): NativeCreative | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = slugifyId(String(r.id ?? ''));
  if (!id) return null;
  const images: Partial<Record<NativeFormat, NativeImage>> = {};
  const rawImages = (r.images && typeof r.images === 'object') ? r.images as Record<string, unknown> : {};
  for (const f of NATIVE_FORMATS) {
    const img = rawImages[f] as Record<string, unknown> | undefined;
    if (!img) continue;
    const src = safeImageSrc(img.src);
    const href = safeHttpUrl(img.href);
    const w = clampNum(img.w, 1, 4000, 0);
    const h = clampNum(img.h, 1, 4000, 0);
    if (src && href && w && h) images[f] = { src, href, w, h };
  }
  return {
    id,
    label: String(r.label ?? id).slice(0, 80) || id,
    alt: String(r.alt ?? '').slice(0, 200),
    active: r.active !== false,
    images,
  };
}

export function parseNativeConfig(raw: string | null): NativeConfig {
  let parsed: Record<string, unknown> = {};
  if (raw) {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === 'object') parsed = j;
    } catch { /* config corrompida → defaults */ }
  }
  const placements = { ...DEFAULT_NATIVE_PLACEMENTS };
  const rawPl = (parsed.placements && typeof parsed.placements === 'object')
    ? parsed.placements as Record<string, Record<string, unknown>> : {};
  for (const k of MIX_PLACEMENTS) {
    const p = rawPl[k];
    if (!p) continue;
    const format = PLACEMENT_FORMATS[k].includes(p.format as SlotFormat) ? p.format as SlotFormat : placements[k].format;
    placements[k] = { on: p.on === true, format };
  }
  const seen = new Set<string>();
  const creatives: NativeCreative[] = [];
  for (const c of Array.isArray(parsed.creatives) ? parsed.creatives : []) {
    const s = sanitizeCreative(c);
    if (s && !seen.has(s.id)) { seen.add(s.id); creatives.push(s); }
  }
  const testId = typeof parsed.testId === 'string' && /^[a-z0-9]{1,16}$/.test(parsed.testId) ? parsed.testId : '';
  return {
    enabled: parsed.enabled === true,
    share: Math.round(clampNum(parsed.share, 0, 100, DEFAULT_NATIVE_CONFIG.share)),
    maxPerPage: Math.round(clampNum(parsed.maxPerPage, 0, 20, DEFAULT_NATIVE_CONFIG.maxPerPage)),
    testId,
    startedAt: clampNum(parsed.startedAt, 0, 8.64e15, 0),
    adsensePageRpm: clampNum(parsed.adsensePageRpm, 0, 10_000, 0),
    valuePerClick: clampNum(parsed.valuePerClick, 0, 10_000, 0),
    sourceUrl: safeHttpUrl(parsed.sourceUrl),
    placements,
    creatives,
  };
}

/** Id curto e ordenável para um novo teste. */
export function newTestId(now: number): string {
  return Math.floor(now).toString(36);
}

/** Imagem que um criativo usa numa posição (null = criativo não tem esse tamanho). */
export function slotImages(c: NativeCreative, fmt: SlotFormat): NativeFormat[] {
  if (fmt === 'faixa') return (['320x100', '728x90'] as NativeFormat[]).filter((f) => c.images[f]);
  return c.images[fmt] ? [fmt] : [];
}

/** Criativos ativos que têm ao menos um formato usado por alguma posição ligada. */
export function runnableCreatives(cfg: NativeConfig): NativeCreative[] {
  const fmts = MIX_PLACEMENTS.filter((k) => cfg.placements[k].on).map((k) => cfg.placements[k].format);
  return cfg.creatives.filter((c) => c.active && fmts.some((f) => slotImages(c, f).length > 0));
}

/** O teste está rodando no site público? */
export function nativeActive(cfg: NativeConfig | null | undefined): boolean {
  return !!cfg && cfg.enabled && cfg.share > 0 && !!cfg.testId && runnableCreatives(cfg).length > 0;
}

/**
 * Com o teste ligado, TODA posição do AdSense vira slot misto — o grupo nativo não pode ver
 * AdSense em lugar nenhum (posição desligada no teste = fica vazia para esse grupo).
 */
export function mixActive(cfg: NativeConfig | null | undefined): boolean {
  return !!cfg && nativeActive(cfg);
}

// ============== Render público ==============

/** JSON seguro dentro de <script> (sem </script>, sem U+2028/2029). */
function scriptJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Envolve o HTML do AdSense de uma posição num slot misto. O HTML do AdSense vai num
 * <template> (inerte: não carrega, não faz push) e o script decide no navegador.
 * IMPORTANTE: `adsenseHtml` deve vir SEM o `<script>push({})</script>` — o runtime faz
 * exatamente 1 push quando (e se) insere o <ins>.
 */
export function renderMixSlot(placement: MixPlacement, adsenseHtml: string): string {
  return `<div class="cdh-mix cdh-mix--${placement}" data-pl="${placement}"><template>${adsenseHtml}</template></div>`
    + `<script>window.cdhMix&&cdhMix(document.currentScript)</script>`;
}

/** Config compacta embutida na página: só criativos rodáveis e só os tamanhos usados. */
export function runtimeConfig(cfg: NativeConfig, adsenseSrc = ''): {
  t: string; s: number; m: number; a: string;
  p: Partial<Record<MixPlacement, SlotFormat>>;
  c: Array<{ i: string; a: string; f: Partial<Record<NativeFormat, [string, string, number, number]>> }>;
} {
  const p: Partial<Record<MixPlacement, SlotFormat>> = {};
  const used = new Set<NativeFormat>();
  for (const k of MIX_PLACEMENTS) {
    const pl = cfg.placements[k];
    if (!pl.on) continue;
    p[k] = pl.format;
    if (pl.format === 'faixa') { used.add('320x100'); used.add('728x90'); } else used.add(pl.format);
  }
  const c = runnableCreatives(cfg).map((cr) => {
    const f: Partial<Record<NativeFormat, [string, string, number, number]>> = {};
    for (const fmt of NATIVE_FORMATS) {
      const img = cr.images[fmt];
      if (img && used.has(fmt)) f[fmt] = [img.src, img.href, img.w, img.h];
    }
    return { i: cr.id, a: cr.alt, f };
  });
  return { t: cfg.testId, s: cfg.share, m: cfg.maxPerPage, a: adsenseSrc, p, c };
}

/** Intervalo mínimo entre duas vinhetas nativas para o mesmo leitor. */
export const NATIVE_VIGNETTE_GAP_MS = 5 * 60 * 1000;

/**
 * Runtime do teste (no <head>, antes de qualquer slot). ES5 de propósito (Android antigo).
 * Decide o grupo do visitante, carrega (ou não) o AdSense e define window.cdhMix(scriptEl).
 * `adsenseSrc` = URL do adsbygoogle.js: com o teste ligado, só o runtime o carrega.
 * Qualquer erro no sorteio cai no grupo AdSense (nunca fica sem anúncio por bug nosso).
 */
export function renderMixRuntime(cfg: NativeConfig, adsenseSrc: string): string {
  if (!nativeActive(cfg)) return '';
  return `<script>
(function(){
var C=${scriptJson(runtimeConfig(cfg, adsenseSrc))};
var W=window,D=document,KEY='cdh_nv',VIG='cdh_nv_vig',ANC='cdh_nv_anchor_off',GAP=${NATIVE_VIGNETTE_GAP_MS};
var arm='a',used=0,q={},qn=0,timer=0;
function loadAds(){
  if(W.__cdhAds||!C.a)return;W.__cdhAds=1;
  var s=D.createElement('script');s.async=true;s.src=C.a;s.crossOrigin='anonymous';
  (D.head||D.documentElement).appendChild(s);
}
function slotOf(s){var b=s&&s.previousElementSibling;if(!b||b.__cdh)return null;b.__cdh=1;return b;}
function adsense(b){
  var t=b.querySelector('template');if(!t)return;
  b.appendChild(D.importNode(t.content,true));
  if(!b.querySelector('ins.adsbygoogle'))return;
  try{(W.adsbygoogle=W.adsbygoogle||[]).push({});}catch(e){}
}
try{
  var st=null;try{st=JSON.parse(localStorage.getItem(KEY)||'null');}catch(e){}
  if(!st||st.t!==C.t||typeof st.u!=='number')st={t:C.t,u:Math.random()*100};
  if(st.u<C.s&&C.c.length)arm='n';
  try{localStorage.setItem(KEY,JSON.stringify({t:st.t,u:st.u}));}catch(e){}
}catch(e){arm='a';}
W.cdhArm=arm==='n'?'nativo':'adsense';
try{W.dataLayer=W.dataLayer||[];(function(){W.dataLayer.push(arguments);})('set','user_properties',{ad_arm:W.cdhArm});}catch(e){}
if(arm==='a'){loadAds();W.cdhMix=function(s){var b=slotOf(s);if(b)adsense(b);};}

function flush(){
  if(timer){clearTimeout(timer);timer=0;}
  if(!qn)return;
  var rows=[];for(var k in q){var r=k.split('|');r.push(q[k]);rows.push(r);}
  q={};qn=0;
  var body=JSON.stringify({t:C.t,e:rows});
  try{if(navigator.sendBeacon&&navigator.sendBeacon('/api/ev',body))return;}catch(e){}
  try{fetch('/api/ev',{method:'POST',body:body,keepalive:true});}catch(e){}
}
function track(m,ev,now){
  var k=m.concat(ev).join('|');q[k]=(q[k]||0)+1;qn++;
  if(now)flush();else if(!timer)timer=setTimeout(flush,5000);
}
D.addEventListener('visibilitychange',function(){if(D.visibilityState==='hidden')flush();});
W.addEventListener('pagehide',flush);
track(['',arm==='n'?'native':'adsense','',''],'pv');
if(arm!=='n')return;

/* ===== Grupo nativo daqui para baixo (AdSense não carrega) ===== */
var io=('IntersectionObserver' in W)?new IntersectionObserver(function(es){
  for(var i=0;i<es.length;i++){var e=es[i];
    if(!e.isIntersecting||e.boundingClientRect.height<2)continue;
    io.unobserve(e.target);if(e.target.__cdh)track(e.target.__cdh,'imp');}
}):null;
function watch(el,m){if(!io)return;el.__cdh=m;io.unobserve(el);io.observe(el);}
/* Banners variados: a ordem é sorteada a cada página e cada posição pega o próximo banner que
   ainda não apareceu nesta página (e tem o tamanho pedido). Só repete se faltar banner.
   Como a posição muda a cada página, o relatório ajusta o CTR de cada banner pela posição. */
var order=C.c.slice(),shown={};
for(var i=order.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),t=order[i];order[i]=order[j];order[j]=t;}
function keyFor(c,fmt){
  var f=c.f;
  if(fmt!=='faixa')return f[fmt]?fmt:'';
  return (W.matchMedia&&W.matchMedia('(min-width: 760px)').matches&&f['728x90'])?'728x90':(f['320x100']?'320x100':'');
}
function pick(fmt){
  var best=null,bn=1e9;
  for(var i=0;i<order.length;i++){
    var c=order[i];if(!keyFor(c,fmt))continue;
    var n=shown[c.i]||0;if(n<bn){best=c;bn=n;}if(!n)break;
  }
  if(best)shown[best.i]=(shown[best.i]||0)+1;
  return best;
}
function nativeEl(fmt){
  var c=pick(fmt);if(!c)return null;
  var key=keyFor(c,fmt),img=c.f[key];
  var a=D.createElement('a');a.href=img[1];a.target='_blank';a.rel='sponsored noopener';
  a.className='cdh-spot cdh-spot--'+key;a.setAttribute('data-cr',c.i);
  var im=D.createElement('img');im.src=img[0];im.width=img[2];im.height=img[3];im.alt=c.a;
  im.loading='lazy';im.decoding='async';a.appendChild(im);
  return {el:a,img:im,fmt:key,cr:c};
}
function wire(n,pl,onErr){
  var m=[pl,'native',n.cr.i,n.fmt],im=n.img;
  n.el.addEventListener('click',function(){track(m,'click',true);});
  if(im.complete&&im.naturalWidth)watch(im,m);else im.addEventListener('load',function(){watch(im,m);});
  if(onErr)im.addEventListener('error',onErr);
}
function hide(b){var w=b.closest?b.closest('.post-card--ad, .ad-sticky-footer'):null;(w||b).style.display='none';}
W.cdhMix=function(s){
  var b=slotOf(s);if(!b)return;
  var pl=b.getAttribute('data-pl'),fmt=C.p[pl],n=null;
  if(fmt&&(!C.m||used<C.m))n=nativeEl(fmt);
  if(!n){hide(b);return;}
  used++;b.className+=' is-native';b.appendChild(n.el);
  wire(n,pl,function(){hide(b);});
};

/* Âncora nativa: faixa fixa no rodapé, como a âncora do Google. Fechar = some até o fim da sessão. */
function anchor(){
  if(!C.p.anchor)return;
  try{if(sessionStorage.getItem(ANC))return;}catch(e){}
  var n=nativeEl(C.p.anchor);if(!n)return;
  n.img.loading='eager';
  var bar=D.createElement('div');bar.className='cdh-anchor';
  var x=D.createElement('button');x.type='button';x.className='cdh-anchor__close';
  x.setAttribute('aria-label','Fechar anúncio');x.innerHTML='&times;';
  x.addEventListener('click',function(){
    if(bar.parentNode)bar.parentNode.removeChild(bar);
    D.documentElement.className=D.documentElement.className.replace(/\\bhas-cdh-anchor\\b/,'');
    try{sessionStorage.setItem(ANC,'1');}catch(e){}
  });
  bar.appendChild(n.el);bar.appendChild(x);D.body.appendChild(bar);
  D.documentElement.className+=' has-cdh-anchor';
  wire(n,'anchor',function(){x.click();});
}
if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',anchor);else anchor();

/* Vinheta nativa: ao clicar num link interno, mostra o banner em tela cheia antes de seguir
   (como a vinheta do Google). No máximo 1 a cada GAP ms por leitor. */
function vignetteDue(){var l=0;try{l=+sessionStorage.getItem(VIG)||0;}catch(e){}return Date.now()-l>GAP;}
function vignette(n,href){
  var ov=D.createElement('div');ov.className='cdh-vig';
  ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-label','Publicidade');
  var box=D.createElement('div');box.className='cdh-vig__box';
  var x=D.createElement('button');x.type='button';x.className='cdh-vig__close';
  x.setAttribute('aria-label','Fechar e continuar');x.innerHTML='&times;';
  var go=D.createElement('a');go.className='cdh-vig__go';go.href=href;go.textContent='Continuar para o capítulo →';
  x.addEventListener('click',function(){location.href=href;});
  n.img.loading='eager';
  box.appendChild(x);box.appendChild(n.el);box.appendChild(go);ov.appendChild(box);D.body.appendChild(ov);
  wire(n,'vignette',function(){location.href=href;});
  try{go.focus();}catch(e){}
}
D.addEventListener('click',function(e){
  if(!C.p.vignette||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
  if(!a||a.target==='_blank'||a.hasAttribute('download')||a.closest('.cdh-spot, .cdh-vig'))return;
  var u;try{u=new URL(a.href,location.href);}catch(x){return;}
  if(u.origin!==location.origin||u.pathname===location.pathname||/^\\/(admin|api)(\\/|$)/.test(u.pathname))return;
  if(!vignetteDue())return;
  var n=nativeEl(C.p.vignette);if(!n)return;
  e.preventDefault();
  try{sessionStorage.setItem(VIG,String(Date.now()));}catch(x){}
  vignette(n,u.href);
});
})();
</script>`;
}

// ============== Eventos (beacon) ==============

export type MixSource = 'native' | 'adsense';
/** imp/click = banner nativo; pv = pageview do grupo (native|adsense), sem posição. */
export type MixEvent = 'imp' | 'click' | 'pv';

export interface MixEventRow {
  placement: MixPlacement | '';
  source: MixSource;
  creative: string;
  format: NativeFormat | '';
  event: MixEvent;
  count: number;
}

const MAX_BEACON_ROWS = 60;
const MAX_COUNT_PER_ROW = 100;

/**
 * Valida o corpo do beacon contra a config atual. Descarta testes antigos, criativos
 * desconhecidos e lixo (evita que alguém encha o D1 com linhas inventadas).
 * Aceita: pageview de cada grupo ['', 'adsense'|'native', '', '', 'pv', n] e impressão/clique
 * de banner nativo. (Pageview nativo com id de criativo = página em cache de antes da variação.)
 * Retorna as linhas agregadas por chave, ou [] se nada for válido.
 */
export function sanitizeEventBatch(body: unknown, cfg: NativeConfig): MixEventRow[] {
  if (!body || typeof body !== 'object') return [];
  const b = body as { t?: unknown; e?: unknown };
  if (!cfg.testId || b.t !== cfg.testId || !Array.isArray(b.e)) return [];
  const ids = new Set(cfg.creatives.map((c) => c.id));
  const agg = new Map<string, MixEventRow>();
  for (const raw of b.e.slice(0, MAX_BEACON_ROWS)) {
    if (!Array.isArray(raw) || raw.length !== 6) continue;
    const [pl, src, cr, fmt, ev, n] = raw as unknown[];
    const count = Math.floor(Number(n));
    if (!Number.isFinite(count) || count < 1) continue;
    if (ev === 'pv') {
      if (pl !== '' || fmt !== '') continue;
      if (src === 'adsense') { if (cr !== '') continue; }
      else if (src === 'native') { if (cr !== '' && !(typeof cr === 'string' && ids.has(cr))) continue; }
      else continue;
    } else if (ev === 'imp' || ev === 'click') {
      // Só banner nativo: impressão/clique do AdSense quem mede é o próprio AdSense.
      if (src !== 'native' || !(MIX_PLACEMENTS as unknown[]).includes(pl)) continue;
      if (typeof cr !== 'string' || !ids.has(cr) || !(NATIVE_FORMATS as unknown[]).includes(fmt)) continue;
    } else continue;
    const row: Omit<MixEventRow, 'count'> = {
      placement: pl as MixPlacement | '', source: src as MixSource, creative: cr as string,
      format: fmt as NativeFormat | '', event: ev,
    };
    const key = [row.placement, row.source, row.creative, row.format, row.event].join('|');
    const prev = agg.get(key);
    agg.set(key, { ...row, count: Math.min(MAX_COUNT_PER_ROW, (prev?.count ?? 0) + count) });
  }
  return [...agg.values()];
}

// ============== Estatística do teste ==============

export interface MixStatRow {
  placement: string;
  source: string;
  creative: string;
  format: string;
  event: string;
  count: number;
}

export interface Interval { low: number; high: number }

/** Intervalo de Wilson 95% para uma proporção (CTR). */
export function wilson(successes: number, trials: number, z = 1.96): Interval {
  if (trials <= 0) return { low: 0, high: 0 };
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** PRNG determinístico (mulberry32) — mesma resposta a cada reload do admin. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape ≥ 1, 1) — Marsaglia & Tsang. */
function gammaSample(shape: number, rand: () => number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(a: number, b: number, rand: () => number): number {
  const x = gammaSample(a, rand);
  const y = gammaSample(b, rand);
  return x / (x + y);
}

/**
 * Probabilidade de cada braço ter o MAIOR CTR real (Monte Carlo sobre Beta posteriores).
 * Mais intuitivo que p-valor: "V4 tem 92% de chance de ser o melhor".
 *
 * Prior = CTR médio do teste com peso de ~1 clique (Beta(1, (1-p̄)/p̄)). Com prior uniforme
 * Beta(1,1), um banner com 10 impressões e 0 cliques "valeria" CTR ~8% e ganharia de todos.
 */
export function probabilityBest(
  arms: Array<{ clicks: number; imps: number }>, draws = 4000, seed = 20260929,
): number[] {
  const n = arms.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const totalImps = arms.reduce((s, a) => s + Math.max(0, a.imps), 0);
  const totalClicks = arms.reduce((s, a) => s + Math.max(0, a.clicks), 0);
  const pooled = Math.min(0.5, Math.max(1e-4, totalImps > 0 ? totalClicks / totalImps : 0.01));
  const priorB = (1 - pooled) / pooled;
  const rand = mulberry32(seed);
  const wins = new Array<number>(n).fill(0);
  for (let d = 0; d < draws; d++) {
    let best = -1;
    let bestIdx = 0;
    for (let i = 0; i < n; i++) {
      const clicks = Math.max(0, arms[i].clicks);
      const misses = Math.max(0, arms[i].imps - clicks);
      const s = betaSample(1 + clicks, priorB + misses, rand);
      if (s > best) { best = s; bestIdx = i; }
    }
    wins[bestIdx]++;
  }
  return wins.map((w) => w / draws);
}

export interface CreativeResult {
  id: string;
  label: string;
  alt: string;
  thumb: string;
  active: boolean;
  imps: number;
  clicks: number;
  ctr: number;
  ci: Interval;
  pBest: number;
  /** CTR ajustado à posição: índice × CTR médio do teste (compara banners em pé de igualdade). */
  adjCtr: number;
  adjCi: Interval;
  /** Cliques reais ÷ cliques esperados nas posições em que apareceu (1,2 = 20% acima da média). */
  index: number | null;
}

export interface MixReport {
  adsensePv: number;
  nativePv: number;
  nativeImps: number;
  nativeClicks: number;
  nativeCtr: number;
  /** Cliques em banner nativo por pageview do grupo nativo. */
  clicksPerPv: number;
  clicksPerPvCi: Interval;
  creatives: CreativeResult[];
  byFormat: Array<{ format: string; imps: number; clicks: number; ctr: number }>;
  byPlacement: Array<{ placement: string; imps: number; clicks: number; ctr: number }>;
  economics: {
    adsensePageRpm: number;
    valuePerClick: number;
    nativePageRpm: number | null;
    nativePageRpmRange: Interval | null;
    /** Nativo vs AdSense por pageview: +0.35 = rende 35% mais. */
    lift: number | null;
    /** Valor por clique em que o grupo nativo empata com o AdSense. */
    breakEvenCpc: number | null;
    bestPageRpm: number | null;
    adsenseRevenue: number | null;
    nativeRevenue: number | null;
  };
  /** Mínimo de impressões por criativo para cravar vencedor. */
  enoughData: boolean;
  winner: CreativeResult | null;
}

export const MIN_IMPS_PER_CREATIVE = 1000;
export const MIN_IMPS_TO_RANK = 100;
export const WIN_PROBABILITY = 0.95;

/** Intervalo 95% para uma taxa de contagem (cliques por pageview), aproximação de Poisson. */
function rateInterval(count: number, exposure: number): Interval {
  if (exposure <= 0) return { low: 0, high: 0 };
  const half = 1.96 * Math.sqrt(Math.max(count, 1));
  return { low: Math.max(0, (count - half) / exposure), high: (count + half) / exposure };
}

export function buildMixReport(rows: MixStatRow[], cfg: NativeConfig): MixReport {
  let adsensePv = 0;
  let nativePv = 0;
  let nativeImps = 0;
  let nativeClicks = 0;
  type Acc = { imps: number; clicks: number };
  const byCreative = new Map<string, Acc>();
  const byFormat = new Map<string, Acc>();
  const byPlacement = new Map<string, Acc>();
  // Estrato = posição × formato (âncora 320x100, texto 16:9…): base do ajuste por posição.
  const byStratum = new Map<string, Acc>();
  const byCreativeStratum = new Map<string, Map<string, Acc>>();
  const acc = (m: Map<string, Acc>, k: string): Acc => {
    let v = m.get(k);
    if (!v) { v = { imps: 0, clicks: 0 }; m.set(k, v); }
    return v;
  };
  for (const r of rows) {
    const n = Number(r.count) || 0;
    if (r.event === 'pv') {
      if (r.source === 'adsense') adsensePv += n;
      else if (r.source === 'native') nativePv += n;
      continue;
    }
    if (r.source !== 'native') continue;
    const isImp = r.event === 'imp';
    if (isImp) nativeImps += n; else nativeClicks += n;
    const stratum = `${r.placement}|${r.format}`;
    let cs = byCreativeStratum.get(r.creative);
    if (!cs) { cs = new Map(); byCreativeStratum.set(r.creative, cs); }
    for (const v of [acc(byCreative, r.creative), acc(byFormat, r.format), acc(byPlacement, r.placement), acc(byStratum, stratum), acc(cs, stratum)]) {
      if (isImp) v.imps += n; else v.clicks += n;
    }
  }

  const vpc = cfg.valuePerClick;
  const nativeCtr = nativeImps > 0 ? nativeClicks / nativeImps : 0;

  // Ajuste por posição (padronização indireta): quantos cliques o banner "deveria" ter tido se
  // tivesse o CTR médio de cada posição/formato em que apareceu. Índice = real ÷ esperado.
  const expectedClicks = (id: string): number => {
    let e = 0;
    for (const [st, v] of byCreativeStratum.get(id) ?? []) {
      const base = byStratum.get(st);
      if (base && base.imps > 0) e += v.imps * (base.clicks / base.imps);
    }
    return e;
  };

  // Criativos: todos os configurados (mesmo sem dados) + ids que só existem nos eventos.
  const ids = [...new Set([...cfg.creatives.map((c) => c.id), ...byCreative.keys()])].filter(Boolean);
  const arms = ids.map((id) => {
    const { imps, clicks } = byCreative.get(id) ?? { imps: 0, clicks: 0 };
    const exp = expectedClicks(id);
    const index = exp > 0 ? clicks / exp : null;
    // "Impressões equivalentes em posição média": com elas, cliques ÷ adjImps = CTR ajustado.
    const adjImps = index !== null && nativeCtr > 0 ? Math.max(clicks, exp / nativeCtr) : imps;
    return { imps, clicks, index, adjImps };
  });
  // Só entra no ranking quem já tem um mínimo de impressões.
  const ranked = arms.map((a, i) => ({ a, i })).filter(({ a }) => a.imps >= MIN_IMPS_TO_RANK);
  const pRanked = probabilityBest(ranked.map(({ a }) => ({ clicks: a.clicks, imps: Math.round(a.adjImps) })));
  const pBest = new Array<number>(ids.length).fill(0);
  ranked.forEach(({ i }, k) => { pBest[i] = pRanked[k]; });
  const creatives: CreativeResult[] = ids.map((id, i) => {
    const c = cfg.creatives.find((x) => x.id === id);
    const { imps, clicks, index, adjImps } = arms[i];
    const ctr = imps > 0 ? clicks / imps : 0;
    const adjCtr = adjImps > 0 ? clicks / adjImps : 0;
    const thumb = c ? (c.images['16x9'] ?? c.images['300x250'] ?? c.images['320x100'] ?? c.images['728x90'] ?? c.images['320x50'])?.src ?? '' : '';
    return {
      id, label: c?.label ?? id, alt: c?.alt ?? '', thumb, active: c?.active ?? false,
      imps, clicks, ctr, ci: wilson(clicks, imps), pBest: pBest[i],
      adjCtr, adjCi: wilson(clicks, Math.round(adjImps)), index,
    };
  }).sort((a, b) =>
    // Rankeados primeiro; chance arredondada (abaixo de 1% é ruído do Monte Carlo); depois CTR ajustado.
    Number(b.imps >= MIN_IMPS_TO_RANK) - Number(a.imps >= MIN_IMPS_TO_RANK)
    || Math.round(b.pBest * 100) - Math.round(a.pBest * 100)
    || b.adjCtr - a.adjCtr
    || b.imps - a.imps);

  const withData = creatives.filter((c) => c.imps > 0);
  const enoughData = ranked.length >= 2 && withData.every((c) => c.imps >= MIN_IMPS_PER_CREATIVE);
  const top = creatives[0];
  const winner = enoughData && top && top.pBest >= WIN_PROBABILITY ? top : null;

  const clicksPerPv = nativePv > 0 ? nativeClicks / nativePv : 0;
  const clicksPerPvCi = rateInterval(nativeClicks, nativePv);
  const rpm = cfg.adsensePageRpm;
  const nativePageRpm = vpc > 0 && nativePv > 0 ? clicksPerPv * vpc * 1000 : null;
  const nativePageRpmRange = nativePageRpm !== null
    ? { low: clicksPerPvCi.low * vpc * 1000, high: clicksPerPvCi.high * vpc * 1000 } : null;
  const lift = nativePageRpm !== null && rpm > 0 ? nativePageRpm / rpm - 1 : null;
  const breakEvenCpc = rpm > 0 && clicksPerPv > 0 ? rpm / (clicksPerPv * 1000) : null;
  // Se só o líder rodasse em todas as posições: receita do grupo × índice dele.
  const leader = withData.slice().sort((a, b) => b.pBest - a.pBest || b.adjCtr - a.adjCtr)[0];
  const bestPageRpm = leader && leader.index !== null && nativePageRpm !== null ? nativePageRpm * leader.index : null;

  return {
    adsensePv, nativePv, nativeImps, nativeClicks, nativeCtr, clicksPerPv, clicksPerPvCi,
    creatives,
    byFormat: [...byFormat.entries()]
      .map(([format, v]) => ({ format, ...v, ctr: v.imps > 0 ? v.clicks / v.imps : 0 }))
      .sort((a, b) => b.imps - a.imps),
    byPlacement: MIX_PLACEMENTS
      .filter((k) => byPlacement.has(k))
      .map((k) => {
        const v = byPlacement.get(k)!;
        return { placement: k, ...v, ctr: v.imps > 0 ? v.clicks / v.imps : 0 };
      }),
    economics: {
      adsensePageRpm: rpm,
      valuePerClick: vpc,
      nativePageRpm,
      nativePageRpmRange,
      lift,
      breakEvenCpc,
      bestPageRpm,
      adsenseRevenue: rpm > 0 ? (adsensePv / 1000) * rpm : null,
      nativeRevenue: vpc > 0 ? nativeClicks * vpc : null,
    },
    enoughData,
    winner,
  };
}

// ============== Importador de banners ==============

export interface ParsedBanner {
  id: string;
  label: string;
  alt: string;
  format: NativeFormat;
  src: string;   // absoluto (origem)
  href: string;
  w: number;
  h: number;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : '';
}

/** Descobre o formato pelo tamanho (ou pelo nome do arquivo, se faltar width/height). */
export function detectFormat(w: number, h: number, filename = ''): NativeFormat | null {
  const exact: Record<string, NativeFormat> = {
    '300x250': '300x250', '320x100': '320x100', '728x90': '728x90', '320x50': '320x50',
  };
  if (w > 0 && h > 0) {
    if (exact[`${w}x${h}`]) return exact[`${w}x${h}`];
    if (Math.abs(w / h - 16 / 9) < 0.02) return '16x9';
    return null;
  }
  const m = filename.match(/(\d{2,4})x(\d{2,4})/);
  if (m && exact[`${m[1]}x${m[2]}`]) return exact[`${m[1]}x${m[2]}`];
  if (/16x9/.test(filename)) return '16x9';
  return null;
}

/** 'v1-nova-fase-300x250.jpg' → 'v1-nova-fase' */
function creativeIdFromFilename(src: string): string {
  const base = (src.split('?')[0].split('#')[0].split('/').pop() ?? '').replace(/\.[a-z0-9]{2,5}$/i, '');
  return slugifyId(base.replace(/[-_](nativo[-_])?(\d{2,4}x\d{2,4}|16x9)$/i, ''));
}

/**
 * Lê uma página de banners (ou códigos colados) e extrai todos os `<a href><img></a>`.
 * Aceita os códigos dentro de <textarea> (escapados, como na página da Toda Fase) ou soltos.
 * O rótulo de cada criativo vem do <h2> mais próximo acima do código.
 */
export function parseBannerSnippets(html: string, baseUrl: string): { banners: ParsedBanner[]; skipped: number } {
  const headings: Array<{ pos: number; text: string }> = [];
  for (const m of html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
    headings.push({ pos: m.index ?? 0, text: decodeEntities(m[1].replace(/<[^>]*>/g, '')).trim() });
  }
  const chunks: Array<{ pos: number; html: string }> = [];
  for (const m of html.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/gi)) {
    chunks.push({ pos: m.index ?? 0, html: decodeEntities(m[1]) });
  }
  if (chunks.length === 0) chunks.push({ pos: 0, html });

  const banners: ParsedBanner[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const chunk of chunks) {
    const label = headings.filter((h) => h.pos < chunk.pos).pop()?.text ?? '';
    for (const a of chunk.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const imgTag = a[2].match(/<img\b[^>]*>/i)?.[0];
      if (!imgTag) continue;
      const hrefRaw = attr(`<a ${a[1]}>`, 'href');
      const srcRaw = attr(imgTag, 'src');
      let href = '';
      let src = '';
      try {
        href = safeHttpUrl(new URL(hrefRaw, baseUrl).toString());
        src = safeHttpUrl(new URL(srcRaw, baseUrl).toString());
      } catch { /* URL inválida */ }
      const w = Number(attr(imgTag, 'width')) || 0;
      const h = Number(attr(imgTag, 'height')) || 0;
      const format = detectFormat(w, h, srcRaw);
      const id = creativeIdFromFilename(srcRaw) || slugifyId(attr(imgTag, 'alt'));
      if (!href || !src || !format || !id) { skipped++; continue; }
      const key = `${id}|${format}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const dims = format === '16x9' ? { w: w || 1200, h: h || 675 } : { w: Number(format.split('x')[0]), h: Number(format.split('x')[1]) };
      banners.push({
        id,
        label: label || id,
        alt: attr(imgTag, 'alt'),
        format, src, href, ...dims,
      });
    }
  }
  return { banners, skipped };
}

/**
 * Junta banners importados com os criativos existentes. Atualiza os que já existem
 * (mantendo ativo/pausado), adiciona os novos (ativos) e nunca apaga nada.
 */
export function mergeCreatives(
  existing: NativeCreative[], banners: ParsedBanner[], srcMap: Map<string, string> = new Map(),
): { creatives: NativeCreative[]; added: number; updated: number } {
  const out = existing.map((c) => ({ ...c, images: { ...c.images } }));
  const byId = new Map(out.map((c) => [c.id, c]));
  const touched = new Set<string>();
  let added = 0;
  for (const b of banners) {
    let c = byId.get(b.id);
    if (!c) {
      c = { id: b.id, label: b.label, alt: b.alt, active: true, images: {} };
      out.push(c);
      byId.set(b.id, c);
      added++;
      touched.add(b.id);
    } else if (!touched.has(b.id)) {
      touched.add(b.id);
      c.label = b.label || c.label;
    }
    if (b.alt && (!c.alt || b.format === '16x9')) c.alt = b.alt;
    c.images[b.format] = { src: srcMap.get(b.src) ?? b.src, href: b.href, w: b.w, h: b.h };
  }
  return { creatives: out, added, updated: [...touched].length - added };
}
