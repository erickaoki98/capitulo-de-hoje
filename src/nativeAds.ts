/**
 * Banners nativos (anúncios próprios, ex.: Toda Fase) + teste A/B contra o AdSense.
 *
 * Settings (D1 settings table):
 *   native.config: JSON (NativeConfig) — split %, posições, criativos, RPM/valor por clique.
 * Eventos (D1): tabela `ad_mix_events` — impressões/cliques por dia × teste × posição × fonte × criativo × formato.
 *
 * Como funciona na página pública (o HTML é CACHEADO na borda):
 *  - O servidor NÃO sorteia nada: um HTML cacheado entregaria o mesmo sorteio para todo mundo.
 *  - Cada posição participante vira `<div class="cdh-mix"><template>AdSense</template></div>`
 *    + um script inline que decide NO NAVEGADOR: banner nativo (share %) ou AdSense.
 *  - O criativo nativo é fixo por visitante (localStorage) → teste A/B limpo entre banners.
 *  - Impressão = unidade apareceu na tela (IntersectionObserver). AdSense só conta se preenchido
 *    (data-ad-status="filled", ou "unfill-optimized" com iframe), então slot vazio não vira impressão.
 *  - Eventos vão em lote (sendBeacon) para /api/ev → 1 batch de escrita no D1 por envio.
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

/** Posições de anúncio que podem participar do teste (mesmas chaves do AdConfig). */
export type MixPlacement =
  | 'beforePost' | 'topOfContent' | 'inContent' | 'afterContent'
  | 'bottomOfPage' | 'betweenCards' | 'stickyFooter';
export const MIX_PLACEMENTS: MixPlacement[] = [
  'beforePost', 'topOfContent', 'inContent', 'afterContent', 'bottomOfPage', 'betweenCards', 'stickyFooter',
];

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
  /** % das impressões elegíveis que vão para o nativo (0–100). */
  share: number;
  /** Teto de banners nativos por página (o resto fica com o AdSense). */
  maxPerPage: number;
  /** Id do teste atual. Muda ao "reiniciar contagem"; eventos antigos deixam de contar. */
  testId: string;
  startedAt: number;
  /** RPM de impressões do AdSense (R$ por mil), digitado pelo admin a partir do relatório do AdSense. */
  adsenseRpm: number;
  /** Quanto vale um clique no banner nativo (R$) = conversão × lucro por venda. */
  valuePerClick: number;
  /** Última URL usada no importador. */
  sourceUrl: string;
  placements: Record<MixPlacement, NativePlacementCfg>;
  creatives: NativeCreative[];
}

export const DEFAULT_NATIVE_PLACEMENTS: Record<MixPlacement, NativePlacementCfg> = {
  beforePost:   { on: false, format: 'faixa' },
  topOfContent: { on: true,  format: 'faixa' },
  inContent:    { on: true,  format: '16x9' },
  afterContent: { on: true,  format: '300x250' },
  bottomOfPage: { on: false, format: '300x250' },
  betweenCards: { on: true,  format: '16x9' },
  stickyFooter: { on: false, format: '320x50' },
};

export const DEFAULT_NATIVE_CONFIG: NativeConfig = {
  enabled: false,
  share: 20,
  maxPerPage: 2,
  testId: '',
  startedAt: 0,
  adsenseRpm: 0,
  valuePerClick: 0,
  sourceUrl: '',
  placements: DEFAULT_NATIVE_PLACEMENTS,
  creatives: [],
};

export const PLACEMENT_LABELS: Record<MixPlacement, string> = {
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
    const format = SLOT_FORMATS.includes(p.format as SlotFormat) ? p.format as SlotFormat : placements[k].format;
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
    maxPerPage: Math.round(clampNum(parsed.maxPerPage, 1, 10, DEFAULT_NATIVE_CONFIG.maxPerPage)),
    testId,
    startedAt: clampNum(parsed.startedAt, 0, 8.64e15, 0),
    adsenseRpm: clampNum(parsed.adsenseRpm, 0, 10_000, 0),
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

/** A posição participa do teste (renderizar como slot misto)? */
export function mixPlacementOn(cfg: NativeConfig | null | undefined, placement: MixPlacement): boolean {
  return !!cfg && nativeActive(cfg) && cfg.placements[placement].on;
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
export function runtimeConfig(cfg: NativeConfig): {
  t: string; s: number; m: number;
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
  return { t: cfg.testId, s: cfg.share, m: cfg.maxPerPage, p, c };
}

/**
 * Runtime do teste (vai no <head>, antes de qualquer slot). ES5 de propósito
 * (Android antigo). Define window.cdhMix(scriptEl).
 */
export function renderMixRuntime(cfg: NativeConfig): string {
  if (!nativeActive(cfg)) return '';
  return `<script>
(function(){
var C=${scriptJson(runtimeConfig(cfg))};
var W=window,D=document,KEY='cdh_nv';
function pick(){
  var s=null;
  try{s=JSON.parse(localStorage.getItem(KEY)||'null');}catch(e){}
  if(s&&s.t===C.t){for(var i=0;i<C.c.length;i++){if(C.c[i].i===s.c)return C.c[i];}}
  var c=C.c[Math.floor(Math.random()*C.c.length)];
  try{localStorage.setItem(KEY,JSON.stringify({t:C.t,c:c.i}));}catch(e){}
  return c;
}
var cr=C.c.length?pick():null,used=0,q={},qn=0,timer=0;
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
var io=('IntersectionObserver' in W)?new IntersectionObserver(function(es){
  for(var i=0;i<es.length;i++){var e=es[i];
    if(!e.isIntersecting||e.boundingClientRect.height<2)continue;
    io.unobserve(e.target);if(e.target.__cdh)track(e.target.__cdh,'imp');}
}):null;
function watch(el,m){if(!io)return;el.__cdh=m;io.unobserve(el);io.observe(el);}
function watchAds(ins,m){
  var mo=null;
  function check(){var st=ins.getAttribute('data-ad-status');
    if(st==='filled'||(st==='unfill-optimized'&&ins.querySelector('iframe'))){if(mo)mo.disconnect();watch(ins,m);return true;}
    if(st==='unfilled'){if(mo)mo.disconnect();return true;}return false;}
  if(check()||!W.MutationObserver)return;
  mo=new MutationObserver(check);mo.observe(ins,{attributes:true,attributeFilter:['data-ad-status'],childList:true,subtree:true});
}
function nativeEl(fmt){
  var f=cr.f,key=fmt;
  if(fmt==='faixa'){key=(W.matchMedia&&W.matchMedia('(min-width: 760px)').matches&&f['728x90'])?'728x90':(f['320x100']?'320x100':'');}
  var img=key&&f[key];if(!img)return null;
  var a=D.createElement('a');a.href=img[1];a.target='_blank';a.rel='sponsored noopener';
  a.className='cdh-spot cdh-spot--'+key;a.setAttribute('data-cr',cr.i);
  var im=D.createElement('img');im.src=img[0];im.width=img[2];im.height=img[3];im.alt=cr.a;
  im.loading='lazy';im.decoding='async';a.appendChild(im);
  return {el:a,img:im,fmt:key};
}
W.cdhMix=function(s){
  var box=s&&s.previousElementSibling;
  if(!box||box.__cdh)return;box.__cdh=1;
  var pl=box.getAttribute('data-pl'),fmt=C.p[pl],n=null;
  if(cr&&fmt&&used<C.m&&Math.random()*100<C.s)n=nativeEl(fmt);
  if(n){
    used++;box.className+=' is-native';box.appendChild(n.el);
    var m=[pl,'native',cr.i,n.fmt],im=n.img;
    n.el.addEventListener('click',function(){track(m,'click',true);});
    if(im.complete&&im.naturalWidth)watch(im,m);else im.addEventListener('load',function(){watch(im,m);});
    im.addEventListener('error',function(){box.style.display='none';});
    return;
  }
  var tpl=box.querySelector('template');if(!tpl)return;
  box.appendChild(D.importNode(tpl.content,true));
  var ins=box.querySelector('ins.adsbygoogle');if(!ins)return;
  try{(W.adsbygoogle=W.adsbygoogle||[]).push({});}catch(e){}
  watchAds(ins,[pl,'adsense','','']);
};
})();
</script>`;
}

// ============== Eventos (beacon) ==============

export type MixSource = 'native' | 'adsense';
export type MixEvent = 'imp' | 'click';

export interface MixEventRow {
  placement: MixPlacement;
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
    if (!(MIX_PLACEMENTS as unknown[]).includes(pl)) continue;
    if (ev !== 'imp' && ev !== 'click') continue;
    const count = Math.floor(Number(n));
    if (!Number.isFinite(count) || count < 1) continue;
    if (src === 'native') {
      if (typeof cr !== 'string' || !ids.has(cr) || !(NATIVE_FORMATS as unknown[]).includes(fmt)) continue;
    } else if (src === 'adsense') {
      // Cliques no AdSense não são medidos (iframe de outro domínio).
      if (cr !== '' || fmt !== '' || ev !== 'imp') continue;
    } else continue;
    const row: Omit<MixEventRow, 'count'> = {
      placement: pl as MixPlacement, source: src, creative: cr as string,
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
  /** RPM estimado (R$ por mil impressões) = CTR × valor por clique × 1000. null sem valor por clique. */
  rpm: number | null;
}

export interface MixReport {
  adsenseImps: number;
  nativeImps: number;
  nativeClicks: number;
  nativeCtr: number;
  nativeCtrCi: Interval;
  creatives: CreativeResult[];
  byFormat: Array<{ format: string; imps: number; clicks: number; ctr: number }>;
  byPlacement: Array<{ placement: string; adsenseImps: number; nativeImps: number; clicks: number; ctr: number }>;
  economics: {
    adsenseRpm: number;
    valuePerClick: number;
    nativeRpm: number | null;
    nativeRpmRange: Interval | null;
    /** Nativo vs AdSense: +0.35 = rende 35% mais. */
    lift: number | null;
    /** Valor por clique em que o nativo empata com o AdSense. */
    breakEvenCpc: number | null;
    bestRpm: number | null;
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

export function buildMixReport(rows: MixStatRow[], cfg: NativeConfig): MixReport {
  let adsenseImps = 0;
  let nativeImps = 0;
  let nativeClicks = 0;
  const byCreative = new Map<string, { imps: number; clicks: number }>();
  const byFormat = new Map<string, { imps: number; clicks: number }>();
  const byPlacement = new Map<string, { adsenseImps: number; nativeImps: number; clicks: number }>();
  const bump = <K>(m: Map<K, { imps: number; clicks: number }>, k: K, ev: string, n: number) => {
    const cur = m.get(k) ?? { imps: 0, clicks: 0 };
    if (ev === 'imp') cur.imps += n; else cur.clicks += n;
    m.set(k, cur);
  };
  for (const r of rows) {
    const n = Number(r.count) || 0;
    const pl = byPlacement.get(r.placement) ?? { adsenseImps: 0, nativeImps: 0, clicks: 0 };
    if (r.source === 'adsense') {
      if (r.event === 'imp') { adsenseImps += n; pl.adsenseImps += n; }
    } else if (r.source === 'native') {
      if (r.event === 'imp') { nativeImps += n; pl.nativeImps += n; } else { nativeClicks += n; pl.clicks += n; }
      bump(byCreative, r.creative, r.event, n);
      bump(byFormat, r.format, r.event, n);
    }
    byPlacement.set(r.placement, pl);
  }

  const vpc = cfg.valuePerClick;
  const rpmOf = (ctr: number): number | null => (vpc > 0 ? ctr * vpc * 1000 : null);

  // Criativos: todos os configurados (mesmo sem dados) + ids que só existem nos eventos.
  const ids = [...new Set([...cfg.creatives.map((c) => c.id), ...byCreative.keys()])];
  const arms = ids.map((id) => byCreative.get(id) ?? { imps: 0, clicks: 0 });
  // Só entra no ranking quem já tem um mínimo de impressões.
  const ranked = arms.map((a, i) => ({ a, i })).filter(({ a }) => a.imps >= MIN_IMPS_TO_RANK);
  const pRanked = probabilityBest(ranked.map(({ a }) => a));
  const pBest = new Array<number>(ids.length).fill(0);
  ranked.forEach(({ i }, k) => { pBest[i] = pRanked[k]; });
  const creatives: CreativeResult[] = ids.map((id, i) => {
    const c = cfg.creatives.find((x) => x.id === id);
    const { imps, clicks } = arms[i];
    const ctr = imps > 0 ? clicks / imps : 0;
    const thumb = c ? (c.images['16x9'] ?? c.images['300x250'] ?? c.images['320x100'] ?? c.images['728x90'] ?? c.images['320x50'])?.src ?? '' : '';
    return {
      id, label: c?.label ?? id, alt: c?.alt ?? '', thumb, active: c?.active ?? false,
      imps, clicks, ctr, ci: wilson(clicks, imps), pBest: pBest[i], rpm: rpmOf(ctr),
    };
  }).sort((a, b) =>
    // Rankeados primeiro; chance arredondada (abaixo de 1% é ruído do Monte Carlo); depois CTR.
    Number(b.imps >= MIN_IMPS_TO_RANK) - Number(a.imps >= MIN_IMPS_TO_RANK)
    || Math.round(b.pBest * 100) - Math.round(a.pBest * 100)
    || b.ctr - a.ctr
    || b.imps - a.imps);

  const withData = creatives.filter((c) => c.imps > 0);
  const enoughData = ranked.length >= 2 && withData.every((c) => c.imps >= MIN_IMPS_PER_CREATIVE);
  const top = creatives[0];
  const winner = enoughData && top && top.pBest >= WIN_PROBABILITY ? top : null;

  const nativeCtr = nativeImps > 0 ? nativeClicks / nativeImps : 0;
  const nativeCtrCi = wilson(nativeClicks, nativeImps);
  const rpm = cfg.adsenseRpm;
  const nativeRpm = nativeImps > 0 ? rpmOf(nativeCtr) : null;
  const nativeRpmRange = nativeRpm !== null
    ? { low: nativeCtrCi.low * vpc * 1000, high: nativeCtrCi.high * vpc * 1000 } : null;
  const lift = nativeRpm !== null && rpm > 0 ? nativeRpm / rpm - 1 : null;
  const breakEvenCpc = rpm > 0 && nativeCtr > 0 ? rpm / (nativeCtr * 1000) : null;
  const bestWithData = withData.slice().sort((a, b) => b.pBest - a.pBest)[0];
  const bestRpm = bestWithData ? rpmOf(bestWithData.ctr) : null;

  return {
    adsenseImps, nativeImps, nativeClicks, nativeCtr, nativeCtrCi,
    creatives,
    byFormat: [...byFormat.entries()]
      .map(([format, v]) => ({ format, ...v, ctr: v.imps > 0 ? v.clicks / v.imps : 0 }))
      .sort((a, b) => b.imps - a.imps),
    byPlacement: MIX_PLACEMENTS
      .filter((k) => byPlacement.has(k))
      .map((k) => {
        const v = byPlacement.get(k)!;
        return { placement: k, ...v, ctr: v.nativeImps > 0 ? v.clicks / v.nativeImps : 0 };
      }),
    economics: {
      adsenseRpm: rpm,
      valuePerClick: vpc,
      nativeRpm,
      nativeRpmRange,
      lift,
      breakEvenCpc,
      bestRpm,
      adsenseRevenue: rpm > 0 ? (adsenseImps / 1000) * rpm : null,
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
