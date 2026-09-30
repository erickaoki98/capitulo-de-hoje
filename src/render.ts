import type { Env, Post, PostCard } from './types';
import type { ShopeeProduct, AdminUser, ShopeeClickDay, ShopeeProductDayClicks } from './db';
import type { ShopeeApiProduct } from './shopee';
import type { UserRole } from './auth';
import { renderMarkdown, readingTime, stripBrokenImageFigures } from './markdown';
import {
  type AdConfig, type AdPlacementConfig, renderAdSenseScript, renderAdUnit, renderAdIns, injectInContentAds,
  adsenseScriptSrc,
} from './adsense';
import { isValidGaMeasurementId } from './configuracoes.ts';
import { gaConfigParams, gaContentGroup, renderGaEventsScript } from './gaEvents.ts';
import {
  type NativeConfig, type MixPlacement, type MixReport, type SlotFormat,
  MIX_PLACEMENTS, NATIVE_FORMATS, PLACEMENT_LABELS, PLACEMENT_FORMATS, SLOT_FORMAT_LABELS,
  MIN_IMPS_PER_CREATIVE, WIN_PROBABILITY,
  mixActive, nativeActive, renderMixRuntime, renderMixSlot, runnableCreatives, slotImages,
} from './nativeAds.ts';

export interface SiteAdSettings {
  publisherId: string;       // ca-pub-XXX
  autoAds: boolean;
  config: AdConfig;
  native?: NativeConfig;     // teste banners nativos × AdSense (src/nativeAds.ts)
}

/**
 * Unidade AdSense de uma posição. Com o teste nativo × AdSense ligado, TODA posição vira slot
 * misto (o navegador decide pelo grupo do visitante: AdSense ou banner nativo/vazio); com o
 * teste desligado sai EXATAMENTE o HTML de sempre (renderAdUnit com push inline).
 */
function adUnitOrMix(
  native: NativeConfig | undefined, placement: MixPlacement,
  wrap: (unit: string) => string,
  publisherId: string, slotId: string, format: AdPlacementConfig['format'],
): string {
  if (mixActive(native)) {
    return renderMixSlot(placement, wrap(renderAdIns(publisherId, slotId, format)));
  }
  return wrap(renderAdUnit(publisherId, slotId, format));
}

/**
 * <head> do AdSense. Com o teste ligado, o adsbygoogle.js NÃO vai no HTML: o runtime do teste
 * carrega só para o grupo AdSense (o grupo nativo não vê AdSense nenhum, nem Auto ads).
 * As duas coisas andam juntas de propósito — nunca sai uma sem a outra.
 */
function adsHeadFor(ads: SiteAdSettings | undefined): string {
  if (!ads?.publisherId) return '';
  if (ads.native && nativeActive(ads.native)) {
    return renderAdSenseScript(ads.publisherId, ads.autoAds, false)
      + renderMixRuntime(ads.native, adsenseScriptSrc(ads.publisherId));
  }
  return renderAdSenseScript(ads.publisherId, ads.autoAds);
}

export interface SiteTypography {
  titleScale: 'sm' | 'md' | 'lg' | 'xl';
  bodyScale: 'sm' | 'md' | 'lg';
}

/**
 * URL canônica do site (preferindo CANONICAL_URL env var).
 * Garante que `<link rel=canonical>`, og:url e JSON-LD apontem
 * sempre para o domínio final, mesmo enquanto o site roda em workers.dev.
 */
function siteCanonical(env: Env, url: URL): string {
  const fromEnv = (env as Env & { CANONICAL_URL?: string }).CANONICAL_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return `${url.protocol}//${url.host}`;
}

/**
 * Versão do CSS — computada UMA vez no primeiro request.
 * Garante que o browser cacheie o CSS entre requests, mas
 * invalide automaticamente após cada deploy (novo cold-start).
 * Nota: Date.now() no module-level retorna 0 em Workers (clock inativo).
 */
let _cssVersion = '';
function cssVersion(): string {
  if (!_cssVersion) _cssVersion = String(Date.now());
  return _cssVersion;
}

// ====== Helpers ======
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('pt-BR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}

function parseTags(s: string): string[] {
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

/**
 * Remove o sufixo " | Nome da Novela" do título para exibição (H1, cards).
 * A novela é mostrada como badge/eyebrow à parte, então repeti-la no título
 * só polui. Mantém o título completo para <title>/SEO; limpa só o visível.
 */
function cleanTitle(title: string, category?: string | null): string {
  const t = (title || '').trim();
  const cat = (category || '').trim();
  // 1) Remove " | <categoria>" exato no fim (tolerante a espaços/maiúsculas)
  if (cat) {
    const escaped = cat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\s*[|–—-]\\s*' + escaped + '\\s*$', 'i');
    const stripped = t.replace(re, '').trim();
    if (stripped && stripped !== t) return stripped;
  }
  // 2) Genérico: remove um " | cauda curta" no fim (provável tag de novela)
  const m = t.match(/^(.*\S)\s*\|\s*([^|]{1,40})$/);
  if (m) return m[1].trim();
  return t;
}

/**
 * Normaliza pra comparação fuzzy: lowercase, sem acentos, sem pontuação, sem espaços extras.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Remove o primeiro <h1>...</h1> do HTML se o texto for muito similar ao título do post.
 * Usado pra evitar duplicação visual quando o WP exporta o título dentro do <content>.
 */
function stripDuplicateH1(html: string, postTitle: string): string {
  const target = normalize(postTitle);
  if (!target) return html;
  return html.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i, (full, inner) => {
    const innerText = normalize(String(inner).replace(/<[^>]*>/g, ' '));
    if (!innerText) return full;
    // Match exato OU substring forte (90%+ overlap)
    if (innerText === target) return '';
    const longer = innerText.length > target.length ? innerText : target;
    const shorter = innerText.length > target.length ? target : innerText;
    if (longer.includes(shorter) && shorter.length / longer.length > 0.8) return '';
    return full;
  });
}

/**
 * Corrige blockquotes não-fechados no HTML.
 * Padrão comum do WP export: `<blockquote>TEXTO</p>` em vez de `<blockquote>TEXTO</blockquote>`.
 * Sem correção, tudo após o blockquote aberto é engolido — o conteúdo some visualmente.
 *
 * Estratégia: rastreia profundidade de blockquotes tag a tag.
 * Quando estamos dentro de um blockquote aberto e encontramos `</p>` seguido por
 * um elemento block-level (h2, figure, div, etc.), esse `</p>` deveria ser `</blockquote>`.
 */
function fixUnclosedBlockquotes(html: string): string {
  const opens = (html.match(/<blockquote[\s>]/gi) || []).length;
  const closes = (html.match(/<\/blockquote>/gi) || []).length;
  if (opens <= closes) return html;

  let needed = opens - closes;

  // Tokeniza tag por tag, rastreando profundidade
  const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
  const BLOCK_NEXT = /^[\s\n]*<(h[1-6]|figure|div|section|blockquote|table|ul|ol|nav|aside|hr|article|header|footer)\b/i;
  let depth = 0;
  let lastIndex = 0;
  const parts: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = TAG_RE.exec(html)) !== null) {
    const tag = match[0];
    const lower = tag.toLowerCase();

    if (/^<blockquote[\s>]/i.test(tag)) {
      depth++;
    } else if (lower === '</blockquote>') {
      depth = Math.max(0, depth - 1);
    } else if (lower === '</p>' && depth > 0 && needed > 0) {
      // Olha o que vem DEPOIS desse </p>
      const after = html.slice(match.index + tag.length);
      if (BLOCK_NEXT.test(after) || after.trim().length === 0) {
        // Este </p> deveria ser </blockquote>
        parts.push(html.slice(lastIndex, match.index));
        parts.push('</blockquote>');
        lastIndex = match.index + tag.length;
        depth--;
        needed--;
        continue;
      }
    }
  }

  if (parts.length === 0) return html; // nenhuma correção feita
  parts.push(html.slice(lastIndex));
  return parts.join('');
}

/**
 * Remove tags </blockquote> órfãs (sem <blockquote> correspondente).
 * Comum em conteúdo importado do WP. Browsers ignoram, mas poluem o HTML.
 */
function stripOrphanBlockquoteCloses(html: string): string {
  const opens = (html.match(/<blockquote[\s>]/gi) || []).length;
  const closes = (html.match(/<\/blockquote>/gi) || []).length;
  if (closes <= opens) return html;

  let excess = closes - opens;
  // Remove os primeiros </blockquote> que aparecem sem ter aberto
  let depth = 0;
  return html.replace(/<\/?blockquote[^>]*>/gi, (tag) => {
    if (/^<blockquote/i.test(tag)) {
      depth++;
      return tag;
    }
    // É </blockquote>
    if (depth > 0) {
      depth--;
      return tag;
    }
    // Órfão
    if (excess > 0) {
      excess--;
      return '';
    }
    return tag;
  });
}

/** Troca a primeira <img> pela última <img> no HTML do conteúdo.
 *  Evita que a hero image (igual à 1ª do corpo) se repita logo abaixo. */
function swapFirstLastImages(html: string): string {
  const imgRegex = /<img\b[^>]*>/gi;
  const matches: Array<{ full: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = imgRegex.exec(html)) !== null) {
    matches.push({ full: m[0], index: m.index });
  }
  if (matches.length < 2) return html; // nada para trocar

  const first = matches[0];
  const last = matches[matches.length - 1];

  // Troca usando placeholders para evitar conflito de posição
  const placeholder1 = '<!--SWAP_FIRST-->';
  const placeholder2 = '<!--SWAP_LAST-->';

  // Substituir de trás para frente (último primeiro) para manter os índices válidos
  let result = html.slice(0, last.index) + placeholder2 + html.slice(last.index + last.full.length);
  result = result.slice(0, first.index) + placeholder1 + result.slice(first.index + first.full.length);

  result = result.replace(placeholder1, last.full);
  result = result.replace(placeholder2, first.full);
  return result;
}

/** Extrai os src de todas as <img> do HTML, na ordem em que aparecem. */
function extractContentImageSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = m[1].trim();
    if (src && !out.includes(src)) out.push(src);
  }
  return out;
}

// ====== Layout ======
interface LayoutOptions {
  title: string;
  description: string;
  url: string;
  siteTitle: string;
  type?: 'website' | 'article';
  pubDate?: number;
  updatedDate?: number;
  author?: string;
  image?: string;
  tags?: string[];
  category?: string;
  jsonLd?: object;
  bodyClass?: string;
  headInject?: string;   // tags adicionais no <head> (AdSense script, etc.)
  gaId?: string;         // Google Analytics measurement ID (G-XXXXXXX)
  stickyAd?: string;     // ad fixo no rodapé mobile
  typography?: SiteTypography;
  cookieBanner?: boolean; // aviso "Usamos cookies" (padrão: exibe; admin → Configurações → Cookies)
}

/** Pathname de uma URL absoluta ('' se inválida — ex.: admin passa url vazia). */
function safePathname(u: string): string {
  try { return new URL(u).pathname; } catch { return ''; }
}

function layout(opts: LayoutOptions, body: string): string {
  const {
    title, description, url, siteTitle,
    type = 'website', pubDate, updatedDate, author,
    image, tags = [], category, jsonLd, bodyClass = '',
    headInject = '', gaId = '', stickyAd = '', typography, cookieBanner = true,
  } = opts;
  const typoClasses = typography ? `t-title-${typography.titleScale} t-body-${typography.bodyScale}` : '';
  const finalBodyClass = `${bodyClass} ${typoClasses}`.trim();

  const isAdmin = bodyClass.includes('admin');
  const ld = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '';
  const twitterCard = image ? 'summary_large_image' : 'summary';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/styles.css?v=${cssVersion()}" as="style">
<link rel="stylesheet" href="/styles.css?v=${cssVersion()}">
${!isAdmin ? `<link rel="preconnect" href="https://pagead2.googlesyndication.com" crossorigin>
<link rel="dns-prefetch" href="https://pagead2.googlesyndication.com">
<link rel="dns-prefetch" href="https://googleads.g.doubleclick.net">
<link rel="dns-prefetch" href="https://tpc.googlesyndication.com">
<link rel="dns-prefetch" href="https://www.googletagservices.com">
<link rel="dns-prefetch" href="https://www.googletagmanager.com">` : ''}
${isAdmin ? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap">` : ''}
${image ? `<link rel="preload" as="image" href="${escapeHtml(image)}" ${type === 'article' ? 'fetchpriority="high"' : ''}>` : ''}
${!isAdmin ? `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(siteTitle)}" href="/rss.xml">` : ''}
<meta property="og:type" content="${type}">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:site_name" content="${escapeHtml(siteTitle)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:alt" content="${escapeHtml(title)}">` : ''}
${pubDate ? `<meta property="article:published_time" content="${isoDate(pubDate)}">` : ''}
${updatedDate ? `<meta property="article:modified_time" content="${isoDate(updatedDate)}">` : ''}
${author && type === 'article' ? `<meta property="article:author" content="${escapeHtml(author)}">` : ''}
${category && type === 'article' ? `<meta property="article:section" content="${escapeHtml(category)}">` : ''}
${tags.map((t) => `<meta property="article:tag" content="${escapeHtml(t)}">`).join('\n')}
<meta name="twitter:card" content="${twitterCard}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}
${author ? `<meta name="author" content="${escapeHtml(author)}">` : ''}
${isAdmin || bodyClass.includes('is-404') ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">'}
${ld}
${headInject}
${/* PROTEÇÃO ANALYTICS — NÃO REMOVER. O GA só é injetado quando `gaId` chega
     preenchido. Quem preenche é a ROTA: ela carrega loadGaId(env) (src/index.ts)
     e passa o gaId para renderHome/renderPost → layout(). Se o GA "parar de
     receber dados", quase sempre a causa é uma rota pública que esqueceu de
     passar o gaId (não é aqui). Mantenha `!isAdmin` para nunca medir o /admin. */''}
${gaId && !isAdmin ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${escapeHtml(gaId)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${escapeHtml(gaId)}',${gaConfigParams(gaContentGroup({ type, category, path: safePathname(url) }))});</script>` : ''}
</head>
<body class="${finalBodyClass}">
<header class="site-header">
  <div class="container">
    <a href="${isAdmin ? '/admin' : '/'}" class="site-logo">${isAdmin ? `${escapeHtml(siteTitle)} <span class="site-logo__suffix">admin</span>` : `<img src="/img/logo-v2.png?v=2" alt="${escapeHtml(siteTitle)}" class="site-logo__img" width="500" height="197">`}</a>
    ${isAdmin ? '<nav><a href="/" target="_blank" rel="noopener">Ver site →</a></nav>' : ''}
  </div>
</header>
<main class="container">
${body}
</main>
<footer class="site-footer">
  <div class="container">
    <div class="site-footer__grid">
      <div class="site-footer__col site-footer__col--about">
        <h4 class="site-footer__title">${escapeHtml(siteTitle)}</h4>
        <p class="site-footer__about">Resumos e capítulos das novelas brasileiras — comentários, spoilers e o que rolou no ar.</p>
        <a href="/rss.xml" class="site-footer__rss" aria-label="Feed RSS">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20A2.18 2.18 0 0 1 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1Z"/></svg>
          Assinar RSS
        </a>
      </div>
      <div class="site-footer__col">
        <h4 class="site-footer__title">Navegar</h4>
        <ul class="site-footer__list">
          <li><a href="/">Página inicial</a></li>
          <li><a href="/rss.xml">Feed RSS</a></li>
          <li><a href="/sitemap.xml">Sitemap</a></li>
          <li><a href="/privacidade">Privacidade</a></li>
        </ul>
      </div>
      <div class="site-footer__col">
        <h4 class="site-footer__title">Em alta</h4>
        <ul class="site-footer__list">
          <li><a href="/?cat=A%20Nobreza%20do%20Amor">A Nobreza do Amor</a></li>
          <li><a href="/">Todas as novelas</a></li>
        </ul>
      </div>
    </div>
    <div class="site-footer__copy">
      <p>© ${new Date().getFullYear()} ${escapeHtml(siteTitle)} — Todos os direitos reservados.</p>
    </div>
  </div>
</footer>
${stickyAd}
${!isAdmin && cookieBanner ? `<div id="cookie-consent" style="display:none;position:fixed;bottom:12px;left:50%;z-index:9999;transform:translateX(-50%) translateY(20px);opacity:0;max-width:min(440px,calc(100% - 32px));display:none">
  <div style="display:flex;align-items:center;gap:12px;background:#1a1a2e;color:#d4d4d8;padding:8px 10px 8px 16px;border-radius:10px;font-size:0.75rem;line-height:1.4;box-shadow:0 4px 24px rgba(0,0,0,0.2)">
    <span>Usamos cookies. <a href="/privacidade" style="color:#93b5ff;text-decoration:underline">Privacidade</a></span>
    <button onclick="acceptCookies()" style="background:rgba(79,127,255,0.15);color:#93b5ff;border:none;padding:6px 14px;border-radius:6px;font-size:0.6875rem;font-weight:600;cursor:pointer;white-space:nowrap;text-transform:uppercase;letter-spacing:0.04em;transition:background 0.15s" onmouseover="this.style.background='rgba(79,127,255,0.25)'" onmouseout="this.style.background='rgba(79,127,255,0.15)'">Aceitar</button>
  </div>
</div>
<script>
(function(){
  var k='cookie_consent';
  if (localStorage.getItem(k)) return;
  var el = document.getElementById('cookie-consent');
  if (!el) return;
  var sticky = document.querySelector('.ad-sticky-footer');
  if (sticky) sticky.style.display = 'none';

  // Mostra com animação após 1.2s
  setTimeout(function(){
    el.style.display = 'block';
    // Force reflow antes de animar
    el.offsetHeight;
    el.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  }, 1200);

  window.acceptCookies = function(){
    localStorage.setItem(k, 'accepted');
    if (typeof gtag === 'function') {
      gtag('consent', 'update', {
        'ad_storage': 'granted',
        'ad_user_data': 'granted',
        'ad_personalization': 'granted',
        'analytics_storage': 'granted'
      });
    }
    // Fade out
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(function(){ el.style.display = 'none'; if (sticky) sticky.style.removeProperty('display'); }, 250);
  };
})();
</script>` : ''}
${!isAdmin ? `<script>
(function(){
  var vid = localStorage.getItem('_vid');
  if (!vid) { vid = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('_vid', vid); }
  function hb(){ try { navigator.sendBeacon('/api/heartbeat', JSON.stringify({ vid: vid, path: location.pathname })); } catch(e){} }
  hb();
  setInterval(hb, 60000);
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) hb(); });
})();
</script>` : ''}
<script>
(function(){
  // === 0. STICKY FOOTER AD — close button + cooldown 24h ===
  // Verifica ANTES dos pushes para evitar carregar ad se já dismissado.
  var sticky = document.querySelector('.ad-sticky-footer');
  if (sticky) {
    var COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h
    var DISMISS_KEY = 'ad_sticky_dismissed_until';
    var dismissedUntil = 0;
    try { dismissedUntil = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10) || 0; } catch(e){}
    if (Date.now() < dismissedUntil) {
      // Esconde imediatamente — não desperdiça impressão
      sticky.style.display = 'none';
    } else {
      // Injeta botão fechar
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'ad-sticky-footer__close';
      closeBtn.setAttribute('aria-label', 'Fechar anúncio');
      closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      sticky.insertBefore(closeBtn, sticky.firstChild);
      var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      closeBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        try { localStorage.setItem(DISMISS_KEY, String(Date.now() + COOLDOWN_MS)); } catch(e){}
        sticky.classList.add('is-dismissing');
        var cleanup = function() {
          sticky.style.display = 'none';
          // Remove padding-bottom do main (CSS usa :has, então só esconder basta)
        };
        if (prefersReduced) {
          cleanup();
        } else {
          var done = false;
          var onEnd = function() {
            if (done) return;
            done = true;
            sticky.removeEventListener('transitionend', onEnd);
            cleanup();
          };
          sticky.addEventListener('transitionend', onEnd);
          setTimeout(onEnd, 400); // fallback
        }
      });
    }
  }

  // === Anúncios: padrão nativo do AdSense, SEM push/collapse custom ===
  // O push é feito inline (1 por <ins>, em renderAdUnit). NÃO há lógica custom
  // aqui DE PROPÓSITO. O adsbygoogle.js já faz tudo melhor do que qualquer
  // engenharia nossa:
  //   • lazy-load nativo — só busca ads below-fold quando o leitor se aproxima;
  //   • preenchimento por viewability;
  //   • colapso automático de slots fluid/responsive sem fill (altura 0).
  // O collapse custom anterior escondia ads ANTES do AdSense preencher: altura 0
  // = slot não-viewable = AdSense nunca preenche → ad sumia para sempre. Isso
  // derrubava o fill rate, principalmente em artigos longos. Removido.
})();
</script>
${gaId && !isAdmin ? renderGaEventsScript() : ''}
</body>
</html>`;
}

// ====== Home ======
export function renderHome(
  env: Env, request: Request, posts: (Post | PostCard)[],
  ads?: SiteAdSettings, typography?: SiteTypography, gaId?: string,
  cookieBanner = true,
): string {
  const url = new URL(request.url);
  const siteUrl = siteCanonical(env, url);

  const pubId = ads?.publisherId;
  const betweenAd = (pubId && ads?.config.betweenCards.enabled && ads.config.betweenCards.slotId)
    ? `<article class="post-card post-card--ad">${adUnitOrMix(ads.native, 'betweenCards', (u) => u, pubId, ads.config.betweenCards.slotId, ads.config.betweenCards.format)}</article>`
    : '';
  const everyN = ads?.config.betweenCards.everyNCards ?? 6;

  const items: string[] = [];
  posts.forEach((p, i) => {
    const eager = i < 3;
    const cat = 'category' in p && p.category && p.category !== 'Sem categoria' ? p.category : '';
    const displayTitle = cleanTitle(p.title, cat || null);
    items.push(`<article class="post-card">
        ${p.hero_image ? `<a href="/${escapeHtml(p.slug)}" class="post-card__image" aria-hidden="true" tabindex="-1"><img src="${escapeHtml(p.hero_image)}" alt="" loading="${eager ? 'eager' : 'lazy'}" ${eager ? 'fetchpriority="high"' : ''} decoding="async"><span class="post-card__image-shade"></span></a>` : ''}
        <div class="post-card__body">
          ${cat ? `<span class="post-card__cat">${escapeHtml(cat)}</span>` : ''}
          <h2 class="post-card__title"><a href="/${escapeHtml(p.slug)}">${escapeHtml(displayTitle)}</a></h2>
          <p class="post-card__desc">${escapeHtml(p.description)}</p>
          <time class="post-card__date" datetime="${isoDate(p.pub_date)}">${formatDate(p.pub_date)}</time>
        </div>
      </article>`);
    if (betweenAd && (i + 1) % everyN === 0 && i < posts.length - 1) {
      items.push(betweenAd);
    }
  });
  const cards = items.join('');

  const body = posts.length === 0
    ? `<div class="empty"><p>Ainda não há posts. <a href="/admin">Criar o primeiro</a>.</p></div>`
    : `<div class="home-head">
        <h1 class="home-head__title">Últimos capítulos das novelas</h1>
        <p class="home-head__sub">Resumos, spoilers e o que rolou no ar — atualizados todo dia.</p>
      </div>
      <section class="posts-grid">${cards}</section>`;

  const stickyAd = (pubId && ads?.config.stickyFooter.enabled && ads.config.stickyFooter.slotId)
    ? `<div class="ad-sticky-footer">${adUnitOrMix(ads.native, 'stickyFooter', (u) => u, pubId, ads.config.stickyFooter.slotId, ads.config.stickyFooter.format)}</div>`
    : '';
  const adsHead = adsHeadFor(ads);

  return layout(
    {
      title: env.SITE_TITLE,
      description: env.SITE_DESCRIPTION,
      url: siteUrl + '/',
      siteTitle: env.SITE_TITLE,
      headInject: adsHead,
      gaId,
      stickyAd,
      typography,
      cookieBanner,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: env.SITE_TITLE,
        url: siteUrl,
        description: env.SITE_DESCRIPTION,
      },
    },
    body,
  );
}

function injectAtMidpoint(html: string, block: string): string {
  const re = /<\/p>/gi;
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    positions.push(m.index + m[0].length);
  }
  if (positions.length < 2) return html + block;
  const mid = positions[Math.floor(positions.length / 2)];
  return html.slice(0, mid) + block + html.slice(mid);
}

/** Injeta bloco após o N-ésimo </p>. Se n=0 ou parágrafos insuficientes, usa midpoint. */
function injectAtNthParagraph(html: string, block: string, n: number): string {
  if (n <= 0) return injectAtMidpoint(html, block);
  const re = /<\/p>/gi;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    count++;
    if (count === n) {
      const pos = m.index + m[0].length;
      return html.slice(0, pos) + block + html.slice(pos);
    }
  }
  // Se não tem parágrafos suficientes, injeta no meio
  return injectAtMidpoint(html, block);
}

// ====== Injeção unificada: ads + shopee com espaçamento garantido ======

interface ContentBlock {
  html: string;
  afterParagraph: number; // injeta após o N-ésimo </p> top-level (1-indexed)
}

const INJECTION_BLOCK_TAGS = /^(blockquote|figure|table|ul|ol|details|aside|div|nav|section|header|footer)$/i;

/** Conta parágrafos top-level (ignora </p> dentro de blockquotes, figures, etc.) */
function countTopLevelParagraphs(html: string): number {
  return analyzeContentStructure(html).totalP;
}

/**
 * Analisa estrutura do conteúdo: conta parágrafos top-level e identifica
 * posições de H2 para evitar ads colados em headings.
 */
function analyzeContentStructure(html: string): { totalP: number; h2Positions: Set<number> } {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let depth = 0;
  let pCount = 0;
  const h2Positions = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const [full, tag] = m;
    if (INJECTION_BLOCK_TAGS.test(tag)) {
      if (full[1] === '/') depth = Math.max(0, depth - 1);
      else if (!full.endsWith('/>')) depth++;
    }
    if (depth === 0) {
      if (full.toLowerCase() === '</p>') pCount++;
      if (/^<h2[\s>]/i.test(full)) h2Positions.add(pCount); // H2 aparece após parágrafo N
    }
  }
  return { totalP: pCount, h2Positions };
}

/**
 * Injeta blocos de conteúdo (ads e widgets Shopee) no HTML com espaçamento garantido.
 * Nunca permite dois blocos seguidos sem pelo menos `minGap` parágrafos reais entre eles.
 * Resolve o problema de anúncio e widget Shopee caírem consecutivos.
 */
function injectContentBlocks(
  html: string,
  blocks: ContentBlock[],
  minGap: number = 2,
): string {
  if (blocks.length === 0) return html;

  const totalP = countTopLevelParagraphs(html);
  if (totalP < 2) return html; // conteúdo muito curto (< 2 parágrafos)

  // Ordena por posição
  blocks.sort((a, b) => a.afterParagraph - b.afterParagraph);

  // Clamp positions: nenhum bloco pode apontar além do conteúdo
  for (const b of blocks) {
    if (b.afterParagraph >= totalP) {
      b.afterParagraph = Math.max(1, totalP - 1);
    }
  }

  // Deconflicta: garante mínimo de `minGap` parágrafos entre blocos consecutivos
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].afterParagraph - blocks[i - 1].afterParagraph < minGap) {
      blocks[i].afterParagraph = blocks[i - 1].afterParagraph + minGap;
    }
  }

  // Remove blocos que cairiam além do conteúdo (deixa 1 § de buffer no final)
  const validBlocks = blocks.filter((b) => b.afterParagraph < totalP);
  if (validBlocks.length === 0) return html;

  // Mapa: parágrafo N → HTML a injetar
  const injectMap = new Map<number, string>();
  for (const b of validBlocks) {
    injectMap.set(b.afterParagraph, (injectMap.get(b.afterParagraph) || '') + b.html);
  }

  // Passa única: injeta nos pontos planejados (só conta </p> top-level)
  let depth = 0;
  let count = 0;
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (full, tag) => {
    if (INJECTION_BLOCK_TAGS.test(tag)) {
      if (full[1] === '/') depth = Math.max(0, depth - 1);
      else if (!full.endsWith('/>')) depth++;
    }
    if (depth === 0 && full.toLowerCase() === '</p>') {
      count++;
      const injection = injectMap.get(count);
      if (injection) return full + '\n' + injection + '\n';
    }
    return full;
  });
}

/**
 * Planeja e injeta blocos intercalados (Shopee ↔ AdSense) com espaçamento
 * inteligente que respeita a estrutura do conteúdo.
 *
 * Regras UX (ui-ux-pro-max: content-priority, whitespace-balance):
 * - Mínimo 3 parágrafos entre blocos de anúncio
 * - Nunca injetar adjacente a H2 (onde trending boxes vivem)
 * - Alternar Shopee → Ad → Shopee → Ad sem repetições
 * - Máximo 6 blocos por artigo para não sobrecarregar
 */
/** Shopee injection config — replaces old ShopeeWidgetWithProducts */
interface ShopeeInjectionConfig {
  products: ShopeeProduct[];
  firstAfter: number;   // insert first product after paragraph N
  everyN: number;       // repeat every N paragraphs (0 = once only)
}

function planAndInjectBlocks(
  html: string,
  adConfig: { publisherId: string; slotId: string; format: import('./adsense').AdPlacementConfig['format']; everyN: number } | null,
  shopeeConfig: ShopeeInjectionConfig | null,
  _minGap: number = 2,
  extraAdSlots: import('./adsense').InContentExtraSlot[] = [],
  publisherIdForExtras?: string,
  promoHtml: string | null = null,
  native?: NativeConfig,
): string {
  const { totalP, h2Positions } = analyzeContentStructure(html);
  if (totalP < 4) return html; // conteúdo muito curto

  // GUARD: anúncios NO MEIO DO ARTIGO são sempre 'in-article' (nativo fluid).
  // Formatos display ('auto'/'rectangle') no meio do texto rendem aquele
  // quadrado/banner gigante que quebra a leitura — o AdSense recomenda fluid
  // in-article para in-content. Forçamos aqui independentemente do que estiver
  // salvo na config, evitando inserção errada.
  const inArticle = (publisherId: string, slotId: string) =>
    adUnitOrMix(native, 'inContent', (u) => `<div class="ad-inarticle">${u}</div>`, publisherId, slotId, 'in-article');
  const adHtml = adConfig ? inArticle(adConfig.publisherId, adConfig.slotId) : '';

  // Slots fixos extras (após parágrafo N)
  const pubForExtras = publisherIdForExtras ?? adConfig?.publisherId ?? '';
  const validExtras = pubForExtras
    ? extraAdSlots.filter((s) => s.enabled && s.slotId && s.afterParagraph > 0)
    : [];

  // Se não tem ad NEM shopee NEM extras, nada a fazer
  const hasShopee = shopeeConfig && shopeeConfig.products.length > 0 && shopeeConfig.firstAfter > 0;
  if (!adHtml && !hasShopee && validExtras.length === 0 && !promoHtml) return html;

  // Posições proibidas: parágrafo do H2 (evita ads colados em headings)
  const forbidden = new Set<number>();
  for (const h2Pos of h2Positions) {
    forbidden.add(h2Pos);
  }

  // --- 1. Posicionar Shopee (card único por inserção, rotação aleatória) ---
  const shopeeBlocks: ContentBlock[] = [];
  const shopeeOccupied = new Set<number>();
  if (hasShopee) {
    const sc = shopeeConfig!;
    const firstPos = sc.firstAfter;
    if (firstPos < totalP) {
      // Calcula posições
      const positions: number[] = [];
      if (sc.everyN > 0) {
        for (let p = firstPos; p < totalP - 1; p += sc.everyN) {
          positions.push(p);
        }
      } else {
        positions.push(firstPos);
      }

      // Cada posição mostra 1 produto aleatório (já shuffled no caller)
      for (let i = 0; i < positions.length && i < sc.products.length; i++) {
        let pos = positions[i];

        // Pula posição proibida (H2) tentando vizinhos
        if (forbidden.has(pos)) {
          if (!forbidden.has(pos + 1) && pos + 1 < totalP) pos = pos + 1;
          else if (!forbidden.has(pos - 1) && pos - 1 > 0) pos = pos - 1;
          else continue;
        }
        if (shopeeOccupied.has(pos)) continue;

        const cardHtml = renderShopeeInlineCard(sc.products[i]);
        shopeeBlocks.push({ html: cardHtml, afterParagraph: pos });
        shopeeOccupied.add(pos);
      }
    }
  }

  // --- 1b. Promo interno (cartões): após o 1º parágrafo e a cada 4 depois.
  //     Posições: 1, 5, 9, 13... (evita parágrafos de H2 e colisão com Shopee). ---
  const promoBlocks: ContentBlock[] = [];
  const promoOccupied = new Set<number>();
  if (promoHtml) {
    const PROMO_EVERY = 4;
    const PROMO_MAX = 12; // teto de segurança para artigos muito longos
    for (let base = 1; base < totalP - 1 && promoBlocks.length < PROMO_MAX; base += PROMO_EVERY) {
      let pos = base;
      // Não cola em H2: tenta o vizinho
      if (forbidden.has(pos)) {
        if (!forbidden.has(pos + 1) && pos + 1 < totalP - 1) pos += 1;
        else if (pos - 1 > 0 && !forbidden.has(pos - 1)) pos -= 1;
        else continue;
      }
      if (pos > 0 && pos < totalP && !shopeeOccupied.has(pos) && !promoOccupied.has(pos)) {
        promoBlocks.push({ html: promoHtml, afterParagraph: pos });
        promoOccupied.add(pos);
      }
    }
  }

  // --- 2. AdSense preenche posições regulares (FOCO PRINCIPAL) ---
  // Usa o intervalo configurado no admin (everyNParagraphs). Mínimo de 2 parágrafos
  // (gap enforcement garante que nunca fiquem adjacentes). Google controla fill rate.
  const AD_INTERVAL = Math.max(adConfig?.everyN ?? 3, 2);
  const MAX_ADS = 8;
  const blocks: ContentBlock[] = [];

  if (adHtml) {
    for (let para = AD_INTERVAL; para < totalP && blocks.length < MAX_ADS; para += AD_INTERVAL) {
      if (forbidden.has(para)) {
        // Tenta posição seguinte
        if (!forbidden.has(para + 1) && para + 1 < totalP) para = para + 1;
        else continue;
      }
      // Não colocar ad na MESMA posição que Shopee/promo
      if (shopeeOccupied.has(para) || promoOccupied.has(para)) continue;

      blocks.push({ html: adHtml, afterParagraph: para });
    }
  }

  // --- 2b. Slots extras FIXOS (após parágrafo N configurado manualmente) ---
  // Cada um com slot ID único e formato próprio. Têm PRIORIDADE sobre os
  // recorrentes nas suas posições — se houver conflito, o recorrente da posição
  // é descartado (o extra é o que o admin pediu explicitamente).
  const extraBlocks: ContentBlock[] = [];
  const extraOccupied = new Set<number>();
  for (const x of validExtras) {
    let pos = x.afterParagraph;
    if (pos >= totalP) continue;

    // Se posição é proibida (parágrafo de H2), tenta vizinhos
    if (forbidden.has(pos)) {
      if (!forbidden.has(pos + 1) && pos + 1 < totalP) pos = pos + 1;
      else if (!forbidden.has(pos - 1) && pos - 1 > 0) pos = pos - 1;
      else continue;
    }
    // Conflito com Shopee ou outro extra na mesma posição: pula
    if (shopeeOccupied.has(pos) || extraOccupied.has(pos)) continue;

    // Extras também são in-content → força in-article (ver guard acima).
    const xHtml = inArticle(pubForExtras, x.slotId!); // validExtras já exige slotId
    extraBlocks.push({ html: xHtml, afterParagraph: pos });
    extraOccupied.add(pos);
  }

  // Remove recorrentes que colidem com extras (extras vencem)
  const recurringNoConflict = blocks.filter((b) => !extraOccupied.has(b.afterParagraph));

  // --- 3. Combina: todos os ads + shopee + extras, ordenados por posição ---
  const allBlocks = [...recurringNoConflict, ...shopeeBlocks, ...extraBlocks, ...promoBlocks]
    .sort((a, b) => a.afterParagraph - b.afterParagraph);

  return injectContentBlocks(html, allBlocks, 1);
}

/** Perfil de autor normalizado — vem de um usuário admin OU do autor padrão do site. */
export interface AuthorProfile {
  name: string;
  bio: string | null;
  avatar_url: string | null;
}

/** Converte um AdminUser num AuthorProfile (usado quando o autor do post bate com um usuário). */
export function adminUserToAuthorProfile(u: AdminUser): AuthorProfile {
  return {
    name: u.display_name?.trim() || u.username,
    bio: u.bio,
    avatar_url: u.avatar_url,
  };
}

/**
 * Campo de avatar com upload + recorte quadrado (cliente).
 * Guarda a URL final num input hidden (`name`). O recorte é feito via canvas
 * e enviado para POST /admin/upload/avatar, que retorna /img/...
 */
function renderAvatarField(name: string, value: string, idSuffix: string): string {
  const v = (value || '').trim();
  return `<div class="avatar-field" data-avatar-field>
    <div class="avatar-field__preview">
      <img src="${escapeHtml(v)}" alt="" data-avatar-preview${v ? '' : ' hidden'}>
      <span class="avatar-field__ph" data-avatar-ph${v ? ' hidden' : ''} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </span>
    </div>
    <div class="avatar-field__controls">
      <input type="hidden" name="${name}" value="${escapeHtml(v)}" data-avatar-url>
      <input type="file" accept="image/jpeg,image/png,image/webp" id="avatar-file-${idSuffix}" data-avatar-file hidden>
      <div class="avatar-field__btns">
        <label for="avatar-file-${idSuffix}" class="btn btn--ghost btn--sm">Enviar foto</label>
        <button type="button" class="btn btn--ghost btn--sm" data-avatar-clear${v ? '' : ' hidden'} style="color:var(--adm-danger)">Remover</button>
      </div>
      <small class="field__help">JPG, PNG ou WebP. Você recorta a parte que quer mostrar. Máx 5MB.</small>
    </div>
  </div>`;
}

/**
 * Modal de recorte (cropper) + script. Incluir UMA vez por página que usa
 * renderAvatarField. Recorte quadrado com arrastar + zoom; exporta 400×400 JPEG.
 */
function avatarCropperAssets(): string {
  return `
<div class="cropper" data-cropper hidden aria-modal="true" role="dialog" aria-label="Recortar foto">
  <div class="cropper__panel">
    <h3 class="cropper__title">Recorte a foto</h3>
    <p class="cropper__hint">Arraste para posicionar e use o controle para aproximar.</p>
    <div class="cropper__stage">
      <canvas data-cropper-canvas width="400" height="400"></canvas>
      <div class="cropper__ring" aria-hidden="true"></div>
    </div>
    <label class="cropper__zoom">
      <span>Zoom</span>
      <input type="range" min="1" max="3" step="0.01" value="1" data-cropper-zoom>
    </label>
    <div class="cropper__actions">
      <button type="button" class="btn btn--ghost" data-cropper-cancel>Cancelar</button>
      <button type="button" class="btn btn--primary" data-cropper-save>Usar foto</button>
    </div>
    <div class="cropper__err" data-cropper-err hidden></div>
  </div>
</div>
<script>
(function(){
  var modal = document.querySelector('[data-cropper]');
  if (!modal) return;
  var canvas = modal.querySelector('[data-cropper-canvas]');
  var ctx = canvas.getContext('2d');
  var zoom = modal.querySelector('[data-cropper-zoom]');
  var errEl = modal.querySelector('[data-cropper-err]');
  var O = canvas.width; // resolução de saída (400)
  var imgEl = new Image();
  var st = { natW:0, natH:0, scale:1, x:0, y:0, dragging:false, lastX:0, lastY:0, field:null };

  function base(){ return Math.max(O/st.natW, O/st.natH); }
  function draw(){
    var s = base() * st.scale;
    var dw = st.natW*s, dh = st.natH*s;
    st.x = Math.min(0, Math.max(O-dw, st.x));
    st.y = Math.min(0, Math.max(O-dh, st.y));
    ctx.clearRect(0,0,O,O);
    ctx.drawImage(imgEl, st.x, st.y, dw, dh);
  }
  function scaleFactor(){ return O / canvas.getBoundingClientRect().width; }

  function open(field, file){
    st.field = field;
    errEl.hidden = true;
    var url = URL.createObjectURL(file);
    imgEl.onload = function(){
      st.natW = imgEl.naturalWidth; st.natH = imgEl.naturalHeight;
      st.scale = 1; st.x = 0; st.y = 0;
      zoom.value = '1';
      // centraliza
      var s = base();
      st.x = (O - st.natW*s)/2; st.y = (O - st.natH*s)/2;
      draw();
      URL.revokeObjectURL(url);
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
    };
    imgEl.onerror = function(){ alert('Não consegui ler essa imagem.'); };
    imgEl.src = url;
  }
  function close(){ modal.hidden = true; document.body.style.overflow = ''; st.field = null; }

  zoom.addEventListener('input', function(){ st.scale = parseFloat(zoom.value)||1; draw(); });

  // arrastar (pointer)
  canvas.addEventListener('pointerdown', function(e){ st.dragging=true; st.lastX=e.clientX; st.lastY=e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', function(e){
    if(!st.dragging) return;
    var f = scaleFactor();
    st.x += (e.clientX-st.lastX)*f; st.y += (e.clientY-st.lastY)*f;
    st.lastX=e.clientX; st.lastY=e.clientY; draw();
  });
  function endDrag(){ st.dragging=false; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  modal.querySelector('[data-cropper-cancel]').addEventListener('click', close);
  modal.addEventListener('click', function(e){ if(e.target===modal) close(); });

  modal.querySelector('[data-cropper-save]').addEventListener('click', function(){
    var btn = this; btn.disabled = true; errEl.hidden = true;
    canvas.toBlob(function(blob){
      if(!blob){ btn.disabled=false; return; }
      fetch('/admin/upload/avatar', { method:'POST', headers:{'Content-Type':'image/jpeg'}, body: blob })
        .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
        .then(function(res){
          if(!res.ok){ throw new Error(res.j && res.j.error || 'Falha no upload'); }
          var field = st.field;
          field.querySelector('[data-avatar-url]').value = res.j.url;
          var prev = field.querySelector('[data-avatar-preview]');
          var ph = field.querySelector('[data-avatar-ph]');
          prev.src = res.j.url; prev.hidden = false; if(ph) ph.hidden = true;
          var clr = field.querySelector('[data-avatar-clear]'); if(clr) clr.hidden = false;
          btn.disabled = false; close();
        })
        .catch(function(err){ errEl.textContent = err.message; errEl.hidden = false; btn.disabled = false; });
    }, 'image/jpeg', 0.9);
  });

  // liga todos os campos de avatar
  document.querySelectorAll('[data-avatar-field]').forEach(function(field){
    var file = field.querySelector('[data-avatar-file]');
    file.addEventListener('change', function(){
      var f = file.files && file.files[0]; if(!f) return;
      if(f.size > 5*1024*1024){ alert('Imagem muito grande (máx 5MB).'); file.value=''; return; }
      open(field, f); file.value='';
    });
    var clr = field.querySelector('[data-avatar-clear]');
    if(clr) clr.addEventListener('click', function(){
      field.querySelector('[data-avatar-url]').value='';
      var prev=field.querySelector('[data-avatar-preview]'); var ph=field.querySelector('[data-avatar-ph]');
      prev.hidden=true; prev.removeAttribute('src'); if(ph) ph.hidden=false; clr.hidden=true;
    });
  });
})();
</script>`;
}

/**
 * Box de perfil do redator (avatar + nome + mini-bio), exibido logo após o post.
 * Só renderiza se houver bio ou avatar.
 */
function renderAuthorBox(author: AuthorProfile): string {
  const name = author.name.trim();
  const bio = author.bio?.trim() || '';
  const avatar = author.avatar_url?.trim() || '';
  const initial = name.charAt(0).toUpperCase() || '?';
  const avatarHtml = avatar
    ? `<img class="author-box__avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async" width="72" height="72">`
    : `<div class="author-box__avatar author-box__avatar--fallback" aria-hidden="true">${escapeHtml(initial)}</div>`;
  return `
<aside class="author-box" itemscope itemtype="https://schema.org/Person">
  ${avatarHtml}
  <div class="author-box__body">
    <span class="author-box__label">Escrito por</span>
    <h3 class="author-box__name" itemprop="name">${escapeHtml(name)}</h3>
    ${bio ? `<p class="author-box__bio" itemprop="description">${escapeHtml(bio)}</p>` : ''}
  </div>
</aside>`;
}

// ====== Post page ======
export function renderPost(
  env: Env, request: Request, post: Post,
  related: (Post | PostCard)[] = [], ads?: SiteAdSettings, typography?: SiteTypography,
  trendingPosts?: (Post | PostCard)[], _pollData?: unknown, gaId?: string,
  shopeeConfig?: ShopeeInjectionConfig | null,
  authorProfile?: AuthorProfile | null,
  cookieBanner = true,
): string {
  const url = new URL(request.url);
  const siteOrigin = siteCanonical(env, url);
  const postUrl = `${siteOrigin}/${post.slug}`;
  const tags = parseTags(post.tags);
  let html = renderMarkdown(post.content);
  // Remove <figure> com imagens de domínios desativados (Supabase antigo)
  html = stripBrokenImageFigures(html);
  // Sanitiza blockquotes mal-formados (WP export): fecha os não-fechados,
  // remove closes órfãos. Deve rodar ANTES de qualquer processamento de HTML.
  html = fixUnclosedBlockquotes(html);
  html = stripOrphanBlockquoteCloses(html);
  // Stripa <h1> duplicado no início do content (WP exporta o título dentro do body).
  // Remove o primeiro <h1>...</h1> se o texto bater ~80% com o título do post.
  html = stripDuplicateH1(html, post.title);
  // Inverte primeira e última imagem do conteúdo — a hero é igual à primeira,
  // então mostrando a última no topo o leitor vê algo diferente logo de cara.
  html = swapFirstLastImages(html);

  // Imagens do conteúdo (para fallback de hero quebrado/ausente, no servidor e no cliente).
  const contentImageSrcs = extractContentImageSrcs(html);
  // Hero efetivo: se o post não tem hero cadastrado, usa a 1ª imagem do conteúdo.
  // (Custo zero — só leitura de string, sem fetch.)
  const heroSrc = (post.hero_image && post.hero_image.trim())
    ? post.hero_image.trim()
    : (contentImageSrcs[0] ?? '');
  // Candidatos para o cliente promover ao hero caso ele quebre (404).
  const heroFallbacks = contentImageSrcs.filter((s) => s !== heroSrc).slice(0, 6);

  // Injeção unificada de ads + shopee: garante que nunca fiquem consecutivos.
  // Usa planAndInjectBlocks que resolve conflitos de posição automaticamente.
  const pubId = ads?.publisherId;
  const adPlan = (pubId && ads?.config.inContent.enabled && ads.config.inContent.slotId)
    ? { publisherId: pubId, slotId: ads.config.inContent.slotId, format: ads.config.inContent.format, everyN: ads.config.inContent.everyNParagraphs ?? 4 }
    : null;
  const extraSlots = (pubId && ads?.config.inContentExtra) ? ads.config.inContentExtra : [];
  html = planAndInjectBlocks(html, adPlan, shopeeConfig ?? null, 2, extraSlots, pubId, null, ads?.native);

  // "Em Alta" (top 24h): aparece ao FIM de cada seção — ou seja, logo antes de
  // cada H2 (exceto o primeiro). Repete o bloco em cada transição de subtítulo.
  if (trendingPosts && trendingPosts.length >= 2) {
    const trendingHtml = renderTrendingCarousel(trendingPosts);
    let firstH2 = true;
    html = html.replace(/<h2(\b[^>]*)>/g, (full) => {
      if (firstH2) { firstH2 = false; return full; } // 1º subtítulo: nada antes dele
      return trendingHtml + '\n' + full;
    });
  }

  // helper que renderiza um ad slot se config + slotId
  type SinglePlacementKey = Exclude<keyof AdConfig, 'inContentExtra'>;
  const adIf = (key: SinglePlacementKey, wrapperClass: string): string => {
    if (!pubId || !ads) return '';
    const p = ads.config[key] as import('./adsense').AdPlacementConfig | undefined;
    if (!p?.enabled || !p.slotId) return '';
    return adUnitOrMix(ads.native, key, (u) => `<aside class="ad-slot ${wrapperClass}">${u}</aside>`, pubId, p.slotId, p.format);
  };

  // Related posts
  const relatedHtml = related.length === 0 ? '' : renderRelatedSection(related);

  // Autor exibido (perfil padrão/redator resolvido). Usado no byline E no JSON-LD,
  // para o robô do Google/AdSense ler a mesma assinatura que aparece na página.
  const resolvedAuthorName = authorProfile?.name?.trim() || (post.author && post.author.trim()) || env.SITE_TITLE;

  // Metadata para personalização client-side
  const postMeta = JSON.stringify({ category: post.category || '', tags: tags });

  const body = `
<script type="application/json" id="cdh-post-meta">${postMeta}</script>
<article class="post">
  ${adIf('beforePost', 'ad-slot--before-post')}
  <header class="post__header">
    ${post.category && post.category.trim() && post.category !== 'Sem categoria'
      ? `<a class="post__kicker" href="/?cat=${encodeURIComponent(post.category)}">${escapeHtml(post.category)}</a>`
      : ''}
    <h1 class="post__title">${escapeHtml(cleanTitle(post.title, post.category))}</h1>
    <div class="post__meta">
      <div class="post__meta-inline">
        ${(() => {
          // Byline do topo usa o autor da página (perfil padrão/redator resolvido),
          // substituindo o post.author antigo. Cai pro post.author só se não houver perfil.
          const bylineName = resolvedAuthorName;
          return bylineName ? `<span class="post__author" itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">${escapeHtml(bylineName)}</span></span>
        <span class="post__meta-dot" aria-hidden="true">·</span>` : '';
        })()}
        <time datetime="${isoDate(post.pub_date)}">${formatDate(post.pub_date)}</time>
        <span class="post__meta-dot" aria-hidden="true">·</span>
        <span class="post__reading-time">${readingTime(post.content || '')}</span>
      </div>
    </div>
  </header>
  ${heroSrc ? `<div class="post__hero-wrap"><img src="${escapeHtml(heroSrc)}" alt="" class="post__hero" loading="eager" fetchpriority="high" decoding="async"${heroFallbacks.length ? ` data-fallbacks="${escapeHtml(heroFallbacks.join('|'))}"` : ''}></div>` : ''}
  ${(() => {
    const postUrl = `${siteOrigin}/${post.slug}`;
    const shareTitle = encodeURIComponent(post.title);
    const shareUrl = encodeURIComponent(postUrl);
    return `<div class="share-bar" data-share-url="${escapeHtml(postUrl)}">
    <span class="share-bar__label">Compartilhar</span>
    <a class="share-bar__btn share-bar__btn--whats" href="https://api.whatsapp.com/send?text=${shareTitle}%20${shareUrl}" target="_blank" rel="noopener" aria-label="Compartilhar no WhatsApp">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20.52 3.48A11.86 11.86 0 0012.06 0C5.5 0 .17 5.33.17 11.89c0 2.1.55 4.14 1.6 5.94L0 24l6.32-1.66a11.85 11.85 0 005.74 1.47h.01c6.55 0 11.89-5.33 11.89-11.89 0-3.18-1.24-6.16-3.44-8.44zM12.07 21.78h-.01a9.86 9.86 0 01-5.03-1.38l-.36-.21-3.74.98 1-3.65-.23-.37a9.85 9.85 0 01-1.5-5.26C2.2 6.42 6.6 2.03 12.07 2.03c2.64 0 5.13 1.03 7 2.9a9.85 9.85 0 012.9 7c0 5.46-4.45 9.85-9.9 9.85zm5.43-7.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.08-.3-.15-1.26-.47-2.4-1.48-.88-.79-1.48-1.76-1.66-2.06-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.8.37-.27.3-1.05 1.02-1.05 2.5 0 1.47 1.07 2.9 1.22 3.1.15.2 2.11 3.22 5.12 4.51.72.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z"/></svg>
    </a>
    <a class="share-bar__btn share-bar__btn--x" href="https://twitter.com/intent/tweet?text=${shareTitle}&url=${shareUrl}" target="_blank" rel="noopener" aria-label="Compartilhar no X">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
    </a>
    <button class="share-bar__btn share-bar__btn--copy" type="button" aria-label="Copiar link" data-copy>
      <svg class="ic-copy" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      <svg class="ic-check" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="20 6 9 17 4 12"/></svg>
    </button>
  </div>`;
  })()}
  ${adIf('topOfContent', 'ad-slot--top')}
  <div class="prose">${html}</div>
  ${adIf('afterContent', 'ad-slot--after')}
</article>${authorProfile ? renderAuthorBox(authorProfile) : ''}${relatedHtml}
${adIf('bottomOfPage', 'ad-slot--bottom')}
<div class="continue-cta">
  <h3 class="continue-cta__title">Gostou do capítulo?</h3>
  <p class="continue-cta__sub">Volte pra home e descubra mais novidades das novelas.</p>
  <div class="continue-cta__actions">
    <a href="/" class="btn-primary-cta">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      Página inicial
    </a>
    ${post.category && post.category !== 'Sem categoria' ? `<a href="/?cat=${encodeURIComponent(post.category)}" class="btn-secondary-cta">Mais de ${escapeHtml(post.category)}</a>` : ''}
  </div>
</div>
<script>
(function(){
  var article = document.querySelector('.post');
  if (!article) return;

  // --- Imagens quebradas (404, R2 externo expirado etc.) ---
  // Custo zero no caminho feliz: handlers só disparam no evento de erro.
  // Conteúdo: oculta a imagem/figure quebrada (não atrapalha a leitura).
  // Hero: promove a 1ª imagem do conteúdo que carregar; se nenhuma, oculta.
  (function(){
    document.querySelectorAll('.prose img').forEach(function(img) {
      img.addEventListener('error', function() {
        if (this.dataset.broken) return;
        this.dataset.broken = '1';
        var fig = this.closest('figure');
        (fig || this).style.display = 'none';
      }, { once: true });
    });

    var hero = document.querySelector('.post__hero');
    if (hero) {
      var fb = (hero.getAttribute('data-fallbacks') || '').split('|').filter(Boolean);
      var i = 0;
      hero.addEventListener('error', function() {
        // Tenta o próximo candidato de imagem do conteúdo.
        while (i < fb.length) {
          var next = fb[i++];
          if (next && next !== hero.getAttribute('src')) { hero.src = next; return; }
        }
        // Nenhuma imagem disponível → remove o hero para não mostrar quebrado.
        var wrap = hero.closest('.post__hero-wrap') || hero;
        wrap.style.display = 'none';
      });
    }
  })();

  // --- Compartilhar: copiar link ---
  var shareBar = document.querySelector('.share-bar');
  if (shareBar) {
    var copyBtn = shareBar.querySelector('[data-copy]');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        var url = shareBar.getAttribute('data-share-url') || location.href;
        var ic1 = copyBtn.querySelector('.ic-copy');
        var ic2 = copyBtn.querySelector('.ic-check');
        function showCheck() {
          if (ic1) ic1.style.display = 'none';
          if (ic2) ic2.style.display = '';
          copyBtn.classList.add('is-copied');
          setTimeout(function() {
            if (ic1) ic1.style.display = '';
            if (ic2) ic2.style.display = 'none';
            copyBtn.classList.remove('is-copied');
          }, 1800);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(showCheck).catch(function(){
            var ta = document.createElement('textarea');
            ta.value = url; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); showCheck(); } catch(e){}
            document.body.removeChild(ta);
          });
        }
      });
    }
  }

})();
</script>`;

  const heroAbs = post.hero_image
    ? (post.hero_image.startsWith('http') ? post.hero_image : `${siteOrigin}${post.hero_image}`)
    : undefined;

  const stickyAd = (pubId && ads?.config.stickyFooter.enabled && ads.config.stickyFooter.slotId)
    ? `<div class="ad-sticky-footer">${adUnitOrMix(ads.native, 'stickyFooter', (u) => u, pubId, ads.config.stickyFooter.slotId, ads.config.stickyFooter.format)}</div>`
    : '';
  const adsHead = adsHeadFor(ads);

  return layout(
    {
      title: `${post.title} — ${env.SITE_TITLE}`,
      description: post.description || env.SITE_DESCRIPTION,
      url: postUrl,
      siteTitle: env.SITE_TITLE,
      type: 'article',
      pubDate: post.pub_date,
      updatedDate: post.updated_date,
      author: post.author,
      image: heroAbs,
      tags,
      category: post.category ?? undefined,
      headInject: adsHead,
      gaId,
      stickyAd,
      typography,
      cookieBanner,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        mainEntityOfPage: { '@type': 'WebPage', '@id': postUrl },
        headline: post.title,
        description: post.description,
        ...(heroAbs && { image: { '@type': 'ImageObject', url: heroAbs } }),
        datePublished: isoDate(post.pub_date),
        dateModified: isoDate(post.updated_date),
        author: { '@type': 'Person', name: resolvedAuthorName },
        publisher: {
          '@type': 'Organization',
          name: env.SITE_TITLE,
          url: siteOrigin,
        },
        articleSection: post.category ?? undefined,
        keywords: tags.length ? tags.join(', ') : undefined,
        inLanguage: 'pt-BR',
      },
    },
    body,
  );
}

// ====== Related Posts — Banner Carousel ======
/** Carrossel horizontal "Em Alta" — top posts das últimas 24h (in-article, após H2). */
function renderTrendingCarousel(posts: (Post | PostCard)[]): string {
  if (posts.length < 2) return '';
  const cards = posts.slice(0, 4).map((p, i) => {
    const bg = p.hero_image ? escapeHtml(p.hero_image) : '';
    const cat = 'category' in p && p.category && p.category !== 'Sem categoria' ? p.category : '';
    return `<a class="trend__card" href="/${escapeHtml(p.slug)}" data-trend-idx="${i}">
      <span class="trend__img-wrap">
        ${bg ? `<img class="trend__img" src="${bg}" alt="" loading="lazy" decoding="async">` : '<span class="trend__img trend__img--ph"></span>'}
        <span class="trend__rank">${i + 1}</span>
      </span>
      <span class="trend__body">
        ${cat ? `<span class="trend__cat">${escapeHtml(cat)}</span>` : ''}
        <span class="trend__title">${escapeHtml(p.title)}</span>
      </span>
    </a>`;
  }).join('');

  return `<aside class="trend" aria-label="Em alta">
  <div class="trend__header">
    <svg class="trend__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
    <h3 class="trend__heading">Em Alta</h3>
  </div>
  <div class="trend__scroll" data-trend-scroll>
    ${cards}
  </div>
</aside>`;
}

function renderRelatedSection(posts: (Post | PostCard)[]): string {
  if (posts.length === 0) return '';
  const slides = posts.map((p, i) => {
    const cat = 'category' in p && p.category && p.category !== 'Sem categoria' ? p.category : '';
    const bg = p.hero_image ? escapeHtml(p.hero_image) : '';
    return `<a class="rcmd__slide${i === 0 ? ' is-active' : ''}" href="/${escapeHtml(p.slug)}" data-idx="${i}" aria-hidden="${i !== 0 ? 'true' : 'false'}" tabindex="${i !== 0 ? -1 : 0}"${bg ? ` style="--bg:url(${bg})"` : ''}>
      ${bg ? `<img class="rcmd__bg" src="${bg}" alt="" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async">` : '<span class="rcmd__bg rcmd__bg--ph"></span>'}
      <span class="rcmd__overlay"></span>
      ${cat ? `<span class="rcmd__cat">${escapeHtml(cat)}</span>` : ''}
      <span class="rcmd__info">
        <span class="rcmd__title">${escapeHtml(p.title)}</span>
        <time class="rcmd__date" datetime="${isoDate(p.pub_date)}">${formatDate(p.pub_date)}</time>
      </span>
    </a>`;
  }).join('');

  const dots = posts.map((_, i) =>
    `<button class="rcmd__dot${i === 0 ? ' is-active' : ''}" type="button" data-dot="${i}" aria-label="Slide ${i + 1}"></button>`
  ).join('');

  return `<section class="rcmd" aria-labelledby="rcmd-heading">
  <h2 id="rcmd-heading" class="rcmd__heading">
    <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v6.334a3 3 0 002.14 2.872l.468.156c.464.155.943.236 1.428.236h6.005a2.959 2.959 0 002.838-2.15l1.093-3.828a2 2 0 00-1.925-2.543H14.5V6.333a3 3 0 00-5.953-.576L6 10.333z"/></svg>
    Continue lendo
  </h2>
  <div class="rcmd__viewport" data-rcmd>
    <div class="rcmd__track">${slides}</div>
    <button class="rcmd__arrow rcmd__arrow--prev" type="button" aria-label="Anterior" data-rcmd-prev>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <button class="rcmd__arrow rcmd__arrow--next" type="button" aria-label="Próximo" data-rcmd-next>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
    </button>
    <div class="rcmd__dots">${dots}</div>
    <div class="rcmd__counter"><span data-rcmd-cur>1</span> / ${posts.length}</div>
  </div>
</section>
<script>
(function(){
  var el = document.querySelector('[data-rcmd]');
  if (!el) return;
  var slides = el.querySelectorAll('.rcmd__slide');
  var dots = el.querySelectorAll('.rcmd__dot');
  var counter = el.querySelector('[data-rcmd-cur]');
  var n = slides.length;
  if (n < 2) return;
  var cur = 0;
  var timer = null;
  var INTERVAL = 5000;
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function go(idx) {
    slides[cur].classList.remove('is-active');
    slides[cur].setAttribute('aria-hidden', 'true');
    slides[cur].tabIndex = -1;
    dots[cur].classList.remove('is-active');
    cur = ((idx % n) + n) % n;
    slides[cur].classList.add('is-active');
    slides[cur].setAttribute('aria-hidden', 'false');
    slides[cur].tabIndex = 0;
    dots[cur].classList.add('is-active');
    if (counter) counter.textContent = String(cur + 1);
  }
  function next() { go(cur + 1); }
  function prev() { go(cur - 1); }
  function startAuto() { stopAuto(); if (!prefersReduced) timer = setInterval(next, INTERVAL); }
  function stopAuto() { if (timer) { clearInterval(timer); timer = null; } }

  el.querySelector('[data-rcmd-next]').addEventListener('click', function() { stopAuto(); next(); startAuto(); });
  el.querySelector('[data-rcmd-prev]').addEventListener('click', function() { stopAuto(); prev(); startAuto(); });
  dots.forEach(function(d) { d.addEventListener('click', function() { stopAuto(); go(+d.dataset.dot); startAuto(); }); });

  // Touch swipe
  var x0 = null;
  el.addEventListener('touchstart', function(e) { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', function(e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) { stopAuto(); dx < 0 ? next() : prev(); startAuto(); }
  }, { passive: true });

  // Pause on hover/focus, resume on leave
  el.addEventListener('mouseenter', stopAuto);
  el.addEventListener('mouseleave', startAuto);
  el.addEventListener('focusin', stopAuto);
  el.addEventListener('focusout', startAuto);

  // Pause when not visible
  document.addEventListener('visibilitychange', function() { document.hidden ? stopAuto() : startAuto(); });

  startAuto();
})();
</script>`;
}


export function renderPrivacy(env: Env, request: Request, cookieBanner = true): string {
  const url = new URL(request.url);
  const siteUrl = siteCanonical(env, url);
  const today = new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });

  return layout(
    {
      title: `Política de Privacidade — ${env.SITE_TITLE}`,
      description: `Política de privacidade, uso de cookies, Google AdSense e LGPD do ${env.SITE_TITLE}.`,
      url: `${siteUrl}/privacidade`,
      siteTitle: env.SITE_TITLE,
      cookieBanner,
    },
    `<article class="post privacy">
  <header class="post__header">
    <h1 class="post__title">Política de Privacidade</h1>
    <p class="post__meta"><time>${today}</time></p>
  </header>
  <div class="prose">
    <p>Este site, <strong>${escapeHtml(env.SITE_TITLE)}</strong> ("nós", "nosso"), valoriza a privacidade dos seus visitantes. Esta Política de Privacidade explica quais informações coletamos, como usamos e quais são seus direitos sob a Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018).</p>

    <h2>1. Informações que coletamos</h2>
    <p>Coletamos automaticamente, ao acessar o site:</p>
    <ul>
      <li>Endereço IP (anonimizado quando possível)</li>
      <li>Tipo de navegador e dispositivo</li>
      <li>Páginas visitadas e tempo de permanência</li>
      <li>Site de origem (referrer)</li>
    </ul>
    <p>Não coletamos diretamente nome, e-mail ou outros dados pessoais identificáveis, exceto se você nos enviar voluntariamente (por e-mail).</p>

    <h2>2. Cookies</h2>
    <p>Utilizamos cookies para:</p>
    <ul>
      <li><strong>Cookies funcionais:</strong> garantir o funcionamento básico do site.</li>
      <li><strong>Cookies de análise:</strong> entender como o site é usado (páginas mais visitadas, tempo de leitura).</li>
      <li><strong>Cookies de publicidade:</strong> exibir anúncios relevantes via Google AdSense.</li>
    </ul>
    <p>Você pode desabilitar cookies nas configurações do seu navegador. Isso pode afetar partes da experiência do site.</p>

    <h2>3. Google AdSense</h2>
    <p>Este site utiliza o <strong>Google AdSense</strong>, serviço de publicidade do Google. O AdSense pode usar cookies (incluindo o cookie DART) e tecnologias semelhantes para exibir anúncios baseados em suas visitas a este e a outros sites na internet.</p>
    <p>Você pode:</p>
    <ul>
      <li>Optar por não receber o cookie DART acessando a <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener">política de privacidade de anúncios do Google</a>.</li>
      <li>Personalizar anúncios em <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">Configurações de anúncios do Google</a>.</li>
      <li>Optar pelo "Não rastrear" (Do Not Track) no seu navegador.</li>
    </ul>
    <p>Terceiros, incluindo o Google, podem veicular anúncios neste site com base em suas visitas anteriores. O uso de cookies pelo Google permite anúncios personalizados.</p>

    <h2>4. Como usamos suas informações</h2>
    <ul>
      <li>Melhorar o conteúdo e a experiência do site</li>
      <li>Analisar tráfego e padrões de uso (analytics interno)</li>
      <li>Exibir publicidade relevante via AdSense</li>
      <li>Cumprir obrigações legais</li>
    </ul>

    <h2>5. Compartilhamento de dados</h2>
    <p>Não vendemos nem alugamos suas informações pessoais. Compartilhamos apenas com provedores que nos ajudam a operar o site (ex.: Cloudflare como infraestrutura, Google AdSense para publicidade).</p>

    <h2>6. Seus direitos (LGPD)</h2>
    <p>Como titular de dados, você tem direito a:</p>
    <ul>
      <li>Confirmar a existência de tratamento de seus dados</li>
      <li>Acessar seus dados</li>
      <li>Corrigir dados incompletos, inexatos ou desatualizados</li>
      <li>Solicitar a anonimização, bloqueio ou eliminação de dados</li>
      <li>Solicitar a portabilidade dos dados</li>
      <li>Revogar o consentimento</li>
    </ul>
    <p>Para exercer qualquer desses direitos, entre em contato pelo e-mail abaixo.</p>

    <h2>7. Retenção de dados</h2>
    <p>Mantemos dados de analytics agregados por até 12 meses. Logs técnicos são mantidos pelo tempo estritamente necessário para operação e segurança.</p>

    <h2>8. Segurança</h2>
    <p>Adotamos medidas técnicas e organizacionais para proteger seus dados, incluindo HTTPS em todas as páginas, cabeçalhos de segurança e infraestrutura em provedor reconhecido (Cloudflare).</p>

    <h2>9. Crianças</h2>
    <p>Este site não é direcionado a menores de 13 anos. Não coletamos intencionalmente dados de crianças.</p>

    <h2>10. Alterações nesta política</h2>
    <p>Esta política pode ser atualizada. A data de revisão mais recente aparece no início desta página.</p>

    <h2>11. Contato</h2>
    <p>Para qualquer dúvida sobre privacidade, exercício de direitos LGPD, ou denúncias:</p>
    <p><strong>E-mail:</strong> <a href="mailto:contato@capitulodehoje.com.br">contato@capitulodehoje.com.br</a></p>
  </div>
</article>`,
  );
}

// ====== API Documentation ======
export function renderDocs(env: Env, request: Request, cookieBanner = true): string {
  const url = new URL(request.url);
  const siteUrl = siteCanonical(env, url);
  const base = `${url.protocol}//${url.host}`;

  return layout(
    {
      title: `Documentação da API — ${env.SITE_TITLE}`,
      description: 'Documentação técnica da API para publicação externa de posts.',
      url: `${siteUrl}/doc`,
      siteTitle: env.SITE_TITLE,
      bodyClass: 'is-doc',
      cookieBanner,
    },
    `<article class="post privacy">
  <header class="post__header">
    <h1 class="post__title">Documentação da API</h1>
    <p class="post__meta"><span>Atualizado em ${new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' })}</span></p>
  </header>
  <div class="prose">
    <p>Esta API permite criar posts no ${escapeHtml(env.SITE_TITLE)} a partir de sistemas externos (automações, bots, dashboards próprios, n8n, Zapier custom webhook, etc.).</p>

    <h2 id="auth">Autenticação</h2>
    <p>Toda requisição precisa de um <strong>Bearer token</strong> no header <code>Authorization</code>. Gere sua chave no painel:</p>
    <p><a href="/admin/api-keys" class="btn btn--primary">Ir para o painel de API Keys →</a></p>
    <pre><code>Authorization: Bearer cdh_xxxxxxxxxxxxxxxxxxxxxxxxx</code></pre>
    <p>O token aparece <strong>uma única vez</strong> no momento da criação — anote em local seguro. Para revogar uma chave, vá no painel e clique em <em>Revogar</em>.</p>

    <h2 id="endpoints">Endpoints</h2>
    <table class="docs-table">
      <thead><tr><th>Método</th><th>Endpoint</th><th>Descrição</th></tr></thead>
      <tbody>
        <tr><td><code>POST</code></td><td><code>/api/posts</code></td><td>Cria um post</td></tr>
        <tr><td><code>GET</code></td><td><code>/api/posts</code></td><td>Lista os posts mais recentes (com views opcional)</td></tr>
        <tr><td><code>GET</code></td><td><code>/api/posts/:slug</code></td><td>Detalhes de um post + views 24h</td></tr>
        <tr><td><code>GET</code></td><td><code>/api/posts/top</code></td><td>Top posts por visualizações (janela configurável)</td></tr>
      </tbody>
    </table>

    <h2 id="post-create">POST /api/posts — criar</h2>
    <pre><code>POST ${base}/api/posts
Content-Type: application/json
Authorization: Bearer cdh_xxx</code></pre>

    <h2 id="body">Corpo da requisição (JSON)</h2>
    <table class="docs-table">
      <thead><tr><th>Campo</th><th>Tipo</th><th>Obrig.?</th><th>Descrição</th></tr></thead>
      <tbody>
        <tr><td><code>title</code></td><td>string</td><td>✓</td><td>Título do post</td></tr>
        <tr><td><code>content</code></td><td>string</td><td>✓</td><td>Corpo do post em HTML (ou Markdown — vai ser renderizado)</td></tr>
        <tr><td><code>slug</code></td><td>string</td><td></td><td>URL final. Se omitido, é gerado a partir do título. Aceita apenas <code>a-z0-9-</code></td></tr>
        <tr><td><code>description</code></td><td>string</td><td></td><td>Resumo (até ~160 chars). Se omitido, gerado do <code>content</code></td></tr>
        <tr><td><code>category</code></td><td>string</td><td></td><td>Categoria do post</td></tr>
        <tr><td><code>tags</code></td><td>string[]</td><td></td><td>Lista de tags (array de strings)</td></tr>
        <tr><td><code>author</code></td><td>string</td><td></td><td>Nome do autor (default: "Erick Aoki")</td></tr>
        <tr><td><code>hero_image</code></td><td>string</td><td></td><td>URL absoluta da imagem de capa</td></tr>
        <tr><td><code>pub_date</code></td><td>string ISO</td><td></td><td>Data de publicação no formato ISO 8601 (default: agora)</td></tr>
        <tr><td><code>draft</code></td><td>boolean</td><td></td><td>Se <code>true</code>, o post não aparece publicamente (default: <code>false</code>)</td></tr>
      </tbody>
    </table>

    <h2 id="response">Resposta</h2>
    <p><strong>201 Created:</strong></p>
    <pre><code>{
  "id": 27586,
  "slug": "titulo-do-post",
  "url": "${base}/titulo-do-post"
}</code></pre>

    <h3>Códigos de erro</h3>
    <table class="docs-table">
      <thead><tr><th>Status</th><th>Significado</th></tr></thead>
      <tbody>
        <tr><td>400</td><td>JSON inválido, campo obrigatório faltando, slug inválido, pub_date malformado</td></tr>
        <tr><td>401</td><td>Header Authorization faltando ou key inválida/revogada</td></tr>
        <tr><td>409</td><td>Já existe um post com esse slug</td></tr>
        <tr><td>500</td><td>Erro interno (raríssimo — entre em contato)</td></tr>
      </tbody>
    </table>

    <h2 id="get-list">GET /api/posts — listar</h2>
    <p>Lista os posts mais recentes publicados.</p>
    <p><strong>Query params</strong>:</p>
    <ul>
      <li><code>limit</code> — quantos retornar (default 20, max 100)</li>
      <li><code>views=1</code> — inclui o campo <code>views_last_24h</code> em cada post (mais lento)</li>
    </ul>
    <p><strong>Exemplo:</strong></p>
    <pre><code>curl -H "Authorization: Bearer cdh_xxx" \\
  "${base}/api/posts?limit=10&amp;views=1"</code></pre>
    <p><strong>Resposta:</strong></p>
    <pre><code>{
  "count": 10,
  "posts": [
    {
      "id": 17472,
      "slug": "titulo-do-post",
      "title": "Título do post",
      "description": "Resumo...",
      "tags": ["novela", "spoiler"],
      "author": "Erick Aoki",
      "hero_image": "/img/abc.jpg",
      "draft": false,
      "pub_date": "2026-05-12T10:00:00.000Z",
      "updated_date": "2026-05-12T10:00:00.000Z",
      "url": "${base}/titulo-do-post",
      "views_last_24h": 42
    }
  ]
}</code></pre>

    <h2 id="get-single">GET /api/posts/:slug — detalhes</h2>
    <p>Retorna um post completo (com <code>content</code> HTML) e contagem de views nas últimas 24h.</p>
    <pre><code>curl -H "Authorization: Bearer cdh_xxx" \\
  "${base}/api/posts/jendal-vai-surtar"</code></pre>

    <h2 id="get-top">GET /api/posts/top — mais visualizados</h2>
    <p>Retorna os posts com mais visualizações em uma janela de tempo.</p>
    <p><strong>Query params</strong>:</p>
    <ul>
      <li><code>hours</code> — janela em horas (default 24, max 720)</li>
      <li><code>limit</code> — quantos retornar (default 10, max 100)</li>
    </ul>
    <p><strong>Exemplo:</strong></p>
    <pre><code># top 10 das últimas 24h
curl -H "Authorization: Bearer cdh_xxx" \\
  "${base}/api/posts/top?hours=24&amp;limit=10"

# top 5 da última semana
curl -H "Authorization: Bearer cdh_xxx" \\
  "${base}/api/posts/top?hours=168&amp;limit=5"</code></pre>
    <p><strong>Resposta:</strong></p>
    <pre><code>{
  "window_hours": 24,
  "count": 10,
  "posts": [
    {
      "id": 17472,
      "slug": "jendal-vai-surtar",
      "title": "Jendal vai surtar...",
      "url": "${base}/jendal-vai-surtar",
      "views_last_24h": 1284,
      ...
    }
  ]
}</code></pre>

    <h2 id="exemplos">Exemplos práticos</h2>

    <h3>curl</h3>
    <pre><code>curl -X POST ${base}/api/posts \\
  -H "Authorization: Bearer cdh_xxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Como migrar do WP para Cloudflare",
    "content": "&lt;p&gt;Conteúdo HTML do post...&lt;/p&gt;",
    "tags": ["tutorial","cloudflare"],
    "category": "Tutoriais",
    "hero_image": "https://exemplo.com/capa.jpg"
  }'</code></pre>

    <h3>Node.js (fetch)</h3>
    <pre><code>const res = await fetch('${base}/api/posts', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + process.env.CDH_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'Como migrar do WP para Cloudflare',
    content: '&lt;p&gt;Conteúdo HTML do post...&lt;/p&gt;',
    tags: ['tutorial', 'cloudflare'],
    hero_image: 'https://exemplo.com/capa.jpg',
  }),
});
const data = await res.json();
console.log(data.url);  // URL final do post</code></pre>

    <h3>Python (requests)</h3>
    <pre><code>import os, requests

r = requests.post(
    "${base}/api/posts",
    headers={
        "Authorization": f"Bearer {os.environ['CDH_API_KEY']}",
        "Content-Type": "application/json",
    },
    json={
        "title": "Como migrar do WP para Cloudflare",
        "content": "&lt;p&gt;Conteúdo HTML do post...&lt;/p&gt;",
        "tags": ["tutorial", "cloudflare"],
    },
)
print(r.json())</code></pre>

    <h2 id="limites">Limites & boas práticas</h2>
    <ul>
      <li>Não há rate limit explícito (por enquanto), mas evite mais de <strong>10 requests por segundo</strong> com a mesma chave.</li>
      <li>O <code>content</code> pode ter HTML; tags como <code>&lt;script&gt;</code> são preservadas — só envie o que vai publicar.</li>
      <li>Para reaproveitar imagens já no R2 do site, use URLs <code>/img/&lt;hash&gt;.&lt;ext&gt;</code> em vez de externas.</li>
      <li>Slugs duplicados retornam <code>409</code>. Se você quer atualizar um post existente, use o painel manualmente.</li>
    </ul>

    <h2 id="suporte">Suporte</h2>
    <p>Problemas com a API? <a href="mailto:contato@capitulodehoje.com.br">contato@capitulodehoje.com.br</a></p>
  </div>
</article>`,
  );
}

// ====== 404 ======
export function render404(env: Env, request: Request, cookieBanner = true): string {
  const url = new URL(request.url);
  return layout(
    {
      title: `404 — ${env.SITE_TITLE}`,
      description: 'Página não encontrada',
      url: `${siteCanonical(env, url)}${url.pathname}`,
      siteTitle: env.SITE_TITLE,
      bodyClass: 'is-404',
      cookieBanner,
    },
    `<div class="not-found"><h1>404</h1><p>Página não encontrada.</p><p><a href="/" class="btn">Voltar ao início</a></p></div>`,
  );
}

// ====== Admin: login ======
export function renderLogin(env: Env, request: Request, error?: string): string {
  const url = new URL(request.url);
  return layout(
    {
      title: `Admin — ${env.SITE_TITLE}`,
      description: 'Acesso restrito',
      url: `${url.protocol}//${url.host}/admin`,
      siteTitle: env.SITE_TITLE,
      bodyClass: 'admin adm-login-page',
    },
    `<div class="adm-login">
      <div class="adm-login__card">
        <div class="adm-login__brand">
          <span class="adm-brand__logo">${escapeHtml((env.SITE_TITLE.match(/\b[A-ZÀ-Ú]/g) ?? []).slice(0, 2).join('') || 'CH')}</span>
        </div>
        <h1>${escapeHtml(env.SITE_TITLE)}</h1>
        <p class="muted">Painel administrativo</p>
        ${error ? `<div class="alert alert--error" style="margin-top:1rem"><span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span><div>${escapeHtml(error)}</div></div>` : ''}
        <form method="POST" action="/admin/login" autocomplete="off" class="adm-login__form">
          <div class="field">
            <label>Usuário</label>
            <input type="text" name="username" required autofocus autocomplete="username">
          </div>
          <div class="field">
            <label>Senha</label>
            <input type="password" name="password" required autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn--primary btn--lg btn--block">Entrar</button>
        </form>
      </div>
    </div>`,
  );
}

// ====== Admin: dashboard ======
/** Renders the admin home / dashboard with stats + recent posts. */
export function renderAdminDashboard(
  env: Env, request: Request,
  data: {
    stats: { total: number; published: number; drafts: number; views24h: number; activeVisitors: number };
    recent: (Post | PostCard)[];
    topToday: Array<{ path: string; title?: string; views: number }>;
  },
): string {
  void request;
  const { stats, recent, topToday } = data;

  // Greeting contextual
  const hour = new Date().getUTCHours() - 3; // BRT
  const h = hour < 0 ? hour + 24 : hour;
  const greeting = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';

  return adminShell(env, {
    active: 'dashboard',
    title: greeting,
    subtitle: `${stats.total.toLocaleString('pt-BR')} posts · ${stats.views24h.toLocaleString('pt-BR')} views hoje`,
    actions: `<a href="/admin/new" class="btn btn--primary">+ Novo post</a>`,
  }, `
    <section class="dash-hero">
      <div class="dash-hero__stat">
        <span class="dash-hero__number">${stats.total.toLocaleString('pt-BR')}</span>
        <span class="dash-hero__label">posts publicados</span>
      </div>
      <div class="dash-hero__meta">
        <div class="dash-hero__pill">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <strong>${stats.views24h.toLocaleString('pt-BR')}</strong> views 24h
        </div>
        <div class="dash-hero__pill">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <strong>${stats.published}</strong> publicados · <strong>${stats.drafts}</strong> rascunhos
        </div>
        <div class="dash-hero__pill dash-hero__pill--live" id="live-visitors">
          <span class="live-dot"></span>
          <strong id="live-count">${stats.activeVisitors}</strong> ao vivo
        </div>
        <div class="dash-hero__pill dash-hero__pill--success">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Online
        </div>
      </div>
    </section>

    <div class="adm-split">
      <section class="card">
        <header class="card__header">
          <h2 class="card__title">Recentes</h2>
          <a href="/admin/posts" class="muted-link">Ver todos →</a>
        </header>
        <ul class="recent-list">
          ${recent.length === 0 ? `<li class="empty-state">Nenhum post ainda. <a href="/admin/new">Criar o primeiro</a></li>` : recent.map((p) => `
            <li class="recent-item">
              <a href="/admin/edit/${p.id}" class="recent-item__title">${escapeHtml(p.title)}</a>
              <span class="recent-item__meta">
                ${p.draft ? '<span class="badge badge--draft">Rascunho</span>' : ''}
                <time>${formatDate(p.pub_date)}</time>
              </span>
            </li>`).join('')}
        </ul>
      </section>

      <section class="card">
        <header class="card__header">
          <h2 class="card__title">Em alta</h2>
          <span class="muted">24h</span>
        </header>
        <ul class="recent-list">
          ${topToday.length === 0 ? `<li class="empty-state">Sem dados ainda.</li>` : topToday.map((t) => `
            <li class="recent-item">
              <a href="${escapeHtml(t.path)}" target="_blank" rel="noopener" class="recent-item__title">${escapeHtml(t.title ?? t.path)}</a>
              <span class="recent-item__meta"><strong>${t.views.toLocaleString('pt-BR')}</strong></span>
            </li>`).join('')}
        </ul>
      </section>
    </div>
    <script>
    (function(){
      var el = document.getElementById('live-count');
      if (!el) return;
      setInterval(function(){
        fetch('/api/active-visitors', { credentials: 'same-origin' })
          .then(function(r){ return r.json(); })
          .then(function(d){ if (typeof d.active === 'number') el.textContent = d.active; })
          .catch(function(){});
      }, 15000);
    })();
    </script>
  `);
}

/** Posts list — agora separado de /admin (que virou dashboard). */
export function renderAdminPosts(
  env: Env, request: Request,
  posts: (Post | PostCard | (PostCard & { content_length?: number }))[],
  filters: { q?: string; status?: 'all' | 'published' | 'draft' } = {},
  views?: Map<string, number>,
): string {
  void request;
  const status = filters.status ?? 'all';
  const q = filters.q ?? '';
  const filtered = posts.filter((p) => {
    if (status === 'published' && p.draft) return false;
    if (status === 'draft' && !p.draft) return false;
    if (q && !p.title.toLowerCase().includes(q.toLowerCase()) && !p.slug.includes(q.toLowerCase())) return false;
    return true;
  });

  // Faixas de caracteres p/ classificar conteúdo. Baseado nas políticas Google
  // de ad density: <2k = pouco conteúdo (risco de ad density alta), 2-5k = curto,
  // 5-10k = ideal, 10k+ = longo.
  function lengthBadge(len: number | undefined): string {
    if (len == null || len === 0) return '<span class="muted">—</span>';
    const k = len >= 1000 ? `${(len / 1000).toFixed(1).replace('.0', '')}k` : `${len}`;
    let cls = 'len-ok';
    let title = 'Tamanho ideal';
    if (len < 2000) { cls = 'len-bad';  title = 'Muito curto — risco de ad density alta'; }
    else if (len < 5000) { cls = 'len-warn'; title = 'Curto'; }
    else if (len >= 10000) { cls = 'len-good'; title = 'Longo'; }
    return `<span class="len-pill ${cls}" title="${title}">${escapeHtml(k)} chars</span>`;
  }

  // Célula de visualizações: ícone de olho + número (pt-BR, tabular). 0 fica esmaecido.
  function viewsCell(v: number | undefined): string {
    if (v == null) return '<td class="num"><span class="muted">—</span></td>';
    const n = v.toLocaleString('pt-BR');
    const eye = '<svg class="views-ico" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    return `<td class="num views-cell${v === 0 ? ' is-zero' : ''}" title="${n} ${v === 1 ? 'visualização' : 'visualizações'} no total">${eye}${escapeHtml(n)}</td>`;
  }

  return adminShell(env, {
    active: 'posts',
    title: 'Posts',
    subtitle: `${posts.length.toLocaleString('pt-BR')} posts no total`,
    actions: `<a href="/admin/new" class="btn btn--primary">+ Novo post</a>`,
  }, `
    <section class="card">
      <header class="card__header" style="gap:1rem; flex-wrap:wrap">
        <form method="GET" action="/admin/posts" class="search-form" style="flex:1; min-width:240px">
          <input type="search" name="q" placeholder="Buscar por título ou slug…" value="${escapeHtml(q)}">
          <input type="hidden" name="status" value="${status}">
        </form>
        <div class="filter-pills">
          <a href="/admin/posts?status=all${q ? '&q=' + encodeURIComponent(q) : ''}" class="pill ${status === 'all' ? 'is-active' : ''}">Todos</a>
          <a href="/admin/posts?status=published${q ? '&q=' + encodeURIComponent(q) : ''}" class="pill ${status === 'published' ? 'is-active' : ''}">Publicados</a>
          <a href="/admin/posts?status=draft${q ? '&q=' + encodeURIComponent(q) : ''}" class="pill ${status === 'draft' ? 'is-active' : ''}">Rascunhos</a>
        </div>
      </header>
      <table class="data-table">
        <thead>
          <tr><th>Título</th><th>Tamanho</th><th class="num">Views</th><th>Data</th><th>Status</th><th style="width:1px"></th></tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="6" class="empty-state">Nenhum post encontrado${q ? ' para "' + escapeHtml(q) + '"' : ''}.</td></tr>` : filtered.slice(0, 100).map((p) => {
            const len = (p as { content_length?: number }).content_length
              ?? ((p as Post).content ? (p as Post).content.length : undefined);
            return `
            <tr>
              <td>
                <a href="/admin/edit/${p.id}" class="post-link">${escapeHtml(p.title)}</a>
                <div class="muted">/${escapeHtml(p.slug)}</div>
              </td>
              <td class="nowrap">${lengthBadge(len)}</td>
              ${viewsCell(views?.get(p.slug))}
              <td class="nowrap"><time class="muted">${formatDate(p.pub_date)}</time></td>
              <td>${p.draft ? '<span class="badge badge--draft">Rascunho</span>' : '<span class="badge badge--success">Publicado</span>'}</td>
              <td>
                <div class="row-actions">
                  <a href="/${escapeHtml(p.slug)}" target="_blank" rel="noopener" class="btn btn--ghost btn--sm" title="Ver no site">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  </a>
                  <form method="POST" action="/admin/delete/${p.id}" onsubmit="return confirm('Excluir &quot;${escapeHtml(p.title).replace(/'/g, '&#39;').slice(0, 60)}&quot;?')" style="display:inline">
                    <button type="submit" class="btn btn--ghost btn--sm btn--danger" title="Excluir">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/></svg>
                    </button>
                  </form>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${filtered.length > 100 ? `<div class="table-footer muted">Mostrando 100 de ${filtered.length}. Use a busca pra refinar.</div>` : ''}
    </section>
  `);
}

// ====== Admin: shell with sidebar nav ======
type AdminSection = 'dashboard' | 'posts' | 'adsense' | 'settings' | 'configuracoes' | 'analytics' | 'shopee' | 'api-keys' | 'cache' | 'users';

interface AdminShellOptions {
  active: AdminSection;
  title: string;
  subtitle?: string;
  actions?: string;  // HTML pro lado direito do header
  bodyClass?: string;
  userRole?: UserRole;
}

/** Ícones SVG inline — 20px, stroke 1.75, currentColor */
const ICONS: Record<AdminSection, string> = {
  dashboard: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
  posts:     '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>',
  adsense: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 20h18M5 16l5-5 4 3 6-9M15 5h5v5"/></svg>',
  settings:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
  configuracoes: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  'api-keys':'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  cache:     '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  shopee:    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>',
  users:     '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
};

// Sections restricted to admin role only
const ADMIN_ONLY_SECTIONS: Set<AdminSection> = new Set(['configuracoes', 'api-keys', 'users', 'adsense']);

function adminShell(env: Env, opts: AdminShellOptions, body: string): string {
  const { active, title, subtitle, actions = '', bodyClass = '', userRole = 'admin' } = opts;
  const allNavItems: Array<[AdminSection, string, string]> = [
    ['dashboard', '/admin', 'Início'],
    ['posts',     '/admin/posts', 'Posts'],
    ['analytics', '/admin/analytics', 'Analytics'],
    ['settings',  '/admin/settings', 'Monetização'],
    ['adsense',  '/admin/adsense', 'Receita AdSense'],
    ['configuracoes', '/admin/configuracoes', 'Configurações'],
    ['users',     '/admin/users', 'Usuários'],
    ['api-keys',  '/admin/api-keys', 'API'],
    ['cache',     '/admin/cache', 'Cache'],
  ];
  const navItems = userRole === 'admin'
    ? allNavItems
    : allNavItems.filter(([k]) => !ADMIN_ONLY_SECTIONS.has(k));

  // Mobile bottom nav: show only the 5 most important items
  const allMobileNavItems: Array<[AdminSection, string, string]> = [
    ['dashboard', '/admin', 'Início'],
    ['posts',     '/admin/posts', 'Posts'],
    ['analytics', '/admin/analytics', 'Analytics'],
    ['settings',  '/admin/settings', 'Ads'],
    ['configuracoes', '/admin/configuracoes', 'Config'],
  ];
  const mobileNavItems = userRole === 'admin'
    ? allMobileNavItems
    : allMobileNavItems.filter(([k]) => !ADMIN_ONLY_SECTIONS.has(k));

  const nav = navItems.map(([k, href, label]) => `
    <a class="adm-nav__item ${active === k ? 'is-active' : ''}" href="${href}">
      <span class="adm-nav__icon">${ICONS[k]}</span>
      <span class="adm-nav__label">${label}</span>
    </a>`).join('');

  const bottomNav = mobileNavItems.map(([k, href, label]) => `
    <a class="adm-bnav__item ${active === k ? 'is-active' : ''}" href="${href}">
      <span class="adm-bnav__icon">${ICONS[k]}</span>
      <span class="adm-bnav__label">${label}</span>
    </a>`).join('');

  const innerBody = `
<div class="adm-shell">
  <aside class="adm-sidebar">
    <a href="/admin" class="adm-brand">
      <span class="adm-brand__logo">${escapeHtml((env.SITE_TITLE.match(/\b[A-ZÀ-Ú]/g) ?? []).slice(0, 2).join('') || 'CH')}</span>
      <span class="adm-brand__text">
        <strong>${escapeHtml(env.SITE_TITLE)}</strong>
        <small>admin</small>
      </span>
    </a>
    <nav class="adm-nav">${nav}</nav>
    <div class="adm-sidebar__footer">
      <a href="/" target="_blank" rel="noopener" class="adm-footer-link">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Ver site
      </a>
      <form method="POST" action="/admin/logout" style="margin:0">
        <button type="submit" class="adm-footer-link adm-footer-link--btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sair
        </button>
      </form>
    </div>
  </aside>

  <main class="adm-main">
    <header class="adm-page-header">
      <div class="adm-page-header__left">
        <h1 class="adm-page-header__title">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="adm-page-header__subtitle">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      ${actions ? `<div class="adm-page-header__actions">${actions}</div>` : ''}
    </header>
    <div class="adm-content">${body}</div>
  </main>

  <nav class="adm-bottom-nav">${bottomNav}</nav>
</div>`;

  return layout(
    {
      title: `${title} — ${env.SITE_TITLE}`,
      description: 'Painel admin',
      url: '',
      siteTitle: env.SITE_TITLE,
      bodyClass: `admin adm-page ${bodyClass}`,
    },
    innerBody,
  );
}

// ====== Admin: Settings ======
export interface NativePanelData {
  config: NativeConfig;
  report: MixReport;
  range: 'all' | '7' | '1';
  flash?: 'saved' | 'reset' | null;
  imported?: { added: number; updated: number; skipped: number; copied: number; failed: number } | null;
  importError?: string;
}

function monetizacaoTabs(active: 'adsense' | 'nativos'): string {
  return `<nav class="filter-pills nv-tabs" aria-label="Seções de monetização">
    <a href="/admin/settings" class="pill ${active === 'adsense' ? 'is-active' : ''}">AdSense</a>
    <a href="/admin/settings?tab=nativos" class="pill ${active === 'nativos' ? 'is-active' : ''}">Nativos e teste A/B</a>
  </nav>`;
}

export function renderAdminSettings(
  env: Env, request: Request,
  data: {
    publisherId: string;
    autoAds: boolean;
    adConfig: AdConfig;
    saved?: boolean;
    error?: string;
    tab?: string;
    native?: NativePanelData;
  },
): string {
  void request;
  const { publisherId, autoAds, adConfig, saved, error } = data;

  if (data.tab === 'nativos' && data.native) {
    return adminShell(env, {
      active: 'settings',
      title: 'Monetização',
      subtitle: 'Banners nativos × AdSense: split de tráfego e teste A/B entre banners',
    }, monetizacaoTabs('nativos') + renderNativePanel(data.native, publisherId.length >= 10));
  }

  type SinglePlacementKey = Exclude<keyof AdConfig, 'inContentExtra'>;
  const placements: Array<{
    key: SinglePlacementKey;
    label: string;
    help: string;
    icon: string;
    hasN?: 'paragraphs' | 'cards';
  }> = [
    {
      key: 'beforePost', label: 'Antes do título',
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
      help: 'Aparece acima da imagem de capa. RPM baixo — use com moderação.',
    },
    {
      key: 'topOfContent', label: 'Topo do conteúdo',
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>',
      help: 'Logo após o título, antes do primeiro parágrafo. Alto RPM — recomendado.',
    },
    {
      key: 'inContent', label: 'No meio do texto',
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>',
      help: 'A cada N parágrafos. Formato in-article é o que melhor performa.',
      hasN: 'paragraphs',
    },
    {
      key: 'afterContent', label: 'Final do conteúdo',
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
      help: 'Após o último parágrafo, antes dos posts relacionados.',
    },
    {
      key: 'bottomOfPage', label: 'Rodapé da página',
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="15" x2="21" y2="15"/></svg>',
      help: 'Depois dos posts relacionados, no fim da página.',
    },
    {
      key: 'betweenCards', label: 'Entre cards (home)',
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
      help: 'Insere um card de anúncio a cada N cards na listagem.',
      hasN: 'cards',
    },
    {
      key: 'stickyFooter', label: 'Sticky mobile',
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
      help: 'Anúncio fixo no rodapé em telas pequenas — alto CTR mas pode incomodar.',
    },
  ];

  // --- HTML dos slots extras de in-content (posições fixas) ---
  const extras = adConfig.inContentExtra ?? [];
  const extraRowHtml = (idx: number, slot: { slotId?: string; format?: string; afterParagraph?: number; enabled?: boolean }) => `
    <div class="extra-slot-row" data-idx="${idx}">
      <label class="extra-slot-row__toggle">
        <input type="checkbox" name="extra.enabled.${idx}" value="1" ${slot.enabled ? 'checked' : ''}>
        <span></span>
      </label>
      <div class="extra-slot-row__field">
        <label>Slot ID</label>
        <input type="text" name="extra.slot.${idx}" value="${escapeHtml(slot.slotId ?? '')}" placeholder="1234567890" inputmode="numeric" data-slot-input>
      </div>
      <div class="extra-slot-row__field extra-slot-row__field--narrow">
        <label>Após parágrafo</label>
        <input type="number" name="extra.after.${idx}" value="${slot.afterParagraph ?? 3}" min="1" max="100" step="1">
      </div>
      <div class="extra-slot-row__field extra-slot-row__field--narrow">
        <label>Formato</label>
        <select name="extra.format.${idx}">
          ${(['in-article','auto','fluid','banner','rectangle'] as const).map((f) =>
            `<option value="${f}" ${slot.format === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select>
      </div>
      <button type="button" class="extra-slot-row__del" data-extra-del title="Remover este anúncio" aria-label="Remover">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    </div>`;
  const inContentExtraHtml = `
    <div class="placement-card placement-card--extras is-on" data-placement="inContentExtra">
      <header class="placement-card__header">
        <span class="placement-card__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span>
        <div class="placement-card__heading">
          <h3>Anúncios extras no meio do texto</h3>
          <p>Slots <strong>fixos</strong> em posições específicas (após o parágrafo X). Cada um com Slot ID único — adicione quantos quiser. Têm prioridade sobre os recorrentes nas suas posições.</p>
        </div>
      </header>
      <div class="placement-card__body">
        <div class="extra-slots-list" id="extra-slots-list">
          ${extras.length === 0
            ? `<p class="extra-slots-empty">Nenhum anúncio extra configurado. Use o botão abaixo para adicionar.</p>`
            : extras.map((s, i) => extraRowHtml(i, s)).join('')}
        </div>
        <button type="button" class="btn btn--ghost btn--sm" id="extra-add-btn" style="margin-top:0.75rem">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Adicionar anúncio em posição específica
        </button>
      </div>
    </div>`;

  const placementsHtml = placements.flatMap((pl) => {
    const cfg = adConfig[pl.key];
    const n = pl.hasN === 'paragraphs' ? (cfg as any).everyNParagraphs
            : pl.hasN === 'cards'      ? (cfg as any).everyNCards : null;
    const isOn = cfg.enabled;
    const cardHtml = `<div class="placement-card ${isOn ? 'is-on' : ''}" data-placement="${pl.key}">
      <header class="placement-card__header">
        <span class="placement-card__icon">${pl.icon}</span>
        <div class="placement-card__heading">
          <h3>${pl.label}</h3>
          <p>${pl.help}</p>
        </div>
        <label class="toggle">
          <input type="checkbox" name="enabled.${pl.key}" value="1" ${cfg.enabled ? 'checked' : ''}>
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </label>
      </header>
      <div class="placement-card__body">
        <div class="field-row">
          <div class="field">
            <label>Slot ID <span class="hint">único por posição</span></label>
            <input type="text" name="slot.${pl.key}" value="${escapeHtml(cfg.slotId ?? '')}" placeholder="1234567890" inputmode="numeric" data-slot-input>
          </div>
          <div class="field">
            <label>Formato${pl.key === 'inContent' ? ' <span class="hint">recomendado: in-article</span>' : ''}</label>
            <select name="format.${pl.key}">
              ${(['auto','fluid','banner','rectangle','in-article'] as const).map((f) =>
                `<option value="${f}" ${cfg.format === f ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
          </div>
          ${pl.hasN ? `<div class="field">
            <label>${pl.hasN === 'paragraphs' ? 'A cada N par.' : 'A cada N cards'}</label>
            <input type="number" name="n.${pl.key}" min="1" max="20" value="${n ?? (pl.hasN === 'paragraphs' ? 4 : 6)}">
          </div>` : ''}
        </div>
      </div>
    </div>`;
    // Após o card de inContent, insere o gerenciador de slots extras
    return pl.key === 'inContent' ? [cardHtml, inContentExtraHtml] : [cardHtml];
  }).join('');

  // resumo: quantos ativos
  const activeCount = placements.filter((pl) => {
    const cfg = adConfig[pl.key];
    return cfg.enabled && cfg.slotId;
  }).length;
  const adsenseConfigured = publisherId.length >= 10;

  return adminShell(env, {
    active: 'settings',
    title: 'Monetização',
    subtitle: 'Configure Google AdSense, placements e ferramentas de receita',
    actions: '<a href="/admin/adsense" class="btn">Receita AdSense</a>',
  }, `
    ${monetizacaoTabs('adsense')}
    ${saved ? `<div class="alert alert--success"><span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span><div><strong>Configurações salvas.</strong></div></div>` : ''}
    ${error ? `<div class="alert alert--error"><span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span><div>${escapeHtml(error)}</div></div>` : ''}

    <section class="status-strip">
      <div class="status-strip__item ${adsenseConfigured ? 'is-on' : 'is-off'}">
        <span class="status-strip__dot"></span>
        <div>
          <strong>AdSense</strong>
          <small>${adsenseConfigured ? 'Conectado' : 'Não configurado'}</small>
        </div>
      </div>
      <div class="status-strip__item ${autoAds ? 'is-on' : 'is-off'}">
        <span class="status-strip__dot"></span>
        <div>
          <strong>Auto Ads</strong>
          <small>${autoAds ? 'Ativado' : 'Desativado'}</small>
        </div>
      </div>
      <div class="status-strip__item is-info">
        <span class="status-strip__dot"></span>
        <div>
          <strong>Placements</strong>
          <small>${activeCount} de ${placements.length} ativos</small>
        </div>
      </div>
    </section>

    <form method="POST" action="/admin/settings">
      <section class="card">
        <header class="card__header card__header--icon">
          <span class="card__header-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
          </span>
          <div>
            <h2 class="card__title">Conta Google AdSense</h2>
            <p class="card__desc">ID do publisher e configurações globais. Sem isso, nenhum anúncio é exibido.</p>
          </div>
        </header>
        <div class="card__body">
          <div class="field">
            <label>Publisher ID</label>
            <input type="text" name="adsense.publisher_id" value="${escapeHtml(publisherId)}" placeholder="ca-pub-XXXXXXXXXXXXXXXX" inputmode="text" autocomplete="off">
            <small class="field__help">Encontre em <a href="https://www.google.com/adsense" target="_blank" rel="noopener">adsense.google.com</a> → Conta → Informações de pagamento. Formato: <code>ca-pub-</code> + 16 dígitos.</small>
          </div>
          <div class="field field--check">
            <label class="check"><input type="checkbox" name="adsense.auto_ads" value="1" ${autoAds ? 'checked' : ''}> <span>Ativar <strong>Auto Ads</strong> do Google</span></label>
            <small class="field__help">O Google escolhe automaticamente onde inserir anúncios extras. Coexiste com os placements manuais abaixo.</small>
          </div>
        </div>
      </section>

      <section class="card">
        <header class="card__header card__header--icon">
          <span class="card__header-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
          </span>
          <div>
            <h2 class="card__title">Posicionamento de anúncios</h2>
            <p class="card__desc">Ative os pontos onde quer veicular. Cada slot precisa de um <strong>Slot ID</strong> criado no painel do AdSense.</p>
          </div>
        </header>
        <div class="card__body placements-list">
          <div class="alert alert--info" style="margin-bottom:1rem">
            <span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></span>
            <div>
              <strong>Importante:</strong> use um <strong>Slot ID diferente para cada posição</strong>. Reutilizar o mesmo ID faz o Google preencher apenas a primeira ocorrência (as demais ficam vazias). Crie unidades distintas no painel do AdSense → Anúncios → Por unidade de anúncio.
            </div>
          </div>
          <div id="dup-warning" class="alert alert--error" style="display:none; margin-bottom:1rem">
            <span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
            <div><strong>Slot IDs duplicados detectados.</strong> <span id="dup-list"></span> Crie IDs únicos no painel AdSense para que todos os anúncios apareçam.</div>
          </div>
          ${placementsHtml}
        </div>
      </section>

      <div class="sticky-actions">
        <button type="submit" class="btn btn--primary btn--lg">Salvar configurações</button>
      </div>
    </form>
    <script>
      document.querySelectorAll('.placement-card input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          cb.closest('.placement-card').classList.toggle('is-on', cb.checked);
        });
      });
      // Detecta slot IDs duplicados em tempo real
      function checkDupes() {
        var inputs = Array.from(document.querySelectorAll('input[data-slot-input]'));
        var values = {};
        var dupes = new Set();
        inputs.forEach(function(el) {
          var v = el.value.trim();
          if (!v) { el.classList.remove('is-dup'); return; }
          if (values[v]) { dupes.add(v); el.classList.add('is-dup'); values[v].classList.add('is-dup'); }
          else { values[v] = el; el.classList.remove('is-dup'); }
        });
        var warn = document.getElementById('dup-warning');
        if (dupes.size) {
          warn.style.display = 'flex';
          document.getElementById('dup-list').textContent = 'IDs em conflito: ' + Array.from(dupes).join(', ') + '.';
        } else {
          warn.style.display = 'none';
        }
      }
      document.querySelectorAll('input[data-slot-input]').forEach(function(el) {
        el.addEventListener('input', checkDupes);
      });
      checkDupes();

      // === Slots extras de in-content: adicionar / remover dinamicamente ===
      var extrasList = document.getElementById('extra-slots-list');
      var addBtn = document.getElementById('extra-add-btn');
      function nextExtraIdx() {
        var max = -1;
        extrasList.querySelectorAll('.extra-slot-row').forEach(function(r) {
          var i = parseInt(r.getAttribute('data-idx') || '-1', 10);
          if (i > max) max = i;
        });
        return max + 1;
      }
      function buildExtraRow(idx) {
        var wrap = document.createElement('div');
        wrap.className = 'extra-slot-row';
        wrap.setAttribute('data-idx', String(idx));
        wrap.innerHTML =
          '<label class="extra-slot-row__toggle">' +
          '  <input type="checkbox" name="extra.enabled.' + idx + '" value="1" checked>' +
          '  <span></span>' +
          '</label>' +
          '<div class="extra-slot-row__field">' +
          '  <label>Slot ID</label>' +
          '  <input type="text" name="extra.slot.' + idx + '" placeholder="1234567890" inputmode="numeric" data-slot-input>' +
          '</div>' +
          '<div class="extra-slot-row__field extra-slot-row__field--narrow">' +
          '  <label>Após parágrafo</label>' +
          '  <input type="number" name="extra.after.' + idx + '" value="3" min="1" max="100" step="1">' +
          '</div>' +
          '<div class="extra-slot-row__field extra-slot-row__field--narrow">' +
          '  <label>Formato</label>' +
          '  <select name="extra.format.' + idx + '">' +
          '    <option value="in-article" selected>in-article</option>' +
          '    <option value="auto">auto</option>' +
          '    <option value="fluid">fluid</option>' +
          '    <option value="banner">banner</option>' +
          '    <option value="rectangle">rectangle</option>' +
          '  </select>' +
          '</div>' +
          '<button type="button" class="extra-slot-row__del" data-extra-del aria-label="Remover">' +
          '  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>' +
          '</button>';
        return wrap;
      }
      function refreshEmpty() {
        var empty = extrasList.querySelector('.extra-slots-empty');
        var hasRows = extrasList.querySelectorAll('.extra-slot-row').length > 0;
        if (hasRows && empty) empty.remove();
        if (!hasRows && !empty) {
          var p = document.createElement('p');
          p.className = 'extra-slots-empty';
          p.textContent = 'Nenhum anúncio extra configurado. Use o botão abaixo para adicionar.';
          extrasList.appendChild(p);
        }
      }
      if (addBtn) {
        addBtn.addEventListener('click', function() {
          var idx = nextExtraIdx();
          var row = buildExtraRow(idx);
          extrasList.appendChild(row);
          row.querySelector('input[data-slot-input]').addEventListener('input', checkDupes);
          refreshEmpty();
          checkDupes();
          row.querySelector('input[type="text"]').focus();
        });
      }
      extrasList.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-extra-del]');
        if (!btn) return;
        var row = btn.closest('.extra-slot-row');
        if (row) {
          row.remove();
          refreshEmpty();
          checkDupes();
        }
      });
    </script>
  `);
}

// ====== Admin: Monetização → Nativos e teste A/B ======
const fmtInt = (n: number) => Math.round(n).toLocaleString('pt-BR');
const fmtPct = (p: number, digits = 2) => `${(p * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
const fmtBrl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtChance = (p: number) => p >= 0.995 ? '>99%' : p > 0 && p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`;

function renderNativePanel(d: NativePanelData, adsenseConfigured: boolean): string {
  const { config: cfg, report: r } = d;
  const e = r.economics;
  const running = nativeActive(cfg);
  const runnable = runnableCreatives(cfg);
  const activeCount = cfg.creatives.filter((c) => c.active).length;
  const since = cfg.startedAt ? new Date(cfg.startedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  const okIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  const warnIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  const infoIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  const alert = (kind: 'success' | 'error' | 'info', icon: string, html: string) =>
    `<div class="alert alert--${kind}"><span class="alert__icon">${icon}</span><div>${html}</div></div>`;

  // ---------- Avisos ----------
  const flashes: string[] = [];
  if (d.flash === 'saved') flashes.push(alert('success', okIcon, '<strong>Configurações salvas.</strong> O cache do site foi limpo; as páginas novas já usam o novo split.'));
  if (d.flash === 'reset') flashes.push(alert('success', okIcon, '<strong>Novo teste iniciado.</strong> A contagem recomeçou do zero (os dados antigos continuam guardados, só não entram mais no resultado).'));
  if (d.imported) {
    const im = d.imported;
    flashes.push(alert('success', okIcon, `<strong>Importação concluída.</strong> ${im.added} criativo(s) novo(s), ${im.updated} atualizado(s), ${im.copied} imagem(ns) copiada(s) para o R2${im.failed ? ` · ${im.failed} imagem(ns) não baixaram e continuam apontando para o site de origem` : ''}${im.skipped ? ` · ${im.skipped} banner(s) ignorado(s) (tamanho não suportado)` : ''}.`));
  }
  if (d.importError) flashes.push(alert('error', warnIcon, escapeHtml(d.importError)));
  if (!adsenseConfigured) flashes.push(alert('info', infoIcon, 'O teste usa as posições do AdSense. Configure o <strong>Publisher ID</strong> e os slots na aba AdSense para os banners nativos aparecerem.'));

  // ---------- Status ----------
  const statusStrip = `<section class="status-strip">
      <div class="status-strip__item ${running ? 'is-on' : 'is-off'}">
        <span class="status-strip__dot"></span>
        <div><strong>Teste</strong><small>${running ? `Rodando desde ${since}` : cfg.enabled ? 'Ligado, mas sem banner rodável' : 'Desligado'}</small></div>
      </div>
      <div class="status-strip__item is-info">
        <span class="status-strip__dot"></span>
        <div><strong>Grupos</strong><small>${cfg.share}% dos leitores só com nativos · ${100 - cfg.share}% com AdSense</small></div>
      </div>
      <div class="status-strip__item is-info">
        <span class="status-strip__dot"></span>
        <div><strong>Banners</strong><small>${runnable.length} rodando de ${cfg.creatives.length} importados</small></div>
      </div>
    </section>`;

  // ---------- Veredito ----------
  const verdict: string[] = [];
  if (r.nativePv === 0 && r.adsensePv === 0) {
    verdict.push(running
      ? 'Coletando dados: ainda não há pageviews registrados neste teste.'
      : 'O teste está desligado. Importe os banners, ligue o teste e escolha o % de leitores.');
  } else {
    if (e.lift !== null && e.nativePageRpm !== null) {
      const pct = Math.abs(e.lift * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
      const range = e.nativePageRpmRange;
      const clear = range !== null && (range.low > e.adsensePageRpm || range.high < e.adsensePageRpm);
      verdict.push(`Por mil páginas vistas, o grupo nativo rende <strong>${pct}% ${e.lift >= 0 ? 'mais' : 'menos'}</strong> que o grupo AdSense: ${fmtBrl(e.nativePageRpm)} contra ${fmtBrl(e.adsensePageRpm)}. ${clear ? 'A diferença já está fora da margem de erro.' : 'Ainda está dentro da margem de erro, então deixe rodar mais.'}`);
    } else if (e.adsensePageRpm <= 0) {
      verdict.push('Informe o <strong>RPM de página do AdSense</strong> abaixo para comparar os dois grupos em reais.');
    }
    if (e.breakEvenCpc !== null) {
      verdict.push(`O grupo nativo gera ${fmtInt(r.clicksPerPv * 1000)} cliques a cada mil páginas. Para empatar com o AdSense, cada clique precisa valer <strong>${fmtBrl(e.breakEvenCpc)}</strong> em comissão. ${e.valuePerClick > 0 ? `Você informou ${fmtBrl(e.valuePerClick)} por clique.` : 'Se a comissão média por clique for maior que isso, o nativo ganha.'}`);
    }
    const leader = r.creatives[0];
    if (r.winner) {
      verdict.push(`<strong>${escapeHtml(r.winner.label)}</strong> é o melhor banner: ${fmtChance(r.winner.pBest)} de chance de ter o maior CTR (${fmtPct(r.winner.ctr)}).${r.winner.pageRpm !== null && e.adsensePageRpm > 0 ? ` Rodando só ele, o grupo nativo renderia ${fmtBrl(r.winner.pageRpm)} por mil páginas (${r.winner.pageRpm >= e.adsensePageRpm ? '+' : '−'}${Math.abs((r.winner.pageRpm / e.adsensePageRpm - 1) * 100).toFixed(0)}% vs AdSense).` : ''}`);
    } else if (leader && leader.pBest > 0) {
      verdict.push(`Líder até agora: <strong>${escapeHtml(leader.label)}</strong>, com ${fmtChance(leader.pBest)} de chance de ser o melhor. Ainda sem vencedor: o sistema declara um quando todos os banners têm ${fmtInt(MIN_IMPS_PER_CREATIVE)}+ impressões e um deles passa de ${Math.round(WIN_PROBABILITY * 100)}% de chance.`);
    }
  }

  const rangeLabel = (k: NativePanelData['range'], label: string) =>
    `<a href="/admin/settings?tab=nativos${k === 'all' ? '' : `&range=${k}`}" class="pill ${d.range === k ? 'is-active' : ''}">${label}</a>`;
  const lift = e.lift;
  const totalPv = r.adsensePv + r.nativePv;
  const kpis = `<section class="kpi-grid kpi-grid--4">
      <div class="kpi-card">
        <div class="kpi-card__head"><span class="kpi-card__label">Páginas · grupo AdSense</span></div>
        <div class="kpi-card__value">${fmtInt(r.adsensePv)}</div>
        <div class="kpi-card__hint">${e.adsenseRevenue !== null ? `≈ ${fmtBrl(e.adsenseRevenue)} estimados` : 'informe o RPM de página'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__head"><span class="kpi-card__label">Páginas · grupo nativo</span></div>
        <div class="kpi-card__value">${fmtInt(r.nativePv)}</div>
        <div class="kpi-card__hint">${totalPv > 0 ? `${fmtPct(r.nativePv / totalPv, 0)} do total (meta: ${cfg.share}%)` : '—'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__head"><span class="kpi-card__label">Cliques nativos · por mil páginas</span></div>
        <div class="kpi-card__value">${fmtInt(r.nativeClicks)} <span class="nv-kpi-sub">${r.nativePv > 0 ? fmtInt(r.clicksPerPv * 1000) + '/mil' : ''}</span></div>
        <div class="kpi-card__hint">${r.nativeImps > 0 ? `CTR por impressão: ${fmtPct(r.nativeCtr)}` : '—'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__head"><span class="kpi-card__label">Receita por mil páginas</span></div>
        <div class="kpi-card__value">${e.nativePageRpm !== null ? fmtBrl(e.nativePageRpm) : '—'}</div>
        <div class="kpi-card__hint">${lift !== null
          ? `<span class="kpi-card__trend kpi-card__trend--${lift > 0.005 ? 'up' : lift < -0.005 ? 'down' : 'flat'}">${lift >= 0 ? '↑ +' : '↓ −'}${Math.abs(lift * 100).toFixed(0)}%</span> vs AdSense ${fmtBrl(e.adsensePageRpm)}`
          : 'informe RPM de página e valor por clique'}</div>
      </div>
    </section>`;

  const resultsCard = `<section class="card">
      <header class="card__header" style="gap:1rem;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <h2 class="card__title">Resultado: grupo nativo × grupo AdSense</h2>
          <p class="card__desc">Receita por mil páginas vistas de cada grupo de leitores. No grupo AdSense entram blocos, âncora e vinheta; no nativo, os cliques nos banners.</p>
        </div>
        <div class="filter-pills">
          ${rangeLabel('all', since ? `Desde ${since}` : 'Tudo')}
          ${rangeLabel('7', '7 dias')}
          ${rangeLabel('1', 'Hoje')}
        </div>
      </header>
      <div class="card__body">
        ${kpis}
        <ul class="nv-verdict">${verdict.map((v) => `<li>${v}</li>`).join('')}</ul>
      </div>
    </section>`;

  // ---------- Ranking de banners ----------
  const statusBadge = (c: MixReport['creatives'][number]) => {
    if (r.winner && r.winner.id === c.id) return '<span class="badge badge--success">Vencedor</span>';
    if (!c.active) return '<span class="badge">Pausado</span>';
    if (c.imps < 100) return '<span class="badge">Coletando</span>';
    if (r.enoughData && c.pBest < 0.01) return '<span class="badge badge--draft">Perdendo</span>';
    return '<span class="badge">No páreo</span>';
  };
  const maxP = Math.max(0.0001, ...r.creatives.map((c) => c.pBest));
  const rankingRows = r.creatives.length === 0
    ? `<tr><td colspan="7" class="empty-state">Nenhum banner importado ainda. Use “Importar banners” abaixo.</td></tr>`
    : r.creatives.map((c) => `
        <tr>
          <td>
            <div class="nv-banner">
              ${c.thumb ? `<img class="nv-thumb" src="${escapeHtml(c.thumb)}" alt="" loading="lazy" decoding="async">` : '<span class="nv-thumb nv-thumb--empty"></span>'}
              <div><strong>${escapeHtml(c.label)}</strong><div class="muted">${escapeHtml(c.alt.replace(/^Publicidade[^:]*:\s*/i, ''))}</div></div>
            </div>
          </td>
          <td class="num">${fmtInt(c.imps)}</td>
          <td class="num">${fmtInt(c.clicks)}</td>
          <td class="num nowrap">${c.imps > 0 ? `${fmtPct(c.ctr)}<div class="muted">${fmtPct(c.ci.low)}–${fmtPct(c.ci.high)}</div>` : '—'}</td>
          <td style="min-width:130px">
            <div class="views-bar"><span class="views-bar__fill" style="width:${(c.pBest / maxP * 100).toFixed(1)}%"></span><strong>${c.imps >= 100 ? fmtChance(c.pBest) : '—'}</strong></div>
          </td>
          <td class="num nowrap">${c.pageRpm !== null && c.pv > 0 ? fmtBrl(c.pageRpm) : '—'}</td>
          <td>${statusBadge(c)}</td>
        </tr>`).join('');
  const rankingCard = `<section class="card">
      <header class="card__header">
        <div>
          <h2 class="card__title">Qual banner ganha</h2>
          <p class="card__desc">No grupo nativo, cada leitor vê sempre o mesmo banner, sorteado entre os ativos. “Chance de ser o melhor” compara o CTR real provável de cada um (entra no ranking a partir de 100 impressões).</p>
        </div>
      </header>
      <div class="nv-table-wrap">
        <table class="data-table">
          <thead><tr><th>Banner</th><th class="num">Impressões</th><th class="num">Cliques</th><th class="num">CTR</th><th>Chance de ser o melhor</th><th class="num">Receita / mil páginas</th><th>Status</th></tr></thead>
          <tbody>${rankingRows}</tbody>
        </table>
      </div>
    </section>`;

  // ---------- Quebras: posição e formato ----------
  const placementRows = r.byPlacement.length === 0
    ? '<tr><td colspan="4" class="empty-state">Sem dados ainda.</td></tr>'
    : r.byPlacement.map((p) => `<tr>
        <td>${escapeHtml(PLACEMENT_LABELS[p.placement as MixPlacement] ?? p.placement)}</td>
        <td class="num">${fmtInt(p.imps)}</td>
        <td class="num">${fmtInt(p.clicks)}</td>
        <td class="num">${p.imps > 0 ? fmtPct(p.ctr) : '—'}</td>
      </tr>`).join('');
  const formatRows = r.byFormat.length === 0
    ? '<tr><td colspan="4" class="empty-state">Sem dados ainda.</td></tr>'
    : r.byFormat.map((f) => `<tr>
        <td>${escapeHtml(f.format === '16x9' ? 'Nativo 16:9' : f.format)}</td>
        <td class="num">${fmtInt(f.imps)}</td>
        <td class="num">${fmtInt(f.clicks)}</td>
        <td class="num">${f.imps > 0 ? fmtPct(f.ctr) : '—'}</td>
      </tr>`).join('');
  const breakdownCard = `<section class="card">
      <header class="card__header"><div><h2 class="card__title">Banners nativos por posição e formato</h2><p class="card__desc">Onde o banner nativo funciona melhor, e em qual tamanho.</p></div></header>
      <div class="nv-split">
        <div class="nv-table-wrap"><table class="data-table">
          <thead><tr><th>Posição</th><th class="num">Impressões</th><th class="num">Cliques</th><th class="num">CTR</th></tr></thead>
          <tbody>${placementRows}</tbody>
        </table></div>
        <div class="nv-table-wrap"><table class="data-table">
          <thead><tr><th>Formato</th><th class="num">Impressões</th><th class="num">Cliques</th><th class="num">CTR</th></tr></thead>
          <tbody>${formatRows}</tbody>
        </table></div>
      </div>
    </section>`;

  // ---------- Configuração ----------
  const formatAvailable = (fmt: SlotFormat) => cfg.creatives.filter((c) => c.active && slotImages(c, fmt).length > 0).length;
  const placementHelp: Partial<Record<MixPlacement, string>> = {
    anchor: 'Substitui a âncora do Google, o formato que mais rende hoje.',
    vignette: 'Tela cheia ao clicar num link do site, no máximo 1 a cada 5 min. Substitui a vinheta do Google.',
    topOfContent: 'Logo abaixo do compartilhar: o melhor bloco manual do AdSense.',
  };
  const placementCfgRows = MIX_PLACEMENTS.map((k) => {
    const pl = cfg.placements[k];
    const avail = formatAvailable(pl.format);
    const warn = pl.on && cfg.creatives.length > 0 && avail === 0
      ? `<small class="nv-warn">Nenhum banner ativo tem esse tamanho: esta posição fica vazia no grupo nativo.</small>` : '';
    const help = placementHelp[k] ? `<small class="nv-place-help">${placementHelp[k]}</small>` : '';
    return `<div class="nv-place-row">
        <label class="check"><input type="checkbox" name="pl.on.${k}" value="1" ${pl.on ? 'checked' : ''}> <span>${escapeHtml(PLACEMENT_LABELS[k])}</span></label>
        <select name="pl.format.${k}" aria-label="Formato do banner em ${escapeHtml(PLACEMENT_LABELS[k])}">
          ${PLACEMENT_FORMATS[k].map((f) => `<option value="${f}" ${pl.format === f ? 'selected' : ''}>${escapeHtml(SLOT_FORMAT_LABELS[f])}</option>`).join('')}
        </select>
        ${help}${warn}
      </div>`;
  }).join('');

  const creativeRows = cfg.creatives.length === 0
    ? '<p class="muted">Nenhum banner ainda. Importe abaixo.</p>'
    : cfg.creatives.map((c) => {
      const thumb = (c.images['16x9'] ?? c.images['300x250'] ?? c.images['320x100'] ?? c.images['728x90'] ?? c.images['320x50'])?.src ?? '';
      const chips = NATIVE_FORMATS.map((f) => `<span class="nv-chip ${c.images[f] ? 'is-on' : ''}" title="${c.images[f] ? 'Tem' : 'Não tem'} ${f}">${f === '16x9' ? '16:9' : f}</span>`).join('');
      return `<div class="nv-creative">
          <label class="check"><input type="checkbox" name="cr.active.${escapeHtml(c.id)}" value="1" ${c.active ? 'checked' : ''} aria-label="Ativar ${escapeHtml(c.label)}"></label>
          ${thumb ? `<img class="nv-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">` : '<span class="nv-thumb nv-thumb--empty"></span>'}
          <div class="nv-creative__text">
            <strong>${escapeHtml(c.label)}</strong>
            <div class="muted">${escapeHtml(c.alt.replace(/^Publicidade[^:]*:\s*/i, ''))}</div>
            <div class="nv-chips">${chips}</div>
          </div>
          <label class="check nv-creative__del"><input type="checkbox" name="cr.remove.${escapeHtml(c.id)}" value="1"> <span>remover</span></label>
          <input type="hidden" name="cr.ids" value="${escapeHtml(c.id)}">
        </div>`;
    }).join('');

  const shareText = (v: number) => `${v}% dos leitores só com nativos · ${100 - v}% com AdSense`;
  const configCard = `<form method="POST" action="/admin/settings/native">
      <section class="card">
        <header class="card__header card__header--icon">
          <span class="card__header-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg></span>
          <div>
            <h2 class="card__title">Configuração do teste</h2>
            <p class="card__desc">Quantos leitores ficam sem AdSense, e onde os banners nativos aparecem para eles.</p>
          </div>
        </header>
        <div class="card__body">
          <div class="placement-card ${cfg.enabled ? 'is-on' : ''}" id="nv-enabled-card">
            <header class="placement-card__header">
              <div class="placement-card__heading">
                <h3>Teste ligado</h3>
                <p>Desligado, o site volta a mostrar só AdSense para todos, com o mesmo HTML de antes.</p>
              </div>
              <label class="toggle">
                <input type="checkbox" name="enabled" value="1" aria-label="Teste ligado" ${cfg.enabled ? 'checked' : ''}>
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </header>
          </div>

          <div class="field">
            <label for="nv-share">Percentual de leitores no grupo nativo</label>
            <div class="nv-share">
              <input type="range" id="nv-share" min="0" max="100" step="5" value="${cfg.share}" oninput="this.form.share.value=this.value;document.getElementById('nv-share-out').textContent=this.value+'% dos leitores só com nativos · '+(100-this.value)+'% com AdSense'">
              <input type="number" name="share" min="0" max="100" step="1" value="${cfg.share}" aria-label="Percentual de leitores no grupo nativo" oninput="var v=Math.max(0,Math.min(100,+this.value||0));document.getElementById('nv-share').value=v;document.getElementById('nv-share-out').textContent=v+'% dos leitores só com nativos · '+(100-v)+'% com AdSense'">
            </div>
            <small class="field__help"><strong id="nv-share-out">${shareText(cfg.share)}</strong>. Cada leitor é sorteado uma vez e fica no mesmo grupo até você zerar o teste. O grupo nativo <strong>não vê AdSense nenhum</strong>, nem âncora ou vinheta do Google. Aumentar o % depois só adiciona leitores novos ao grupo nativo.</small>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="nv-max">Máximo de banners dentro da página (grupo nativo)</label>
              <input type="number" id="nv-max" name="maxPerPage" min="0" max="20" value="${cfg.maxPerPage}">
              <small class="field__help">0 = sem limite. Âncora e vinheta não contam. O que passar do limite fica vazio, nunca AdSense. O AdSense põe 11 por artigo hoje; 4 já cobre topo + 3 no texto.</small>
            </div>
          </div>

          <div class="field">
            <label>Posições e formato do banner (grupo nativo)</label>
            <div class="nv-places">${placementCfgRows}</div>
            <small class="field__help">Posição desmarcada fica sem anúncio para o grupo nativo. As posições do meio da página só existem onde a aba AdSense tem o bloco ligado; âncora e vinheta aparecem sempre. “Faixa” mostra 728x90 no computador e 320x100 no celular.</small>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="nv-rpm">RPM de página do AdSense (R$ por mil páginas)</label>
              <input type="number" id="nv-rpm" name="adsensePageRpm" min="0" step="0.01" value="${cfg.adsensePageRpm || ''}" placeholder="ex.: 11,00" inputmode="decimal">
              <small class="field__help">AdSense → Relatórios → “RPM da página”, do total (blocos + âncora + vinheta), convertido para reais.</small>
            </div>
            <div class="field">
              <label for="nv-vpc">Valor de um clique no banner (R$)</label>
              <input type="number" id="nv-vpc" name="valuePerClick" min="0" step="0.01" value="${cfg.valuePerClick || ''}" placeholder="deixe vazio se não souber" inputmode="decimal">
              <small class="field__help">Comissão de afiliado ÷ cliques no banner. Meça com uma tag de afiliado só para o tráfego <code>utm_source=capitulodehoje</code>. Vazio: o painel mostra o valor de empate.</small>
            </div>
          </div>

          <div class="field">
            <label>Banners no teste</label>
            <div class="nv-creatives">${creativeRows}</div>
            <small class="field__help">Desmarque para pausar um banner que está perdendo. Os dados dele continuam no ranking.</small>
          </div>
        </div>
      </section>
      <div class="sticky-actions">
        <button type="submit" class="btn btn--primary btn--lg">Salvar teste</button>
      </div>
    </form>`;

  // ---------- Importar ----------
  const importCard = `<section class="card">
      <header class="card__header card__header--icon">
        <span class="card__header-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span>
        <div>
          <h2 class="card__title">Importar banners</h2>
          <p class="card__desc">Lê uma página de banners (como a da Toda Fase) ou os códigos <code>&lt;a&gt;&lt;img&gt;&lt;/a&gt;</code> colados, e copia as imagens para o R2 do site (carregam rápido e não dependem do outro site).</p>
        </div>
      </header>
      <div class="card__body">
        <form method="POST" action="/admin/settings/native/import">
          <div class="field">
            <label for="nv-url">URL da página de banners</label>
            <input type="url" id="nv-url" name="url" value="${escapeHtml(cfg.sourceUrl)}" placeholder="https://todafase.com/banners">
          </div>
          <div class="field">
            <label for="nv-snippets">…ou cole os códigos dos banners</label>
            <textarea id="nv-snippets" name="snippets" rows="4" placeholder='&lt;a href="https://…"&gt;&lt;img src="https://…/banner-300x250.jpg" width="300" height="250" alt="…"&gt;&lt;/a&gt;'></textarea>
            <small class="field__help">Tamanhos aceitos: 300x250, 320x100, 728x90, 320x50 e 16:9 (ex.: 1200x675). Banners com o mesmo nome de arquivo viram um só criativo. Reimportar atualiza sem apagar nada.</small>
          </div>
          <button type="submit" class="btn btn--ghost">Importar banners</button>
        </form>
      </div>
    </section>`;

  const resetCard = `<section class="card">
      <header class="card__header">
        <div>
          <h2 class="card__title">Começar um teste novo</h2>
          <p class="card__desc">Zera a contagem, por exemplo depois de trocar os banners. Os visitantes são sorteados de novo. Os números antigos não são apagados, só saem do resultado.</p>
        </div>
      </header>
      <div class="card__body">
        <form method="POST" action="/admin/settings/native/reset" onsubmit="return confirm('Começar um teste novo? O resultado atual deixa de aparecer aqui.')">
          <button type="submit" class="btn btn--danger">Zerar contagem e começar teste novo</button>
        </form>
      </div>
    </section>`;

  return `
    ${flashes.join('')}
    ${statusStrip}
    ${resultsCard}
    ${rankingCard}
    ${breakdownCard}
    ${configCard}
    ${importCard}
    ${resetCard}
    <script>
      (function(){
        var card = document.getElementById('nv-enabled-card');
        var cb = card && card.querySelector('input[type="checkbox"]');
        if (cb) cb.addEventListener('change', function(){ card.classList.toggle('is-on', cb.checked); });
      })();
    </script>`;
}

// ====== Admin: Configurações ======
export function renderAdminConfiguracoes(
  env: Env, request: Request,
  data: {
    typography: { titleScale: 'sm' | 'md' | 'lg' | 'xl'; bodyScale: 'sm' | 'md' | 'lg' };
    googleAnalyticsId?: string;
    defaultAuthor?: { name: string; bio: string; avatar: string };
    cookieBanner: boolean;
    tab?: string;
    saved?: boolean;
    error?: string;
  },
): string {
  void request;
  const validTabs = ['tipografia', 'autor', 'tracking', 'cookies'] as const;
  const activeTab = validTabs.includes(data.tab as any) ? data.tab as string : 'tipografia';
  const author = data.defaultAuthor ?? { name: '', bio: '', avatar: '' };
  const cookieIcon = (size: number) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${size > 16 ? 1.75 : 2}" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 14v.01"/></svg>`;
  // Atributos ARIA/estado de cada aba e painel (padrão WAI-ARIA Tabs, tabindex "roving").
  const tabAttrs = (id: string) => `id="cfg-tab-${id}" data-tab="${id}" aria-controls="cfg-panel-${id}" aria-selected="${activeTab === id}" tabindex="${activeTab === id ? 0 : -1}"`;
  const panelAttrs = (id: string) => `id="cfg-panel-${id}" data-panel="${id}" role="tabpanel" aria-labelledby="cfg-tab-${id}"`;
  const gaId = (data.googleAnalyticsId ?? '').trim();
  const gaValid = isValidGaMeasurementId(gaId);

  return adminShell(env, {
    active: 'configuracoes',
    title: 'Configurações',
    subtitle: 'Aparência do site, tracking e cookies',
  }, `
    ${data.saved ? `<div class="alert alert--success"><span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span><div><strong>Configurações salvas.</strong> O cache do site foi limpo automaticamente.</div></div>` : ''}
    ${data.error ? `<div class="alert alert--error" role="alert"><span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span><div><strong>Não foi possível salvar.</strong> ${escapeHtml(data.error)}</div></div>` : ''}

    <nav class="cfg-tabs" role="tablist" aria-label="Seções de configurações">
      <button type="button" role="tab" class="cfg-tabs__tab ${activeTab === 'tipografia' ? 'is-active' : ''}" ${tabAttrs('tipografia')}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
        Tipografia
      </button>
      <button type="button" role="tab" class="cfg-tabs__tab ${activeTab === 'autor' ? 'is-active' : ''}" ${tabAttrs('autor')}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Autor
      </button>
      <button type="button" role="tab" class="cfg-tabs__tab ${activeTab === 'tracking' ? 'is-active' : ''}" ${tabAttrs('tracking')}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>
        Tracking
      </button>
      <button type="button" role="tab" class="cfg-tabs__tab ${activeTab === 'cookies' ? 'is-active' : ''}" ${tabAttrs('cookies')}>
        ${cookieIcon(16)}
        Cookies
      </button>
    </nav>

    <form method="POST" action="/admin/configuracoes">
      <input type="hidden" name="_tab" id="cfg-tab-input" value="${activeTab}">

      <!-- Tab: Tipografia -->
      <div class="cfg-panel ${activeTab === 'tipografia' ? 'is-active' : ''}" ${panelAttrs('tipografia')}>
        <section class="card">
          <header class="card__header card__header--icon">
            <span class="card__header-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
            </span>
            <div>
              <h2 class="card__title">Tipografia do site</h2>
              <p class="card__desc">Ajuste o tamanho dos títulos e do texto dos posts. Afeta apenas o blog público, não o admin.</p>
            </div>
          </header>
          <div class="card__body">
            <div class="field-row">
              <div class="field">
                <label>Tamanho dos títulos</label>
                <div class="seg-control" id="seg-title">
                  ${(['sm', 'md', 'lg', 'xl'] as const).map((s) => `
                    <label class="seg-control__opt ${data.typography.titleScale === s ? 'is-active' : ''}">
                      <input type="radio" name="typography.title_scale" value="${s}" ${data.typography.titleScale === s ? 'checked' : ''}>
                      <span>${ {sm: 'Pequeno', md: 'Médio', lg: 'Grande', xl: 'Extra'}[s] }</span>
                    </label>`).join('')}
                </div>
                <small class="field__help">Controla o tamanho dos H1/H2/H3 nos posts.</small>
              </div>
              <div class="field">
                <label>Tamanho do texto</label>
                <div class="seg-control" id="seg-body">
                  ${(['sm', 'md', 'lg'] as const).map((s) => `
                    <label class="seg-control__opt ${data.typography.bodyScale === s ? 'is-active' : ''}">
                      <input type="radio" name="typography.body_scale" value="${s}" ${data.typography.bodyScale === s ? 'checked' : ''}>
                      <span>${ {sm: 'Compacto', md: 'Padrão', lg: 'Confortável'}[s] }</span>
                    </label>`).join('')}
                </div>
                <small class="field__help">Tamanho do corpo dos parágrafos.</small>
              </div>
            </div>
            <div class="type-preview" id="type-preview" data-title-scale="${data.typography.titleScale}" data-body-scale="${data.typography.bodyScale}">
              <div class="type-preview__label">Pré-visualização</div>
              <h1 class="type-preview__h1">Título de exemplo</h1>
              <p class="type-preview__p">Este é um parágrafo de exemplo do corpo do texto. Use essas configurações para encontrar o tamanho mais confortável para os leitores do seu blog.</p>
            </div>
          </div>
        </section>
      </div>

      <!-- Tab: Autor padrão -->
      <div class="cfg-panel ${activeTab === 'autor' ? 'is-active' : ''}" ${panelAttrs('autor')}>
        <section class="card">
          <header class="card__header card__header--icon">
            <span class="card__header-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            <div>
              <h2 class="card__title">Autor padrão do site</h2>
              <p class="card__desc">Usado como assinatura e box de autor em todos os artigos que não tenham um redator próprio cadastrado. Deixe o nome em branco para desativar.</p>
            </div>
          </header>
          <div class="card__body">
            <div class="field">
              <label for="author_name">Nome do autor</label>
              <input type="text" id="author_name" name="author.default_name" value="${escapeHtml(author.name)}" placeholder="Ex: Redação Capítulo de Hoje" class="input" maxlength="80" autocomplete="off">
            </div>
            <div class="field">
              <label>Foto de perfil</label>
              ${renderAvatarField('author.default_avatar', author.avatar, 'author')}
            </div>
            <div class="field">
              <label for="author_bio">Mini-bio</label>
              <textarea id="author_bio" name="author.default_bio" rows="3" class="input" maxlength="400" placeholder="Ex: A redação do Capítulo de Hoje acompanha de perto os principais folhetins da TV brasileira.">${escapeHtml(author.bio)}</textarea>
              <small class="field__help">Aparece no box de autor logo após o conteúdo dos posts.</small>
            </div>
            ${author.name.trim() ? `<div class="author-box-preview" style="margin-top:1rem">
              ${renderAuthorBox({ name: author.name, bio: author.bio || null, avatar_url: author.avatar || null })}
            </div>` : ''}
          </div>
        </section>
      </div>

      <!-- Tab: Tracking -->
      <div class="cfg-panel ${activeTab === 'tracking' ? 'is-active' : ''}" ${panelAttrs('tracking')}>
        <section class="card">
          <header class="card__header card__header--icon">
            <span class="card__header-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>
            </span>
            <div>
              <h2 class="card__title">Google Analytics</h2>
              <p class="card__desc">Insira seu Measurement ID para ativar o rastreamento do Google Analytics no blog.</p>
            </div>
          </header>
          <div class="card__body">
            ${data.error ? '' : `<p class="cfg-status ${gaId ? (gaValid ? 'is-on' : 'is-warn') : 'is-off'}">
              <span class="cfg-status__dot" aria-hidden="true"></span>
              <span>${gaId
                ? (gaValid
                  ? `Google Analytics <strong>ativo</strong> no blog.`
                  : `O ID salvo não está no formato <code>G-XXXXXXXXXX</code>: o GA <strong>não</strong> está sendo carregado. Corrija abaixo.`)
                : 'Google Analytics <strong>desativado</strong>: nenhum ID salvo.'}</span>
            </p>`}
            <div class="field">
              <label for="google_analytics_id">Measurement ID</label>
              <input type="text" id="google_analytics_id" name="google_analytics_id"
                value="${escapeHtml(gaId)}"
                placeholder="G-XXXXXXXXXX"
                pattern="[Gg]-[A-Za-z0-9]{6,}" title="Formato: G-XXXXXXXXXX"
                class="input" autocomplete="off" spellcheck="false" autocapitalize="characters">
              <small class="field__help">Encontre seu ID em <a href="https://analytics.google.com/" target="_blank" rel="noopener">Google Analytics</a> &gt; Admin &gt; Data Streams. Formato: <code>G-XXXXXXXXXX</code>. Deixar o campo vazio <strong>não</strong> remove o ID salvo.</small>
            </div>
            ${gaId && !data.error ? `<label class="check cfg-clear-check">
              <input type="checkbox" name="google_analytics_id.clear" value="1" id="ga-clear">
              <span>Desativar o Google Analytics (remove o ID ao salvar)</span>
            </label>` : ''}
          </div>
        </section>
      </div>

      <!-- Tab: Cookies -->
      <div class="cfg-panel ${activeTab === 'cookies' ? 'is-active' : ''}" ${panelAttrs('cookies')}>
        <section class="card">
          <header class="card__header card__header--icon">
            <span class="card__header-icon">${cookieIcon(20)}</span>
            <div>
              <h2 class="card__title">Aviso de cookies</h2>
              <p class="card__desc">Barra “Usamos cookies. Privacidade” que aparece no rodapé das páginas públicas até o visitante clicar em Aceitar.</p>
            </div>
          </header>
          <div class="card__body">
            <div class="placement-card ${data.cookieBanner ? 'is-on' : ''}" id="cookie-banner-card">
              <header class="placement-card__header">
                <span class="placement-card__icon">${cookieIcon(20)}</span>
                <div class="placement-card__heading">
                  <h3>Exibir aviso de cookies</h3>
                  <p>Desligado, o aviso deixa de aparecer em todas as páginas do site.</p>
                </div>
                <label class="toggle">
                  <input type="checkbox" name="cookie_banner.enabled" value="1" aria-label="Exibir aviso de cookies" ${data.cookieBanner ? 'checked' : ''}>
                  <span class="toggle__track"><span class="toggle__thumb"></span></span>
                </label>
              </header>
              <div class="placement-card__body">
                <div class="type-preview__label">Pré-visualização</div>
                <div aria-hidden="true" style="display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:440px;background:#1a1a2e;color:#d4d4d8;padding:8px 10px 8px 16px;border-radius:10px;font-size:0.75rem;line-height:1.4;box-shadow:0 4px 24px rgba(0,0,0,0.2)">
                  <span>Usamos cookies. <span style="color:#93b5ff;text-decoration:underline">Privacidade</span></span>
                  <span style="background:rgba(79,127,255,0.15);color:#93b5ff;padding:6px 14px;border-radius:6px;font-size:0.6875rem;font-weight:600;white-space:nowrap;text-transform:uppercase;letter-spacing:0.04em">Aceitar</span>
                </div>
              </div>
            </div>
            <small class="field__help" style="display:block;margin-top:12px">Anúncios e Google Analytics não são afetados: o consentimento já é concedido por padrão (LGPD), com ou sem o aviso.</small>
          </div>
        </section>
      </div>

      <div class="sticky-actions">
        <button type="submit" class="btn btn--primary btn--lg">Salvar configurações</button>
      </div>
    </form>

    <script>
    (() => {
      const tabs = Array.from(document.querySelectorAll('.cfg-tabs__tab'));
      const panels = document.querySelectorAll('.cfg-panel');
      const tabInput = document.getElementById('cfg-tab-input');

      function activateTab(target, focus) {
        tabs.forEach(t => {
          const on = t.getAttribute('data-tab') === target;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1;
          if (on && focus) t.focus();
        });
        panels.forEach(p => p.classList.toggle('is-active', p.getAttribute('data-panel') === target));
        if (tabInput) tabInput.value = target;
        history.replaceState(null, '', '?tab=' + target);
      }

      tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => activateTab(tab.getAttribute('data-tab'), false));
        // Teclado (WAI-ARIA Tabs): ←/→ alternam, Home/End vão às pontas.
        tab.addEventListener('keydown', (e) => {
          const last = tabs.length - 1;
          const next = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
            : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1)
            : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
          if (next < 0) return;
          e.preventDefault();
          activateTab(tabs[next].getAttribute('data-tab'), true);
        });
      });

      const cookieCard = document.getElementById('cookie-banner-card');
      cookieCard?.querySelector('input[type="checkbox"]')?.addEventListener('change', (e) => {
        cookieCard.classList.toggle('is-on', e.target.checked);
      });

      // Campo inválido numa aba escondida: o navegador bloqueia o envio sem mostrar
      // nada. Abre a aba do campo para a mensagem de validação aparecer.
      const cfgForm = tabInput && tabInput.form;
      if (cfgForm) cfgForm.addEventListener('invalid', (e) => {
        const panel = e.target.closest && e.target.closest('.cfg-panel');
        if (panel && !panel.classList.contains('is-active')) activateTab(panel.getAttribute('data-panel'), false);
      }, true);

      // "Desativar o GA": trava o campo para ficar claro que o ID será removido.
      const gaClear = document.getElementById('ga-clear');
      const gaInput = document.getElementById('google_analytics_id');
      if (gaClear && gaInput) gaClear.addEventListener('change', () => { gaInput.disabled = gaClear.checked; });

      const TITLE_SIZES = { sm: '22px', md: '28px', lg: '34px', xl: '42px' };
      const BODY_SIZES  = { sm: '14px', md: '16px', lg: '18px' };
      const preview = document.getElementById('type-preview');
      const h1 = preview?.querySelector('.type-preview__h1');
      const p  = preview?.querySelector('.type-preview__p');

      function activateSegment(container) {
        container.querySelectorAll('.seg-control__opt').forEach(opt => {
          const radio = opt.querySelector('input[type="radio"]');
          opt.classList.toggle('is-active', radio?.checked);
        });
      }

      document.querySelectorAll('.seg-control').forEach(seg => {
        seg.addEventListener('change', (e) => {
          activateSegment(seg);
          const input = e.target;
          if (input.name === 'typography.title_scale' && h1) {
            h1.style.fontSize = TITLE_SIZES[input.value] || '28px';
          }
          if (input.name === 'typography.body_scale' && p) {
            p.style.fontSize = BODY_SIZES[input.value] || '16px';
          }
        });
      });
    })();
    </script>
    ${avatarCropperAssets()}
  `);
}

// ====== Admin: Analytics ======
export function renderAdminAnalytics(
  env: Env, request: Request,
  data: {
    totals: { last24h: number; last7d: number; last30d: number };
    top48h: Array<{ path: string; views: number; title?: string }>;
    top30d: Array<{ path: string; views: number; title?: string }>;
    daily: Array<{ day: string; views: number }>;
    prevDaily?: Array<{ day: string; views: number }>;
    hourly?: Array<{ hour: number; views: number }>;
    period?: number;
    googleAnalyticsId?: string;
    todayVsYesterday?: {
      todayViews: number;
      yesterdayViews: number;
      todayTop: Array<{ path: string; views: number; title?: string }>;
      yesterdayTop: Array<{ path: string; views: number; title?: string }>;
      todayByHour: Array<{ hour: number; views: number }>;
      yesterdayByHour: Array<{ hour: number; views: number }>;
      currentHour: number;
    };
    activeVisitors?: number;
  },
): string {
  void request;
  const period = data.period ?? 30;

  const avg7 = data.totals.last7d / 7;
  const avg30 = data.totals.last30d / 30;
  const trend24h = calcTrend(data.totals.last24h, avg7);
  const trend7d = calcTrend(avg7, avg30);

  const currentTotal = data.daily.reduce((s, d) => s + d.views, 0);
  const prevTotal = (data.prevDaily ?? []).reduce((s, d) => s + d.views, 0);
  const periodTrend = calcTrend(currentTotal, prevTotal);

  // SVG area chart
  const chartSvg = buildAreaChart(data.daily, data.prevDaily ?? []);

  // Heatmap
  const hourlyMap = new Map((data.hourly ?? []).map((h) => [h.hour, h.views]));
  const maxHourly = Math.max(1, ...(data.hourly ?? []).map((h) => h.views));
  const heatmapCells = Array.from({ length: 24 }, (_, h) => {
    const v = hourlyMap.get(h) ?? 0;
    const intensity = v / maxHourly;
    const level = intensity === 0 ? 0 : intensity < 0.25 ? 1 : intensity < 0.5 ? 2 : intensity < 0.75 ? 3 : 4;
    return `<div class="heatmap__cell heatmap__cell--${level}" title="${String(h).padStart(2,'0')}:00 — ${v.toLocaleString('pt-BR')} views">
      <span class="heatmap__hour">${String(h).padStart(2,'0')}</span>
    </div>`;
  }).join('');

  const peakHour = (data.hourly ?? []).reduce((best, h) => h.views > (best?.views ?? 0) ? h : best, { hour: 0, views: 0 });

  const topRows = (list: Array<{ path: string; views: number; title?: string }>, maxView: number) =>
    list.length === 0
      ? `<tr><td colspan="3" class="empty-state">Sem dados ainda.</td></tr>`
      : list.map((r, i) => `
        <tr>
          <td style="width:32px"><span class="rank">${i + 1}</span></td>
          <td class="path">
            <a href="${escapeHtml(r.path)}" target="_blank" rel="noopener" class="path-title">${escapeHtml(r.title ?? r.path)}</a>
            <div class="muted">${escapeHtml(r.path)}</div>
          </td>
          <td>
            <div class="views-bar">
              <span class="views-bar__fill" style="width:${(r.views / Math.max(1, maxView) * 100).toFixed(1)}%"></span>
              <strong>${r.views.toLocaleString('pt-BR')}</strong>
            </div>
          </td>
        </tr>`).join('');

  const max48 = Math.max(1, ...data.top48h.map((p) => p.views));
  const max30d = Math.max(1, ...data.top30d.map((p) => p.views));

  const iEye = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const iCalDay = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/></svg>';
  const iCalMo  = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
  const iTrend  = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>';
  const iFire   = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>';
  const iClock  = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

  const periodLabels: Record<number, string> = { 1: 'Hoje', 7: '7 dias', 14: '14 dias', 30: '30 dias', 90: '90 dias' };

  // ---- Today vs Yesterday section (only when period=1) ----
  const tvy = data.todayVsYesterday;
  let todayVsYesterdayHtml = '';
  if (tvy && period === 1) {
    const diff = tvy.todayViews - tvy.yesterdayViews;
    const diffPct = tvy.yesterdayViews > 0
      ? ((diff / tvy.yesterdayViews) * 100)
      : (tvy.todayViews > 0 ? 100 : 0);
    const diffDir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const diffSign = diff > 0 ? '+' : '';
    const diffColor = diffDir === 'up' ? '#16a34a' : diffDir === 'down' ? '#dc2626' : 'var(--adm-text-muted)';
    const diffArrow = diffDir === 'up' ? '↑' : diffDir === 'down' ? '↓' : '→';
    // Format percentage nicely — cap display at 999%
    const pctDisplay = Math.abs(diffPct) > 999
      ? `${diffSign}${Math.abs(diffPct) >= 10000 ? (Math.abs(diffPct) / 1000).toFixed(0) + 'k' : Math.abs(diffPct).toFixed(0)}%`
      : `${diffSign}${Math.abs(diffPct).toFixed(1)}%`;

    // currentHour já vem em BRT do banco
    const hourLabel = `${String(tvy.currentHour).padStart(2, '0')}:00`;

    // Mini sparkline: today (solid) vs yesterday (dashed) by hour
    const maxH = Math.max(1, ...tvy.todayByHour.map((h) => h.views), ...tvy.yesterdayByHour.map((h) => h.views));
    const sparkW = 280;
    const sparkH = 48;
    const todayMap = new Map(tvy.todayByHour.map((h) => [h.hour, h.views]));
    const yesterdayMap = new Map(tvy.yesterdayByHour.map((h) => [h.hour, h.views]));
    const hours = tvy.currentHour + 1;
    const toPoints = (map: Map<number, number>) =>
      Array.from({ length: hours }, (_, i) => {
        const x = hours > 1 ? (i / (hours - 1)) * sparkW : sparkW / 2;
        const y = sparkH - ((map.get(i) ?? 0) / maxH) * (sparkH - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
    const todayLine = toPoints(todayMap);
    const yesterdayLine = toPoints(yesterdayMap);

    const sparkSvg = `<svg viewBox="0 0 ${sparkW} ${sparkH}" width="100%" height="${sparkH}" preserveAspectRatio="none" class="tvy-spark">
      <polyline points="${yesterdayLine}" fill="none" stroke="var(--adm-border)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>
      <polyline points="${todayLine}" fill="none" stroke="var(--adm-accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    </svg>`;

    // Top pages comparison
    const topCompare = (todayList: Array<{ path: string; views: number; title?: string }>, yesterdayList: Array<{ path: string; views: number; title?: string }>) => {
      const yMap = new Map(yesterdayList.map((r) => [r.path, r.views]));
      return todayList.slice(0, 5).map((r, i) => {
        const yViews = yMap.get(r.path) ?? 0;
        const pageDiff = r.views - yViews;
        const pageDiffDir = pageDiff > 0 ? 'up' : pageDiff < 0 ? 'down' : 'flat';
        const pageDiffColor = pageDiffDir === 'up' ? '#16a34a' : pageDiffDir === 'down' ? '#dc2626' : 'var(--adm-text-muted)';
        const pageDiffArrow = pageDiffDir === 'up' ? '↑' : pageDiffDir === 'down' ? '↓' : '→';
        const pageDiffSign = pageDiff > 0 ? '+' : '';
        return `<tr>
          <td style="width:24px;color:var(--adm-text-muted);font-size:12px">${i + 1}</td>
          <td class="path"><span class="path-title" style="font-size:13px">${escapeHtml(r.title ?? r.path)}</span></td>
          <td style="text-align:right;white-space:nowrap">
            <strong>${r.views.toLocaleString('pt-BR')}</strong>
            <span style="color:${pageDiffColor};font-size:12px;margin-left:4px" title="Ontem: ${yViews}">${pageDiffArrow}${pageDiffSign}${pageDiff.toLocaleString('pt-BR')}</span>
          </td>
        </tr>`;
      }).join('');
    };

    todayVsYesterdayHtml = `
    <section class="card tvy-card">
      <header class="card__header card__header--icon">
        <span class="card__header-icon" style="background:#f0fdf4;color:#16a34a">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </span>
        <div>
          <h2 class="card__title">Hoje vs Ontem</h2>
          <p class="card__desc">Comparativo até ${hourLabel} (BRT) — mesmo período do dia</p>
        </div>
      </header>
      <div class="card__body">
        <div class="tvy-grid">
          <div class="tvy-main">
            <div class="tvy-numbers">
              <div class="tvy-metric">
                <span class="tvy-metric__label">Hoje</span>
                <span class="tvy-metric__value">${tvy.todayViews.toLocaleString('pt-BR')}</span>
              </div>
              <div class="tvy-metric tvy-metric--muted">
                <span class="tvy-metric__label">Ontem</span>
                <span class="tvy-metric__value">${tvy.yesterdayViews.toLocaleString('pt-BR')}</span>
              </div>
              <div class="tvy-diff" style="color:${diffColor}">
                <span class="tvy-diff__arrow">${diffArrow}</span>
                <span class="tvy-diff__value">${diffSign}${diff.toLocaleString('pt-BR')}</span>
                <span class="tvy-diff__pct">(${pctDisplay})</span>
              </div>
            </div>
            <div class="tvy-chart">
              ${sparkSvg}
              <div class="tvy-chart__legend">
                <span class="tvy-chart__legend-item"><span class="tvy-legend-line tvy-legend-line--today"></span>Hoje</span>
                <span class="tvy-chart__legend-item"><span class="tvy-legend-line tvy-legend-line--yesterday"></span>Ontem</span>
              </div>
            </div>
          </div>
          <div class="tvy-top">
            <h3 class="tvy-top__title">Top páginas hoje</h3>
            <table class="tvy-top__table">
              <tbody>${topCompare(tvy.todayTop, tvy.yesterdayTop)}</tbody>
            </table>
            ${tvy.todayTop.length === 0 ? '<p style="color:var(--adm-text-muted);font-size:13px;text-align:center;padding:12px 0">Sem dados ainda hoje.</p>' : ''}
          </div>
        </div>
      </div>
    </section>`;
  }

  const liveCount = data.activeVisitors ?? 0;

  return adminShell(env, {
    active: 'analytics',
    title: 'Analytics',
    subtitle: 'Visualizações, páginas populares e tendências',
  }, `
    <div class="ana-toolbar">
      <div class="ana-period-filter">
        ${[1, 7, 14, 30, 90].map((d) => `<a href="/admin/analytics?days=${d}" class="ana-period-btn ${period === d ? 'is-active' : ''}">${periodLabels[d]}</a>`).join('')}
      </div>
      <div class="ana-toolbar__right">
        <div class="ana-live-badge" id="ana-live-badge">
          <span class="live-dot"></span>
          <strong id="ana-live-count">${liveCount}</strong> ao vivo
        </div>
        ${data.googleAnalyticsId ? `<span class="ana-ga-badge" title="Google Analytics ativo"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> GA ativo</span>` : ''}
      </div>
    </div>

    ${todayVsYesterdayHtml}

    <section class="kpi-grid kpi-grid--4">
      <div class="kpi-card">
        <div class="kpi-card__head">
          <span class="kpi-card__label">Últimas 24h</span>
          <span class="kpi-card__icon">${iEye}</span>
        </div>
        <div class="kpi-card__value">${data.totals.last24h.toLocaleString('pt-BR')}</div>
        <div class="kpi-card__hint">
          <span class="kpi-card__trend kpi-card__trend--${trend24h.dir}">
            ${trend24h.dir === 'up' ? '↑' : trend24h.dir === 'down' ? '↓' : '→'} ${trend24h.label}
          </span>
          vs média 7d
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__head">
          <span class="kpi-card__label">Últimos 7 dias</span>
          <span class="kpi-card__icon kpi-card__icon--success">${iCalDay}</span>
        </div>
        <div class="kpi-card__value">${data.totals.last7d.toLocaleString('pt-BR')}</div>
        <div class="kpi-card__hint">
          <span class="kpi-card__trend kpi-card__trend--${trend7d.dir}">
            ${trend7d.dir === 'up' ? '↑' : trend7d.dir === 'down' ? '↓' : '→'} ${trend7d.label}
          </span>
          vs média 30d
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__head">
          <span class="kpi-card__label">Período (${periodLabels[period] ?? period + 'd'})</span>
          <span class="kpi-card__icon">${iCalMo}</span>
        </div>
        <div class="kpi-card__value">${currentTotal.toLocaleString('pt-BR')}</div>
        <div class="kpi-card__hint">
          <span class="kpi-card__trend kpi-card__trend--${periodTrend.dir}">
            ${periodTrend.dir === 'up' ? '↑' : periodTrend.dir === 'down' ? '↓' : '→'} ${periodTrend.label}
          </span>
          vs período anterior
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__head">
          <span class="kpi-card__label">Horário de pico</span>
          <span class="kpi-card__icon kpi-card__icon--warning">${iTrend}</span>
        </div>
        <div class="kpi-card__value">${String(peakHour.hour).padStart(2, '0')}:00</div>
        <div class="kpi-card__hint">${peakHour.views.toLocaleString('pt-BR')} views nesse horário</div>
      </div>
    </section>

    ${period > 1 ? `<section class="card">
      <header class="card__header card__header--icon">
        <span class="card__header-icon">${iTrend}</span>
        <div>
          <h2 class="card__title">Visualizações por dia</h2>
          <p class="card__desc">Últimos ${periodLabels[period] ?? period + ' dias'} — linha cinza = período anterior</p>
        </div>
      </header>
      <div class="card__body ana-chart-wrap">${chartSvg}</div>
    </section>` : ''}

    <section class="card">
      <header class="card__header card__header--icon">
        <span class="card__header-icon">${iClock}</span>
        <div>
          <h2 class="card__title">Horários mais visitados</h2>
          <p class="card__desc">Distribuição por hora do dia (BRT) — ${period === 1 ? 'Hoje' : 'últimos ' + (periodLabels[period] ?? period + ' dias')}</p>
        </div>
      </header>
      <div class="card__body">
        <div class="heatmap">${heatmapCells}</div>
        <div class="heatmap__legend">
          <span class="heatmap__legend-label">Menos</span>
          <span class="heatmap__cell heatmap__cell--0 heatmap__cell--sm"></span>
          <span class="heatmap__cell heatmap__cell--1 heatmap__cell--sm"></span>
          <span class="heatmap__cell heatmap__cell--2 heatmap__cell--sm"></span>
          <span class="heatmap__cell heatmap__cell--3 heatmap__cell--sm"></span>
          <span class="heatmap__cell heatmap__cell--4 heatmap__cell--sm"></span>
          <span class="heatmap__legend-label">Mais</span>
        </div>
      </div>
    </section>

    <div class="ana-tables-grid">
      <section class="card">
        <header class="card__header card__header--icon">
          <span class="card__header-icon">${iFire}</span>
          <div>
            <h2 class="card__title">Em alta</h2>
            <p class="card__desc">Últimas 48 horas</p>
          </div>
        </header>
        <table class="data-table data-table--ranked">
          <thead><tr><th>#</th><th>Página</th><th>Visualizações</th></tr></thead>
          <tbody>${topRows(data.top48h, max48)}</tbody>
        </table>
      </section>

      <section class="card">
        <header class="card__header card__header--icon">
          <span class="card__header-icon">${iCalMo}</span>
          <div>
            <h2 class="card__title">Top do mês</h2>
            <p class="card__desc">Últimos 30 dias</p>
          </div>
        </header>
        <table class="data-table data-table--ranked">
          <thead><tr><th>#</th><th>Página</th><th>Visualizações</th></tr></thead>
          <tbody>${topRows(data.top30d, max30d)}</tbody>
        </table>
      </section>
    </div>

    <script>
    (function(){
      var el = document.getElementById('ana-live-count');
      if (!el) return;
      setInterval(function(){
        fetch('/api/active-visitors', { credentials: 'same-origin' })
          .then(function(r){ return r.json(); })
          .then(function(d){ if (typeof d.active === 'number') el.textContent = d.active; })
          .catch(function(){});
      }, 15000);
    })();
    </script>
  `);
}

function calcTrend(current: number, previous: number): { label: string; dir: 'up' | 'down' | 'flat' } {
  if (previous === 0 && current === 0) return { label: 'estável', dir: 'flat' };
  if (previous === 0) return { label: '+100%', dir: 'up' };
  const diff = (current - previous) / previous;
  if (Math.abs(diff) < 0.01) return { label: 'estável', dir: 'flat' };
  return diff > 0
    ? { label: `+${pct(diff)}`, dir: 'up' }
    : { label: `-${pct(Math.abs(diff))}`, dir: 'down' };
}

function buildAreaChart(
  daily: Array<{ day: string; views: number }>,
  prevDaily: Array<{ day: string; views: number }>,
): string {
  if (daily.length === 0) {
    return `<div class="chart-empty">
      <span class="chart-empty__icon"><svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg></span>
      <p>Sem dados ainda</p>
      <small>As visitas aparecem aqui em poucos minutos.</small>
    </div>`;
  }

  const W = 800;
  const H = 220;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const allMax = Math.max(1, ...daily.map((d) => d.views), ...prevDaily.map((d) => d.views));
  const gridLines = 4;

  const toX = (i: number, len: number) => padL + (i / Math.max(1, len - 1)) * chartW;
  const toY = (v: number) => padT + chartH - (v / allMax) * chartH;

  const linePath = (arr: Array<{ views: number }>) =>
    arr.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i, arr.length).toFixed(1)},${toY(d.views).toFixed(1)}`).join(' ');

  const areaPath = (arr: Array<{ views: number }>) => {
    const line = linePath(arr);
    return `${line} L${toX(arr.length - 1, arr.length).toFixed(1)},${(padT + chartH).toFixed(1)} L${padL},${(padT + chartH).toFixed(1)} Z`;
  };

  const gridSvg = Array.from({ length: gridLines + 1 }, (_, i) => {
    const v = Math.round((allMax / gridLines) * (gridLines - i));
    const y = toY(v);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--adm-border)" stroke-width="1" stroke-dasharray="${i === gridLines ? '0' : '4 3'}"/>
      <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--adm-text-muted)" font-size="11" font-family="var(--adm-mono)">${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}</text>`;
  }).join('');

  const labelStep = Math.max(1, Math.ceil(daily.length / 8));
  const xLabels = daily.map((d, i) => {
    if (i % labelStep !== 0 && i !== daily.length - 1) return '';
    const x = toX(i, daily.length);
    return `<text x="${x.toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle" fill="var(--adm-text-muted)" font-size="11">${d.day.slice(5)}</text>`;
  }).join('');

  const dots = daily.map((d, i) => {
    const x = toX(i, daily.length);
    const y = toY(d.views);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="var(--adm-accent)" stroke="var(--adm-card)" stroke-width="2" class="ana-dot">
      <title>${d.day}: ${d.views.toLocaleString('pt-BR')}</title>
    </circle>`;
  }).join('');

  const prevLine = prevDaily.length > 0
    ? `<path d="${linePath(prevDaily)}" fill="none" stroke="var(--adm-text-muted)" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.4"/>`
    : '';

  return `<svg viewBox="0 0 ${W} ${H}" class="ana-svg-chart" preserveAspectRatio="none">
    ${gridSvg}
    ${prevLine}
    <path d="${areaPath(daily)}" fill="var(--adm-accent)" opacity="0.08"/>
    <path d="${linePath(daily)}" fill="none" stroke="var(--adm-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    ${xLabels}
  </svg>`;
}

function pct(n: number): string {
  const v = Math.round(n * 100);
  return Number.isFinite(v) ? `${v}%` : '0%';
}


// ====== Admin: Shopee ======

// ---- Shopee Analytics helpers ----

const CHART_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

function renderShopeeAnalytics(
  products: ShopeeProduct[],
  clickDays: ShopeeClickDay[],
  productDayClicks: ShopeeProductDayClicks[],
  todayBrt: string,
): string {
  if (products.length === 0) return '';

  // ---- Date helpers ----
  const dayMs = 86400000;
  const todayMs = new Date(todayBrt + 'T12:00:00Z').getTime();
  const yesterdayDate = new Date(todayMs - dayMs).toISOString().slice(0, 10);
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) days.push(new Date(todayMs - i * dayMs).toISOString().slice(0, 10));

  // ---- Click data by day ----
  const byDay = new Map<string, ShopeeClickDay>();
  for (const d of clickDays) byDay.set(d.day, d);
  const todayData = byDay.get(todayBrt) ?? { day: todayBrt, total: 0, unique_visitors: 0 };
  const yesterdayData = byDay.get(yesterdayDate) ?? { day: yesterdayDate, total: 0, unique_visitors: 0 };
  let total7d = 0;
  let totalVisitors7d = 0;
  for (const d of clickDays) { total7d += d.total; totalVisitors7d += d.unique_visitors; }

  // ---- Product aggregates ----
  let totalClicks = 0, totalImpressions = 0;
  for (const p of products) { totalClicks += p.clicks; totalImpressions += p.impressions; }
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  // ---- Today's per-product clicks ----
  const todayProductClicks = new Map<number, number>();
  for (const r of productDayClicks) {
    if (r.day === todayBrt) todayProductClicks.set(r.product_id, (todayProductClicks.get(r.product_id) || 0) + r.total);
  }

  // ---- Trend ----
  const trend = todayData.total > yesterdayData.total ? 'up' : todayData.total < yesterdayData.total ? 'down' : 'flat';
  const trendClass = `kpi-card__trend--${trend}`;
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
  const trendDiff = todayData.total - yesterdayData.total;
  const trendText = trendDiff > 0 ? `+${trendDiff}` : `${trendDiff}`;

  // ==== KPI ROW ====
  const kpiHtml = `
    <section class="kpi-grid kpi-grid--4" style="margin-bottom:1.5rem">
      <div class="kpi-card">
        <div class="kpi-card__head">
          <span class="kpi-card__label">Hoje</span>
          <span class="kpi-card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
        </div>
        <div class="kpi-card__value">${todayData.total}</div>
        <div class="kpi-card__hint">${todayData.unique_visitors} visitante(s) <span class="kpi-card__trend ${trendClass}">${trendIcon} ${trendText}</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__head">
          <span class="kpi-card__label">7 dias</span>
          <span class="kpi-card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span>
        </div>
        <div class="kpi-card__value">${total7d}</div>
        <div class="kpi-card__hint">${totalVisitors7d} visitantes únicos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__head">
          <span class="kpi-card__label">CTR médio</span>
          <span class="kpi-card__icon kpi-card__icon--${avgCtr >= 1 ? 'success' : 'warning'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>
        </div>
        <div class="kpi-card__value${avgCtr >= 1 ? ' kpi-card__value--success' : ''}">${avgCtr.toFixed(2)}%</div>
        <div class="kpi-card__hint">${totalClicks} cliques / ${totalImpressions} impr.</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__head">
          <span class="kpi-card__label">Produtos ativos</span>
          <span class="kpi-card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg></span>
        </div>
        <div class="kpi-card__value">${products.filter(p => p.active).length}</div>
        <div class="kpi-card__hint">${products.length} total cadastrado(s)</div>
      </div>
    </section>`;

  // ==== DAILY CLICKS CHART (stacked bar) ====
  const maxDayClicks = Math.max(1, ...days.map(day => byDay.get(day)?.total ?? 0));
  // Build per-product per-day map
  const productDayMap = new Map<string, number>(); // "pid:day" → clicks
  for (const r of productDayClicks) productDayMap.set(`${r.product_id}:${r.day}`, r.total);
  // Top products by total clicks in period for chart legend (max 8)
  const productTotals = new Map<number, number>();
  for (const r of productDayClicks) productTotals.set(r.product_id, (productTotals.get(r.product_id) || 0) + r.total);
  const topProducts = [...productTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topPids = topProducts.map(t => t[0]);
  const productNameMap = new Map<number, string>();
  for (const r of productDayClicks) productNameMap.set(r.product_id, r.product_name);

  const chartW = 600, chartH = 180, padL = 36, padR = 12, padT = 12, padB = 28;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const barWidth = Math.min(plotW / days.length * 0.65, 40);
  const barGap = plotW / days.length;

  // Y-axis grid lines
  const ySteps = 4;
  let gridLines = '';
  let yLabels = '';
  for (let i = 0; i <= ySteps; i++) {
    const y = padT + plotH - (i / ySteps) * plotH;
    const val = Math.round((i / ySteps) * maxDayClicks);
    gridLines += `<line x1="${padL}" y1="${y}" x2="${chartW - padR}" y2="${y}" stroke="var(--adm-border)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="4 4"'}/>`;
    yLabels += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="var(--adm-text-muted)" font-size="10" font-weight="500">${val}</text>`;
  }

  // Bars
  let barsHtml = '';
  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    const cx = padL + di * barGap + barGap / 2;
    const dayTotal = byDay.get(day)?.total ?? 0;
    const isToday = day === todayBrt;

    // Stacked segments for top products
    let stackY = padT + plotH;
    for (let pi = 0; pi < topPids.length; pi++) {
      const pid = topPids[pi];
      const clicks = productDayMap.get(`${pid}:${day}`) || 0;
      if (clicks === 0) continue;
      const segH = Math.max((clicks / maxDayClicks) * plotH, 1);
      stackY -= segH;
      const color = CHART_COLORS[pi % CHART_COLORS.length];
      barsHtml += `<rect x="${cx - barWidth / 2}" y="${stackY}" width="${barWidth}" height="${segH}" rx="3" fill="${color}" opacity="0.85">
        <title>${escapeHtml((productNameMap.get(pid) || String(pid)).slice(0, 30))}: ${clicks} clique(s) em ${day}</title></rect>`;
    }
    // "Others" segment (clicks from products not in top 8)
    const topSum = topPids.reduce((s, pid) => s + (productDayMap.get(`${pid}:${day}`) || 0), 0);
    const othersClicks = Math.max(0, dayTotal - topSum);
    if (othersClicks > 0) {
      const segH = Math.max((othersClicks / maxDayClicks) * plotH, 1);
      stackY -= segH;
      barsHtml += `<rect x="${cx - barWidth / 2}" y="${stackY}" width="${barWidth}" height="${segH}" rx="3" fill="#d1d5db" opacity="0.6">
        <title>Outros: ${othersClicks} clique(s) em ${day}</title></rect>`;
    }

    // Total label on top
    if (dayTotal > 0) {
      barsHtml += `<text x="${cx}" y="${stackY - 5}" text-anchor="middle" fill="var(--adm-text)" font-size="11" font-weight="600">${dayTotal}</text>`;
    }
    // Day label at bottom
    const label = day.slice(5).replace('-', '/');
    barsHtml += `<text x="${cx}" y="${chartH - 4}" text-anchor="middle" fill="var(--adm-text-muted)" font-size="10" font-weight="${isToday ? '700' : '500'}">${isToday ? '⬤ Hoje' : label}</text>`;
    // Today highlight
    if (isToday) {
      barsHtml += `<rect x="${cx - barGap / 2 + 2}" y="${padT}" width="${barGap - 4}" height="${plotH}" rx="6" fill="var(--adm-accent)" opacity="0.06"/>`;
    }
  }

  // Legend
  const legendItems = topProducts.map((t, i) => {
    const name = productNameMap.get(t[0])?.slice(0, 25) || `#${t[0]}`;
    return `<span class="sp-legend__item"><span class="sp-legend__dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>${escapeHtml(name)} (${t[1]})</span>`;
  }).join('');

  const chartHtml = days.every(day => (byDay.get(day)?.total ?? 0) === 0)
    ? `<div class="chart-empty"><div class="chart-empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div><p>Nenhum clique registrado</p><small>Os dados aparecem quando visitantes clicam nos produtos</small></div>`
    : `<div class="sp-legend">${legendItems}</div>
       <div class="ana-chart-wrap"><svg class="ana-svg-chart" viewBox="0 0 ${chartW} ${chartH}" preserveAspectRatio="xMidYMid meet">
         ${gridLines}${yLabels}${barsHtml}
       </svg></div>`;

  // ==== PRODUCT RANKING TABLE ====
  const ranked = [...products].sort((a, b) => {
    const ctrA = a.impressions > 0 ? a.clicks / a.impressions : 0;
    const ctrB = b.impressions > 0 ? b.clicks / b.impressions : 0;
    return ctrB - ctrA;
  });

  const rankingRows = ranked.map((p, idx) => {
    const ctr = p.impressions > 0 ? ((p.clicks / p.impressions) * 100) : 0;
    const ctrColor = ctr >= 2 ? 'var(--adm-success)' : ctr >= 0.5 ? '#ca8a04' : 'var(--adm-text-muted)';
    const todayClicks = todayProductClicks.get(p.id) || 0;
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `<span class="sp-rank__num">${idx + 1}</span>`;
    const activeLabel = p.active ? '' : '<span class="sp-rank__badge sp-rank__badge--off">off</span>';

    // Mini sparkline for last 7 days
    const sparkData = days.map(day => productDayMap.get(`${p.id}:${day}`) || 0);
    const sparkMax = Math.max(1, ...sparkData);
    const sparkW = 64, sparkH = 20;
    const sparkPoints = sparkData.map((v, i) => {
      const x = (i / (sparkData.length - 1)) * sparkW;
      const y = sparkH - (v / sparkMax) * (sparkH - 2) - 1;
      return `${x},${y}`;
    }).join(' ');
    const sparkIdx = topPids.indexOf(p.id);
    const sparkColor = sparkIdx >= 0 ? CHART_COLORS[sparkIdx % CHART_COLORS.length] : '#94a3b8';
    const sparkSvg = `<svg width="${sparkW}" height="${sparkH}" viewBox="0 0 ${sparkW} ${sparkH}" class="sp-rank__spark"><polyline points="${sparkPoints}" fill="none" stroke="${sparkColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    return `<tr class="${idx % 2 === 0 ? '' : 'sp-rank__row--alt'}">
      <td class="sp-rank__pos">${medal}</td>
      <td class="sp-rank__product">
        <img src="${escapeHtml(p.image_url)}" width="32" height="32" loading="lazy" class="sp-rank__thumb">
        <div class="sp-rank__info">
          <span class="sp-rank__name">${escapeHtml(p.product_name)}</span>
          <span class="sp-rank__meta">${formatPriceReal(p.price)} ${activeLabel}</span>
        </div>
      </td>
      <td class="sp-rank__num-cell">${sparkSvg}</td>
      <td class="sp-rank__num-cell"><strong>${todayClicks}</strong></td>
      <td class="sp-rank__num-cell">${p.clicks}</td>
      <td class="sp-rank__num-cell">${p.impressions}</td>
      <td class="sp-rank__num-cell" style="color:${ctrColor};font-weight:600">${ctr.toFixed(2)}%</td>
    </tr>`;
  }).join('');

  const rankingHtml = `
    <table class="sp-rank">
      <thead>
        <tr>
          <th class="sp-rank__th">#</th>
          <th class="sp-rank__th sp-rank__th--product">Produto</th>
          <th class="sp-rank__th">7 dias</th>
          <th class="sp-rank__th">Hoje</th>
          <th class="sp-rank__th">Cliques</th>
          <th class="sp-rank__th">Impr.</th>
          <th class="sp-rank__th">CTR</th>
        </tr>
      </thead>
      <tbody>${rankingRows}</tbody>
    </table>`;

  return `
    ${kpiHtml}
    <section class="card" style="margin-bottom:1.5rem">
      <header class="card__header">
        <h2 class="card__title">Cliques por dia</h2>
        <span class="badge">${total7d} total</span>
      </header>
      <div class="card__body">${chartHtml}</div>
    </section>
    <section class="card" style="margin-bottom:1.5rem">
      <header class="card__header">
        <h2 class="card__title">Ranking de produtos</h2>
        <span class="badge">${products.length} produtos</span>
      </header>
      <div class="card__body" style="padding:0;overflow-x:auto">${rankingHtml}</div>
    </section>`;
}

function formatPriceReal(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'R$ 0,00';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function renderAdminShopee(
  env: Env, request: Request,
  data: {
    products: import('./db').ShopeeProduct[];
    searchResults: ShopeeApiProduct[];
    searchQuery: string;
    settings: { appId: string; secret: string; firstAfter: number; everyN: number; enabled: boolean };
    clickDays: ShopeeClickDay[];
    productDayClicks: ShopeeProductDayClicks[];
    todayBrt: string;
    saved?: boolean;
  },
): string {
  const url = new URL(request.url);
  const s = data.settings;
  const q = data.searchQuery;

  // Product list sorted by CTR desc
  const sorted = [...data.products].sort((a, b) => {
    const ctrA = a.impressions > 0 ? a.clicks / a.impressions : 0;
    const ctrB = b.impressions > 0 ? b.clicks / b.impressions : 0;
    return ctrB - ctrA;
  });

  const productRows = sorted.length === 0
    ? '<p class="muted" style="padding:1rem;text-align:center">Nenhum produto adicionado. Busque e adicione produtos pela coluna da esquerda.</p>'
    : sorted.map(p => {
      const ctr = p.impressions > 0 ? ((p.clicks / p.impressions) * 100) : 0;
      const ctrColor = ctr >= 2 ? '#16a34a' : ctr >= 0.5 ? '#ca8a04' : '#94a3b8';
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--adm-border,#e5e7eb)">
        <img src="${escapeHtml(p.image_url)}" width="44" height="44" style="border-radius:6px;object-fit:cover;flex-shrink:0;background:#f0f0f0" loading="lazy">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.product_name)}</div>
          <div style="font-size:12px;color:var(--adm-muted,#6b7280);margin-top:2px">
            ${formatPriceReal(p.price)}
            ${p.original_price && p.original_price > p.price ? ` <s style="opacity:0.5">${formatPriceReal(p.original_price)}</s>` : ''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;font-size:12px;line-height:1.5">
          <div><strong style="color:${ctrColor}">${ctr.toFixed(2)}%</strong> CTR</div>
          <div class="muted">${p.clicks}c / ${p.impressions}i</div>
        </div>
        <form method="POST" action="/admin/shopee/${p.id}/remove" style="margin:0" onsubmit="return confirm('Remover este produto?')">
          <button type="submit" class="btn btn--ghost btn--sm" title="Remover" style="color:#ef4444;padding:4px 6px">&times;</button>
        </form>
      </div>`;
    }).join('');

  const searchResultCards = data.searchResults.length === 0
    ? (q ? '<p class="muted" style="padding:1rem;text-align:center">Nenhum resultado encontrado.</p>' : '')
    : data.searchResults.map(r => {
      const priceStr = formatPriceReal(r.priceMin);
      const origStr = r.originalPrice ? formatPriceReal(r.originalPrice) : '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--adm-border,#e5e7eb)">
        <img src="${escapeHtml(r.imageUrl)}" width="44" height="44" style="border-radius:6px;object-fit:cover;flex-shrink:0;background:#f0f0f0" loading="lazy">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.productName)}</div>
          <div style="font-size:12px;color:var(--adm-muted,#6b7280);margin-top:2px">${priceStr}${origStr ? ` <s style="opacity:0.5">${origStr}</s>` : ''}</div>
        </div>
        <form method="POST" action="/admin/shopee/add" style="margin:0">
          <input type="hidden" name="product_name" value="${escapeHtml(r.productName)}">
          <input type="hidden" name="image_url" value="${escapeHtml(r.imageUrl)}">
          <input type="hidden" name="offer_link" value="${escapeHtml(r.offerLink)}">
          <input type="hidden" name="price" value="${r.priceMin}">
          ${r.originalPrice ? `<input type="hidden" name="original_price" value="${r.originalPrice}">` : ''}
          <input type="hidden" name="q" value="${escapeHtml(q)}">
          <button type="submit" class="btn btn--primary btn--sm" title="Adicionar" style="padding:4px 10px;font-size:16px;line-height:1">+</button>
        </form>
      </div>`;
    }).join('');

  const analyticsHtml = renderShopeeAnalytics(data.products, data.clickDays, data.productDayClicks, data.todayBrt);

  return adminShell(env, {
    active: 'shopee',
    title: 'Shopee',
    subtitle: `${sorted.length} produto(s) na lista`,
  }, `
    ${data.saved ? '<div class="toast toast--success">Salvo com sucesso!</div>' : ''}

    ${analyticsHtml}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem">
      <section class="card">
        <header class="card__header">
          <h2 class="card__title">Buscar produtos</h2>
        </header>
        <div class="card__body" style="padding-bottom:0">
          <form method="POST" action="/admin/shopee/search" style="display:flex;gap:8px;margin-bottom:12px">
            <input type="text" name="q" value="${escapeHtml(q)}" placeholder="Buscar na Shopee..." class="input" style="flex:1" required>
            <button type="submit" class="btn btn--primary">Buscar</button>
          </form>
        </div>
        <div style="max-height:500px;overflow-y:auto">${searchResultCards}</div>
      </section>

      <section class="card">
        <header class="card__header">
          <h2 class="card__title">Meus produtos</h2>
          <span class="badge">${sorted.length}</span>
        </header>
        <div style="max-height:500px;overflow-y:auto">${productRows}</div>
      </section>
    </div>

    <details class="card" style="margin-bottom:1.5rem">
      <summary class="card__header" style="cursor:pointer">
        <h2 class="card__title">Configurações</h2>
      </summary>
      <div class="card__body">
        <form method="POST" action="/admin/shopee/settings">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px">
            <div class="field">
              <label>Primeiro produto após parágrafo</label>
              <input type="number" name="first_after" value="${s.firstAfter}" min="1" max="50" class="input">
            </div>
            <div class="field">
              <label>Repetir a cada N parágrafos</label>
              <input type="number" name="every_n" value="${s.everyN}" min="0" max="50" class="input">
              <small class="field__help">0 = só uma inserção</small>
            </div>
            <div class="field field--check" style="align-self:end">
              <label class="check"><input type="checkbox" name="enabled" value="1" ${s.enabled ? 'checked' : ''}> <span>Ativado</span></label>
            </div>
          </div>
          <details style="margin-bottom:16px">
            <summary style="cursor:pointer;font-size:13px;font-weight:500;color:var(--adm-muted,#6b7280)">Credenciais API</summary>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
              <div class="field">
                <label>App ID</label>
                <input type="text" name="app_id" value="${escapeHtml(s.appId)}" class="input" autocomplete="off">
              </div>
              <div class="field">
                <label>Secret</label>
                <input type="password" name="secret" value="${escapeHtml(s.secret)}" class="input" autocomplete="off">
              </div>
            </div>
          </details>
          <button type="submit" class="btn btn--primary">Salvar configurações</button>
        </form>
      </div>
    </details>

    <style>
      @media (max-width: 768px) {
        [style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
      }
    </style>
  `);
}

// ====== Public: Shopee inline card ======

export function renderShopeeInlineCard(product: import('./db').ShopeeProduct): string {
  const priceStr = formatPriceReal(product.price);
  const origStr = product.original_price && product.original_price > product.price
    ? formatPriceReal(product.original_price) : '';
  return `<aside class="shopee-inline" data-product-id="${product.id}" data-nosnippet>
  <a href="/go/shopee/${product.id}" rel="noopener sponsored" class="shopee-inline__link">
    <div class="shopee-inline__image">
      <img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.product_name)}" loading="lazy" decoding="async" width="120" height="120">
    </div>
    <div class="shopee-inline__body">
      <p class="shopee-inline__name">${escapeHtml(product.product_name)}</p>
      <div class="shopee-inline__price-row">
        <span class="shopee-inline__price">${priceStr}</span>
        ${origStr ? `<span class="shopee-inline__original">${origStr}</span>` : ''}
      </div>
      <span class="shopee-inline__cta">Ver oferta &rarr;</span>
    </div>
  </a>
</aside>`;
}

// ====== Admin: API Keys ======
export function renderAdminApiKeys(
  env: Env, request: Request,
  keys: Array<{ id: number; name: string; key_prefix: string; created_at: number; last_used_at: number | null }>,
  newToken?: string,
): string {
  const url = new URL(request.url);
  return adminShell(env, {
    active: 'api-keys',
    title: 'API',
    subtitle: 'Chaves de acesso para publicação externa via REST',
    actions: `<a href="/doc" target="_blank" rel="noopener" class="btn btn--ghost"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>Documentação</a>`,
  }, `
    ${newToken ? `<div class="alert alert--success">
      <span class="alert__icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg></span>
      <div style="flex:1">
        <strong>Chave criada com sucesso.</strong>
        <p>Copie agora — ela <strong>não será exibida de novo</strong>.</p>
        <pre class="token-display" onclick="navigator.clipboard?.writeText(this.textContent.trim()); this.classList.add('is-copied'); setTimeout(() => this.classList.remove('is-copied'), 1500)">${escapeHtml(newToken)}</pre>
        <small class="muted">Clique no token pra copiar.</small>
      </div>
    </div>` : ''}

    <section class="card">
      <header class="card__header">
        <h2 class="card__title">Gerar nova chave</h2>
        <p class="card__desc">Cada chave deve ter um nome descritivo (de onde será usada).</p>
      </header>
      <div class="card__body">
        <form method="POST" action="/admin/api-keys/new" class="inline-form">
          <div class="field" style="flex:1">
            <input type="text" name="name" placeholder="ex: Bot de notícias, n8n, Zapier..." required>
          </div>
          <button type="submit" class="btn btn--primary">Gerar chave</button>
        </form>
      </div>
    </section>

    <section class="card">
      <header class="card__header">
        <h2 class="card__title">Chaves ativas</h2>
        <p class="card__desc">${keys.length} ${keys.length === 1 ? 'chave' : 'chaves'} ${keys.length === 0 ? '— gere uma acima' : ''}</p>
      </header>
      <table class="data-table">
        <thead><tr><th>Nome</th><th>Prefixo</th><th>Criada</th><th>Último uso</th><th></th></tr></thead>
        <tbody>
          ${keys.length === 0 ? `<tr><td colspan="5" class="empty-state">Nenhuma chave ainda.</td></tr>` : keys.map((k) => `
            <tr>
              <td><strong>${escapeHtml(k.name)}</strong></td>
              <td><code class="mono">${escapeHtml(k.key_prefix)}…</code></td>
              <td><time class="muted">${formatDate(k.created_at)}</time></td>
              <td>${k.last_used_at ? `<time class="muted">${formatDate(k.last_used_at)}</time>` : '<span class="muted">nunca</span>'}</td>
              <td style="text-align:right">
                <form method="POST" action="/admin/api-keys/delete/${k.id}" onsubmit="return confirm('Revogar a chave \\'${escapeHtml(k.name)}\\'?')" style="display:inline">
                  <button class="btn btn--ghost btn--danger" type="submit">Revogar</button>
                </form>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>
  `);
}

// ====== Admin: Cache ======
export function renderAdminCache(
  env: Env, request: Request,
  data: {
    version: string;
    lastPurgedAt: number | null;
    purgedNow?: boolean;
  },
): string {
  const url = new URL(request.url);
  const lastPurgedText = data.lastPurgedAt
    ? new Date(data.lastPurgedAt).toLocaleString('pt-BR')
    : 'nunca';

  return adminShell(env, {
    active: 'cache',
    title: 'Cache',
    subtitle: 'Gerenciamento de cache edge — invalidação gradual sem stampede',
  }, `
    ${data.purgedNow ? `<div class="alert alert--success">
      <span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>
      <div>
        <strong>Cache invalidado.</strong> Nova versão: <code>v${escapeHtml(data.version)}</code>.
        <p>A regeneração acontece gradualmente conforme cada página recebe visitas.</p>
      </div>
    </div>` : ''}

    <section class="kpi-grid kpi-grid--2">
      <div class="kpi-card">
        <div class="kpi-card__label">Versão atual</div>
        <div class="kpi-card__value mono">v${escapeHtml(data.version)}</div>
        <div class="kpi-card__hint">Bumpa a cada limpeza</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__label">Última limpeza</div>
        <div class="kpi-card__value kpi-card__value--sm">${escapeHtml(lastPurgedText)}</div>
      </div>
    </section>

    <section class="card">
      <header class="card__header">
        <h2 class="card__title">Como funciona</h2>
      </header>
      <div class="card__body">
        <ul class="info-list">
          <li><strong>Cache edge:</strong> cada HTML fica em cache no PoP do Cloudflare por <strong>10 min</strong>, revalidado em background por 24h (SWR).</li>
          <li><strong>Páginas cacheadas:</strong> home, posts individuais, /privacidade, /doc, /sitemap.xml, /rss.xml.</li>
          <li><strong>Não cacheado:</strong> /admin, /api, imagens R2 já têm regras próprias (no-store / immutable).</li>
          <li><strong>Limpeza gradual:</strong> incrementa a versão. Cada PoP regenera só os paths que receberem acesso — sem sobrecarga em massa.</li>
        </ul>
      </div>
    </section>

    <section class="card">
      <header class="card__header">
        <h2 class="card__title">Limpar cache</h2>
        <p class="card__desc">Use após editar posts em lote, mudar AdSense ou ajustar o design.</p>
      </header>
      <div class="card__body">
        <form method="POST" action="/admin/cache/purge" id="purge-form">
          <button type="submit" class="btn btn--danger btn--lg" id="purge-btn">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2"/></svg>
            Limpar cache agora
          </button>
        </form>
      </div>
    </section>

    <script>
    (() => {
      const form = document.getElementById('purge-form');
      const btn = document.getElementById('purge-btn');
      form?.addEventListener('submit', (e) => {
        if (!confirm('Confirmar limpeza do cache?')) { e.preventDefault(); return false; }
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Limpando…';
      });
    })();
    </script>
  `);
}

// ====== Admin: editor ======
export function renderAdminEditor(
  env: Env, request: Request,
  post: Partial<Post> | null,
  error?: string,
  defaultAuthor?: string,
): string {
  const url = new URL(request.url);
  const isNew = !post?.id;
  const data = {
    title: post?.title ?? '',
    slug: post?.slug ?? '',
    description: post?.description ?? '',
    content: post?.content ?? '',
    category: post?.category ?? '',
    tags: post?.tags ?? '',
    author: post?.author ?? defaultAuthor ?? '',
    hero_image: post?.hero_image ?? '',
    draft: post?.draft ?? 0,
    pub_date: post?.pub_date ?? Date.now(),
  };
  const pubDateInput = new Date(data.pub_date).toISOString().slice(0, 10);

  void url;
  return adminShell(env, {
    active: 'posts',
    title: isNew ? 'Novo post' : 'Editar post',
    subtitle: isNew ? 'Crie um post novo no blog' : `Editando: ${data.title}`,
    actions: `<a href="/admin/posts" class="btn btn--ghost">← Voltar</a>`,
  }, `
    ${error ? `<div class="alert alert--error"><span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span><div>${escapeHtml(error)}</div></div>` : ''}
    <form method="POST" action="${isNew ? '/admin/new' : `/admin/edit/${post?.id}`}">
      <section class="card">
        <header class="card__header">
          <h2 class="card__title">Conteúdo</h2>
        </header>
        <div class="card__body">
          <div class="field">
            <label>Título</label>
            <input type="text" name="title" value="${escapeHtml(data.title)}" required>
          </div>
          <div class="field">
            <label>Slug (URL)</label>
            <div class="input-group">
              <span class="input-group__prefix">/</span>
              <input type="text" name="slug" value="${escapeHtml(data.slug)}" placeholder="auto-gerado-do-titulo" pattern="[a-z0-9-]*">
            </div>
            <small class="field__help">Deixe em branco pra gerar automaticamente. Apenas <code>a-z 0-9 -</code>.</small>
          </div>
          <div class="field">
            <label>Descrição (resumo)</label>
            <textarea name="description" rows="2" placeholder="Resumo curto que aparece nos cards e meta description (até ~160 caracteres)">${escapeHtml(data.description)}</textarea>
          </div>
          <div class="field">
            <label>Conteúdo</label>
            <textarea name="content" rows="22" class="editor-content" placeholder="Texto do post (HTML ou Markdown)">${escapeHtml(data.content)}</textarea>
            <small class="field__help">Aceita HTML ou Markdown. Imagens são processadas automaticamente.</small>
          </div>
        </div>
      </section>

      <section class="card">
        <header class="card__header">
          <h2 class="card__title">Metadados</h2>
        </header>
        <div class="card__body">
          <div class="field-row">
            <div class="field">
              <label>Categoria</label>
              <input type="text" name="category" value="${escapeHtml(data.category ?? '')}" placeholder="Ex: Notícias">
            </div>
            <div class="field">
              <label>Tags</label>
              <input type="text" name="tags" value="${escapeHtml(data.tags)}" placeholder="separadas, por, vírgula">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Autor</label>
              <input type="text" name="author" value="${escapeHtml(data.author)}">
            </div>
            <div class="field">
              <label>Data de publicação</label>
              <input type="date" name="pub_date" value="${pubDateInput}">
            </div>
          </div>
          <div class="field">
            <label>Imagem de capa</label>
            <input type="url" name="hero_image" value="${escapeHtml(data.hero_image ?? '')}" placeholder="https://...">
            <small class="field__help">URL absoluta. Aparece como hero do post + thumbnail nos cards.</small>
          </div>
          <div class="field field--check">
            <label class="check"><input type="checkbox" name="draft" value="1" ${data.draft ? 'checked' : ''}> <span>Salvar como rascunho (não fica visível publicamente)</span></label>
          </div>
        </div>
      </section>

      <div class="sticky-actions">
        <a href="/admin/posts" class="btn btn--ghost">Cancelar</a>
        <button type="submit" class="btn btn--primary btn--lg">${isNew ? 'Publicar post' : 'Salvar alterações'}</button>
      </div>
    </form>

  `);
}

// ====== Admin: Users ======
export function renderAdminUsers(
  env: Env, _request: Request,
  data: {
    users: AdminUser[];
    created?: boolean;
    deleted?: boolean;
    updated?: boolean;
    error?: string;
  },
): string {
  const roleLabel = (r: string) => r === 'admin' ? 'Admin' : 'Operador';
  const roleBadge = (r: string) => r === 'admin'
    ? '<span class="badge badge--success">Admin</span>'
    : '<span class="badge">Operador</span>';

  const avatarThumb = (u: AdminUser) => {
    const name = u.display_name?.trim() || u.username;
    if (u.avatar_url && u.avatar_url.trim()) {
      return `<img src="${escapeHtml(u.avatar_url.trim())}" alt="" class="user-avatar" loading="lazy" width="32" height="32">`;
    }
    return `<span class="user-avatar user-avatar--fallback">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
  };

  const userRows = data.users.length === 0
    ? '<tr><td colspan="5" class="empty-state">Nenhum usuário criado. O login principal usa as credenciais do ambiente.</td></tr>'
    : data.users.map((u) => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            ${avatarThumb(u)}
            <strong>${escapeHtml(u.username)}</strong>
          </div>
        </td>
        <td>
          ${u.display_name ? `<span>${escapeHtml(u.display_name)}</span>` : '<span class="muted">—</span>'}
          ${u.bio ? `<div class="muted" style="font-size:12px;margin-top:2px;max-width:240px;white-space:normal;line-height:1.4">${escapeHtml(u.bio.length > 70 ? u.bio.slice(0, 70) + '…' : u.bio)}</div>` : ''}
        </td>
        <td>${roleBadge(u.role)}</td>
        <td>${formatDate(u.created_at)}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <button type="button" class="btn btn--ghost btn--sm" onclick="toggleForm('profile-form-${u.id}')">Perfil</button>
            <form method="POST" action="/admin/users/${u.id}/role" style="margin:0;display:flex;gap:4px;align-items:center">
              <select name="role" class="input" style="width:auto;font-size:12px;padding:4px 8px">
                <option value="operator"${u.role === 'operator' ? ' selected' : ''}>Operador</option>
                <option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin</option>
              </select>
              <button type="submit" class="btn btn--ghost btn--sm">Alterar</button>
            </form>
            <button type="button" class="btn btn--ghost btn--sm" onclick="toggleForm('pw-form-${u.id}')">Senha</button>
            <form method="POST" action="/admin/users/${u.id}/delete" style="margin:0"
              onsubmit="return confirm('Deletar ${escapeHtml(u.username)}?')">
              <button type="submit" class="btn btn--ghost btn--sm" style="color:var(--adm-danger)">Deletar</button>
            </form>
          </div>
          <form id="profile-form-${u.id}" method="POST" action="/admin/users/${u.id}/profile" style="display:none;margin-top:10px;flex-direction:column;gap:8px;max-width:420px" class="profile-inline-form">
            <div class="field" style="margin:0">
              <label style="font-size:12px">Nome do autor</label>
              <input type="text" name="display_name" value="${escapeHtml(u.display_name ?? '')}" placeholder="${escapeHtml(u.username)}" class="input" maxlength="80">
            </div>
            <div class="field" style="margin:0">
              <label style="font-size:12px">Foto de perfil</label>
              ${renderAvatarField('avatar_url', u.avatar_url ?? '', `u${u.id}`)}
            </div>
            <div class="field" style="margin:0">
              <label style="font-size:12px">Mini-bio</label>
              <textarea name="bio" rows="3" class="input" maxlength="400" placeholder="Ex: Jornalista apaixonada por novelas, cobrindo os principais folhetins há 5 anos.">${escapeHtml(u.bio ?? '')}</textarea>
            </div>
            <div style="display:flex;gap:6px">
              <button type="submit" class="btn btn--primary btn--sm">Salvar perfil</button>
              <button type="button" class="btn btn--ghost btn--sm" onclick="toggleForm('profile-form-${u.id}')">Cancelar</button>
            </div>
          </form>
          <form id="pw-form-${u.id}" method="POST" action="/admin/users/${u.id}/password" style="display:none;margin-top:8px;gap:6px;align-items:center" class="pw-inline-form">
            <input type="password" name="password" placeholder="Nova senha" class="input" style="width:160px;font-size:13px" required minlength="4">
            <button type="submit" class="btn btn--primary btn--sm">Salvar</button>
            <button type="button" class="btn btn--ghost btn--sm" onclick="toggleForm('pw-form-${u.id}')">Cancelar</button>
          </form>
        </td>
      </tr>`).join('');

  return adminShell(env, {
    active: 'users',
    title: 'Usuários',
    subtitle: 'Gerencie quem tem acesso ao painel administrativo',
    userRole: 'admin',
  }, `
    ${data.created ? '<div class="alert alert--success"><span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span><div><strong>Usuário criado com sucesso.</strong></div></div>' : ''}
    ${data.updated ? '<div class="alert alert--success"><span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span><div><strong>Usuário atualizado.</strong></div></div>' : ''}
    ${data.deleted ? '<div class="alert alert--success"><span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span><div><strong>Usuário removido.</strong></div></div>' : ''}
    ${data.error ? `<div class="alert alert--error"><span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></span><div><strong>${escapeHtml(data.error)}</strong></div></div>` : ''}

    <section class="card">
      <header class="card__header card__header--icon">
        <span class="card__header-icon" style="background:var(--adm-accent-bg);color:var(--adm-accent)">
          ${ICONS.users}
        </span>
        <div>
          <h2 class="card__title">Usuários do painel</h2>
          <p class="card__desc">O login principal (variáveis de ambiente) sempre tem acesso de <strong>Admin</strong>. Usuários abaixo são contas adicionais.</p>
        </div>
      </header>
      <div class="card__body" style="padding:0">
        <div style="padding:12px 16px;background:var(--adm-muted-bg);border-bottom:1px solid var(--adm-border);font-size:13px;color:var(--adm-text-muted)">
          <strong>Admin</strong> = acesso total &nbsp;|&nbsp; <strong>Operador</strong> = sem acesso a Configurações, API e Usuários
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>Usuário</th><th>Nome do autor</th><th>Papel</th><th>Criado em</th><th>Ações</th></tr>
        </thead>
        <tbody>${userRows}</tbody>
      </table>
      <div style="padding:10px 16px;background:var(--adm-muted-bg);border-top:1px solid var(--adm-border);font-size:12px;color:var(--adm-text-muted)">
        Clique em <strong>Perfil</strong> para editar nome do autor, foto e mini-bio. Esses dados aparecem na assinatura do post e no box de autor logo após o conteúdo.
      </div>
    </section>

    <section class="card">
      <header class="card__header">
        <h2 class="card__title">Novo usuário</h2>
        <p class="card__desc">Crie contas para outras pessoas acessarem o painel.</p>
      </header>
      <div class="card__body">
        <form method="POST" action="/admin/users/new">
          <div class="field-row">
            <div class="field" style="flex:1">
              <label>Usuário (login)</label>
              <input type="text" name="username" placeholder="Ex: maria" class="input" required minlength="3" autocomplete="off">
            </div>
            <div class="field" style="flex:1">
              <label>Nome do autor</label>
              <input type="text" name="display_name" placeholder="Ex: Maria Silva (opcional)" class="input" maxlength="80" autocomplete="off">
            </div>
          </div>
          <div class="field-row">
            <div class="field" style="flex:1">
              <label>Senha</label>
              <input type="password" name="password" placeholder="Mín. 4 caracteres" class="input" required minlength="4">
            </div>
            <div class="field">
              <label>Papel</label>
              <select name="role" class="input">
                <option value="operator">Operador</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <button type="submit" class="btn btn--primary">Criar usuário</button>
        </form>
      </div>
    </section>

    ${avatarCropperAssets()}

    <script>
    function toggleForm(id) {
      var form = document.getElementById(id);
      if (!form) return;
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    }
    </script>
  `);
}

// ====== Admin: AdSense reports (authenticated snapshot, never fetches Google on GET) ======
export function renderAdminAdSense(env: Env, view: import('./adsenseReports').ReportsView, message?: string): string {
  const snapshot = view.snapshot;
  const date = (value: string) => value.split('-').reverse().join('/');
  const stamp = (value: number) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const numeric = (value: number) => value.toLocaleString('pt-BR');
  const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: snapshot!.currency });
  const percent = (value: number) => value.toLocaleString('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
  const format = (value: number, index: number) => index === 0 || index === 4 ? money(value) : index === 5 ? percent(value) : numeric(value);
  const labels = ['Receita estimada', 'Visualizações de página', 'Impressões de anúncios', 'Cliques', 'RPM de página', 'CTR de página'];
  const stale = !!snapshot && Date.now() - snapshot.generatedAt > 2 * 60 * 60 * 1000;
  const next = view.guard?.nextAttemptAt ?? 0;
  const disabled = !view.connected || next > Date.now();
  const connect = view.configured ? `<form method="POST" action="/admin/adsense/connect" class="ads-report-form"><button class="btn btn--primary" type="submit">${view.connected ? 'Reconectar conta Google' : 'Conectar conta Google'}</button></form>` : '';
  return adminShell(env, {
    active: 'adsense', title: 'Receita do AdSense', bodyClass: 'ads-report-page',
    subtitle: 'Desempenho dos anúncios do Capítulo de Hoje',
    actions: '<a class="btn" href="/admin/settings">Configurar anúncios</a>',
  }, `
    <style>
      .ads-report-page .adm-main,.ads-report-page .adm-content{min-width:0}.ads-report-state{overflow-wrap:anywhere}
      .ads-report-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:24px 0}
      .ads-report-grid .ads-report-kpi{padding:20px;margin:0}.ads-report-kpi dt{font-size:14px}.ads-report-kpi dd{margin:10px 0 0;font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}
      .ads-report-state{padding:24px}.ads-report-state p{line-height:1.6}.ads-report-actions{margin-top:12px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}.ads-report-form{margin:0}
      .ads-report-form button{min-height:44px;cursor:pointer}.ads-report-form button:disabled{cursor:wait;opacity:.6}.ads-report-form button:focus-visible{outline:3px solid currentColor;outline-offset:3px}
      .ads-report-table{overflow-x:auto}.ads-report-table table{width:100%;min-width:660px;border-collapse:collapse;font-variant-numeric:tabular-nums}
      .ads-report-table th,.ads-report-table td{text-align:right;padding:12px;border-bottom:1px solid var(--adm-border,#d1d5db)}.ads-report-table th:first-child,.ads-report-table td:first-child{text-align:left}
      .ads-report-note{border-left:4px solid currentColor;padding:12px 16px;margin:16px 0;line-height:1.6}.ads-report-chart{display:flex;align-items:end;gap:3px;height:120px;margin:16px 0}.ads-report-bar{flex:1;background:var(--adm-accent,#2563eb);min-width:2px;border-radius:3px 3px 0 0}
      @media(max-width:900px){.ads-report-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ads-report-kpi dd{font-size:24px}}
      @media(max-width:480px){.ads-report-grid{grid-template-columns:1fr}.ads-report-state{padding:16px}}
    </style>
    ${message ? `<p role="status" class="ads-report-note">${escapeHtml(message)}</p>` : ''}
    <section class="card ads-report-state" aria-labelledby="adsense-connection">
      <h2 id="adsense-connection">${view.connected ? 'Conta conectada' : 'Conecte os relatórios do AdSense'}</h2>
      <p>${escapeHtml(view.email || 'Conta Google ainda não definida')}${view.account ? ` · ${escapeHtml(view.account.replace('accounts/', ''))}` : ''}</p>
      <p>Acesso somente de leitura aos relatórios. A conexão não altera anúncios ou pagamentos.</p>
      ${!view.configured ? '<p class="ads-report-note">A integração ainda aguarda a configuração do cliente OAuth no servidor. Depois disso, o botão para conectar sua conta aparecerá aqui.</p>' : connect}
      ${view.error ? `<p role="alert" class="ads-report-note">${escapeHtml(view.error)}</p>` : ''}
      ${view.connected ? `<div class="ads-report-actions"><form method="POST" action="/admin/adsense/sync" class="ads-report-form"><button class="btn" type="submit" ${disabled ? 'disabled' : ''}>Atualizar relatório</button></form><p>Atualização automática a cada hora.${next > Date.now() ? ` Próxima tentativa a partir de ${stamp(next)} (Brasília).` : ''}</p></div>` : ''}
      ${view.guard?.status === 'error' ? `<p role="alert" class="ads-report-note">${escapeHtml(view.guard.error ?? 'A última sincronização falhou.')} ${snapshot ? 'Exibindo o último relatório válido.' : ''}</p>` : ''}
      ${view.guard?.status === 'syncing' ? '<p role="status">A última tentativa foi iniciada. Se ela não concluir, o agendamento tentará novamente após o intervalo de uma hora.</p>' : ''}
    </section>
    ${snapshot ? `
      <section aria-label="Resumo do período">
        <h2>${date(snapshot.start)} a ${date(snapshot.end)}</h2>
        <p>30 dias completos · ${escapeHtml(snapshot.domain)} (inclui www) · Fuso ${escapeHtml(snapshot.timeZone)} · Moeda ${escapeHtml(snapshot.currency)}</p>
        <p>Sincronizado em ${stamp(snapshot.generatedAt)} (Brasília). Valores estimados, sujeitos a ajustes do Google.</p>
        ${stale ? '<p role="status" class="ads-report-note">Os dados estão desatualizados. Consulte o estado da sincronização acima.</p>' : ''}
        ${snapshot.warnings.map(w => `<p class="ads-report-note">Aviso do Google: ${escapeHtml(w)}</p>`).join('')}
        <dl class="ads-report-grid">${labels.map((label, i) => `<div class="card ads-report-kpi"><dt>${label}</dt><dd>${format(snapshot.totals[i], i)}</dd></div>`).join('')}</dl>
        <p>RPM: receita por mil visualizações. CTR: proporção entre cliques e visualizações. São métricas do AdSense; podem diferir dos acessos registrados pelo site.</p>
      </section>
      <section class="card ads-report-state" aria-labelledby="adsense-daily">
        <h2 id="adsense-daily">Receita por dia</h2>
        ${snapshot.rows.length ? `<div class="ads-report-chart" aria-hidden="true">${(() => {
          const days = Array.from({ length: 30 }, (_, i) => new Date(Date.parse(snapshot.start + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10));
          const max = Math.max(0.01, ...snapshot.rows.map(r => r.values[0]));
          return days.map(day => { const value = snapshot.rows.find(r => r.date === day)?.values[0] ?? 0; return `<span class="ads-report-bar" style="height:${Math.max(0, value) / max * 100}%" title="${date(day)}: ${escapeHtml(money(value))}"></span>`; }).join('');
        })()}</div><div class="ads-report-table" tabindex="0" role="region" aria-label="Tabela diária do AdSense"><table><caption>Valores diários informados pelo Google; dias sem linhas não foram retornados.</caption><thead><tr><th scope="col">Data</th>${labels.map(l => `<th scope="col">${l}</th>`).join('')}</tr></thead><tbody>${[...snapshot.rows].reverse().map(row => `<tr><th scope="row">${date(row.date)}</th>${row.values.map((value, i) => `<td>${format(value, i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p>Nenhum dado retornado pelo AdSense para este site no período. Isso não significa falha de conexão.</p>'}
      </section>` : view.connected ? '<section class="card ads-report-state"><h2>Aguardando o primeiro relatório</h2><p>O agendamento buscará os dados automaticamente. Você também pode usar Atualizar relatório quando disponível.</p></section>' : ''}
    <script>document.querySelectorAll('.ads-report-form').forEach(function(form){form.addEventListener('submit',function(){var button=form.querySelector('button');button.disabled=true;button.textContent='Aguarde…';form.setAttribute('aria-busy','true');});});window.addEventListener('pageshow',function(event){if(event.persisted)window.location.reload();});</script>
  `);
}
