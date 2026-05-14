import type { Env, Post } from './types';
import { renderMarkdown, readingTime } from './markdown';
import {
  type AdConfig, renderAdSenseScript, renderAdUnit, injectInContentAds,
} from './adsense';

export interface SiteAdSettings {
  publisherId: string;       // ca-pub-XXX
  autoAds: boolean;
  config: AdConfig;
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
  stickyAd?: string;     // ad fixo no rodapé mobile
  typography?: SiteTypography;
}

function layout(opts: LayoutOptions, body: string): string {
  const {
    title, description, url, siteTitle,
    type = 'website', pubDate, updatedDate, author,
    image, tags = [], category, jsonLd, bodyClass = '',
    headInject = '', stickyAd = '', typography,
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/styles.css?v=${Date.now()}" as="style">
<link rel="stylesheet" href="/styles.css?v=${Date.now()}">
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
</head>
<body class="${finalBodyClass}">
<header class="site-header">
  <div class="container">
    <a href="${isAdmin ? '/admin' : '/'}" class="site-logo">${isAdmin ? `${escapeHtml(siteTitle)} <span class="site-logo__suffix">admin</span>` : `<img src="/img/logo-v2.png" alt="${escapeHtml(siteTitle)}" class="site-logo__img" width="500" height="197">`}</a>
    ${isAdmin ? '<nav><a href="/" target="_blank" rel="noopener">Ver site →</a></nav>' : ''}
  </div>
</header>
<main class="container">
${body}
</main>
<footer class="site-footer">
  <div class="container">
    <p>© ${new Date().getFullYear()} ${escapeHtml(siteTitle)} · <a href="/privacidade">Privacidade</a> · <a href="/rss.xml">RSS</a></p>
  </div>
</footer>
${stickyAd}
${!isAdmin ? `<div id="cookie-consent" style="display:none;position:fixed;bottom:12px;left:50%;z-index:9999;transform:translateX(-50%) translateY(20px);opacity:0;max-width:min(440px,calc(100% - 32px));display:none">
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
</body>
</html>`;
}

// ====== Home ======
export function renderHome(
  env: Env, request: Request, posts: Post[],
  ads?: SiteAdSettings, typography?: SiteTypography,
): string {
  const url = new URL(request.url);
  const siteUrl = siteCanonical(env, url);

  const pubId = ads?.publisherId;
  const betweenAd = (pubId && ads?.config.betweenCards.enabled && ads.config.betweenCards.slotId)
    ? `<article class="post-card post-card--ad">${renderAdUnit(pubId, ads.config.betweenCards.slotId, ads.config.betweenCards.format)}</article>`
    : '';
  const everyN = ads?.config.betweenCards.everyNCards ?? 6;

  const items: string[] = [];
  posts.forEach((p, i) => {
    const eager = i < 3;
    items.push(`<article class="post-card">
        ${p.hero_image ? `<a href="/${escapeHtml(p.slug)}" class="post-card__image" aria-hidden="true" tabindex="-1"><img src="${escapeHtml(p.hero_image)}" alt="" loading="${eager ? 'eager' : 'lazy'}" ${eager ? 'fetchpriority="high"' : ''} decoding="async"></a>` : ''}
        <div class="post-card__body">
          <h2 class="post-card__title"><a href="/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></h2>
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
    : `<section class="posts-grid">${cards}</section>`;

  const adsHead = (pubId && ads) ? renderAdSenseScript(pubId, ads.autoAds) : '';
  const stickyAd = (pubId && ads?.config.stickyFooter.enabled && ads.config.stickyFooter.slotId)
    ? `<div class="ad-sticky-footer">${renderAdUnit(pubId, ads.config.stickyFooter.slotId, ads.config.stickyFooter.format)}</div>`
    : '';

  return layout(
    {
      title: env.SITE_TITLE,
      description: env.SITE_DESCRIPTION,
      url: siteUrl + '/',
      siteTitle: env.SITE_TITLE,
      headInject: adsHead,
      stickyAd,
      typography,
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

// ====== Post page ======
export function renderPost(
  env: Env, request: Request, post: Post,
  related: Post[] = [], ads?: SiteAdSettings, typography?: SiteTypography,
  trending: Post[] = [],
): string {
  const url = new URL(request.url);
  const siteOrigin = siteCanonical(env, url);
  const postUrl = `${siteOrigin}/${post.slug}`;
  const tags = parseTags(post.tags);
  let html = renderMarkdown(post.content);
  // Stripa <h1> duplicado no início do content (WP exporta o título dentro do body).
  // Remove o primeiro <h1>...</h1> se o texto bater ~80% com o título do post.
  html = stripDuplicateH1(html, post.title);

  // injeta ads in-content se configurado
  const pubId = ads?.publisherId;
  if (pubId && ads?.config.inContent.enabled && ads.config.inContent.slotId) {
    html = injectInContentAds(
      html, pubId, ads.config.inContent.slotId,
      ads.config.inContent.format, ads.config.inContent.everyNParagraphs ?? 4,
    );
  }

  // injeta box de trending (Em Alta) antes de cada <h2>
  if (trending.length > 0) {
    html = injectTrendingBoxes(html, trending.slice(0, 6), post.slug);
  }

  // helper que renderiza um ad slot se config + slotId
  const adIf = (key: keyof AdConfig, wrapperClass: string): string => {
    if (!pubId || !ads) return '';
    const p = ads.config[key];
    if (!p?.enabled || !p.slotId) return '';
    return `<aside class="ad-slot ${wrapperClass}">${renderAdUnit(pubId, p.slotId, p.format)}</aside>`;
  };

  // Related posts
  const relatedHtml = related.length === 0 ? '' : renderRelatedSection(related);

  const body = `
<article class="post">
  ${adIf('beforePost', 'ad-slot--before-post')}
  ${post.hero_image ? `<div class="post__hero-wrap"><img src="${escapeHtml(post.hero_image)}" alt="" class="post__hero" loading="eager" fetchpriority="high" decoding="async"></div>` : ''}
  <header class="post__header">
    <h1 class="post__title">${escapeHtml(post.title)}</h1>
    <div class="post__meta">
      <time datetime="${isoDate(post.pub_date)}">${formatDate(post.pub_date)}</time>
      <span>·</span>
      <span>${escapeHtml(post.author)}</span>
      <span>·</span>
      <span>${readingTime(post.content)}</span>
    </div>
  </header>
  ${adIf('topOfContent', 'ad-slot--top')}
  <div class="prose">${html}</div>
  ${adIf('afterContent', 'ad-slot--after')}
</article>
${relatedHtml}
${adIf('bottomOfPage', 'ad-slot--bottom')}
<p class="back"><a href="/">← Voltar</a></p>
<script>
(function(){
  var article = document.querySelector('.post');
  if (!article || !('IntersectionObserver' in window)) return;
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- 1. Header progress bar ---
  var header = document.querySelector('.site-header');
  var hpBar = document.createElement('div');
  hpBar.className = 'header-progress';
  if (header) header.appendChild(hpBar);

  var prose = document.querySelector('.prose');
  var ticking = false;
  function updateProgress() {
    if (!prose) return;
    var r = prose.getBoundingClientRect();
    var vh = window.innerHeight;
    var start = r.top + window.scrollY;
    var end = start + r.height - vh;
    var pct = Math.min(100, Math.max(0, ((window.scrollY - start) / (end - start)) * 100));
    hpBar.style.width = pct + '%';
    return pct;
  }

  // --- 2. Hero color-shift ---
  var hero = document.querySelector('.post__hero');
  function updateHero() {
    if (!hero) return;
    var r = hero.getBoundingClientRect();
    if (r.bottom < 0) {
      hero.classList.add('hero-faded');
    } else {
      var pct = 1 - (r.bottom / (window.innerHeight + r.height));
      if (pct > 0.4) hero.classList.add('hero-faded');
      else hero.classList.remove('hero-faded');
    }
  }

  // --- 3. Image parallax on scroll ---
  // Wrap figure imgs in overflow container so caption stays outside
  document.querySelectorAll('.prose figure > img').forEach(function(img) {
    if (img.parentElement.classList.contains('img-parallax-wrap')) return;
    var wrap = document.createElement('div');
    wrap.className = 'img-parallax-wrap';
    img.parentElement.insertBefore(wrap, img);
    wrap.appendChild(img);
  });
  var proseImgs = document.querySelectorAll('.prose .img-parallax-wrap img, .prose > img');
  function updateImageParallax() {
    if (prefersReduced) return;
    var vh = window.innerHeight;
    for (var i = 0; i < proseImgs.length; i++) {
      var img = proseImgs[i];
      var r = img.getBoundingClientRect();
      if (r.bottom > -100 && r.top < vh + 100) {
        // Map position: when center of img is at bottom of viewport → -15px, at top → +15px
        var center = r.top + r.height / 2;
        var ratio = (center / vh - 0.5) * 2; // -1 to 1
        var shift = ratio * -15;
        img.style.setProperty('--img-y', shift + 'px');
      }
    }
  }

  // --- Scroll handler (throttled via rAF) ---
  window.addEventListener('scroll', function() {
    if (!ticking) {
      requestAnimationFrame(function() {
        updateProgress();
        updateHero();
        updateImageParallax();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
  updateProgress();
  updateHero();
  updateImageParallax();

  // --- 4. Fade-in + highlight via IntersectionObserver ---
  article.classList.add('ed-ready');

  // Prose blocks: fade in
  var blockSel = '.prose > p, .prose > h2, .prose > h3, .prose > h4,' +
    '.prose > blockquote, .prose > ul, .prose > ol,' +
    '.prose > pre, .prose > table, .prose > figure,' +
    '.prose > .ad-inarticle, .prose > img';
  var blocks = document.querySelectorAll(blockSel);
  var blockIO = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        blockIO.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  blocks.forEach(function(el) { blockIO.observe(el); });

  // Highlight: strong/em marker effect
  var highlights = document.querySelectorAll('.prose strong, .prose em');
  var hlIO = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        e.target.classList.add('hl-visible');
        hlIO.unobserve(e.target);
      }
    });
  }, { threshold: 0.5, rootMargin: '0px 0px -20px 0px' });
  highlights.forEach(function(el) { hlIO.observe(el); });
})();
</script>`;

  const heroAbs = post.hero_image
    ? (post.hero_image.startsWith('http') ? post.hero_image : `${siteOrigin}${post.hero_image}`)
    : undefined;

  const adsHead = (pubId && ads) ? renderAdSenseScript(pubId, ads.autoAds) : '';
  const stickyAd = (pubId && ads?.config.stickyFooter.enabled && ads.config.stickyFooter.slotId)
    ? `<div class="ad-sticky-footer">${renderAdUnit(pubId, ads.config.stickyFooter.slotId, ads.config.stickyFooter.format)}</div>`
    : '';

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
      stickyAd,
      typography,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        mainEntityOfPage: { '@type': 'WebPage', '@id': postUrl },
        headline: post.title,
        description: post.description,
        ...(heroAbs && { image: { '@type': 'ImageObject', url: heroAbs } }),
        datePublished: isoDate(post.pub_date),
        dateModified: isoDate(post.updated_date),
        author: { '@type': 'Person', name: post.author },
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

// ====== Trending Box (Em Alta — 6 posts, 3x2 grid) ======
function renderTrendingBox(posts: Post[]): string {
  const items = posts.map((p) => `<a class="trending-item" href="/${escapeHtml(p.slug)}">
      ${p.hero_image ? `<img class="trending-item__img" src="${escapeHtml(p.hero_image)}" alt="" loading="lazy" decoding="async">` : `<span class="trending-item__img trending-item__img--ph"></span>`}
      <span class="trending-item__title">${escapeHtml(p.title)}</span>
    </a>`).join('');
  return `<aside class="trending-box" aria-label="Em alta">
  <div class="trending-box__header"><svg class="trending-box__icon" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"/></svg> Em Alta</div>
  <div class="trending-box__grid">${items}</div>
</aside>`;
}

function injectTrendingBoxes(html: string, trending: Post[], currentSlug: string): string {
  // Filtra o post atual dos trending
  const filtered = trending.filter((p) => p.slug !== currentSlug).slice(0, 2);
  if (filtered.length < 2) return html;

  const box = renderTrendingBox(filtered);
  // Injeta antes de cada <h2> (exceto o primeiro — muito próximo do topo)
  let count = 0;
  return html.replace(/<h2[\s>]/gi, (match) => {
    count++;
    if (count <= 1) return match; // pula o primeiro h2
    return box + '\n' + match;
  });
}

// ====== Related Posts ======
function renderRelatedSection(posts: Post[]): string {
  const items = posts.map((p) => `
    <a class="related-card" href="/${escapeHtml(p.slug)}">
      ${p.hero_image ? `<img class="related-card__image" src="${escapeHtml(p.hero_image)}" alt="" loading="lazy" decoding="async">` : '<span class="related-card__image related-card__image--ph"></span>'}
      <span class="related-card__title">${escapeHtml(p.title)}</span>
      <time class="related-card__date" datetime="${isoDate(p.pub_date)}">${formatDate(p.pub_date)}</time>
    </a>`).join('');

  return `<section class="related" aria-labelledby="related-heading">
  <h2 id="related-heading" class="related__heading">Continue lendo</h2>
  <div class="related__scroller" tabindex="0">
    <button class="related__nav related__nav--prev" type="button" aria-label="Anterior" data-related-prev>‹</button>
    <ul class="related__list" data-related-track>${items}</ul>
    <button class="related__nav related__nav--next" type="button" aria-label="Próximos" data-related-next>›</button>
  </div>
</section>
<script>
(() => {
  const track = document.querySelector('[data-related-track]');
  if (!track) return;
  document.querySelector('[data-related-prev]')?.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth * 0.9, behavior: 'smooth' }));
  document.querySelector('[data-related-next]')?.addEventListener('click', () => track.scrollBy({ left: track.clientWidth * 0.9, behavior: 'smooth' }));
})();
</script>`;
}

// ====== Privacy Policy ======
export function renderPrivacy(env: Env, request: Request): string {
  const url = new URL(request.url);
  const siteUrl = siteCanonical(env, url);
  const today = new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });

  return layout(
    {
      title: `Política de Privacidade — ${env.SITE_TITLE}`,
      description: `Política de privacidade, uso de cookies, Google AdSense e LGPD do ${env.SITE_TITLE}.`,
      url: `${siteUrl}/privacidade`,
      siteTitle: env.SITE_TITLE,
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
export function renderDocs(env: Env, request: Request): string {
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
export function render404(env: Env, request: Request): string {
  const url = new URL(request.url);
  return layout(
    {
      title: `404 — ${env.SITE_TITLE}`,
      description: 'Página não encontrada',
      url: `${siteCanonical(env, url)}${url.pathname}`,
      siteTitle: env.SITE_TITLE,
      bodyClass: 'is-404',
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
    stats: { total: number; published: number; drafts: number; views24h: number };
    recent: Post[];
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
  `);
}

/** Posts list — agora separado de /admin (que virou dashboard). */
export function renderAdminPosts(
  env: Env, request: Request,
  posts: Post[],
  filters: { q?: string; status?: 'all' | 'published' | 'draft' } = {},
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
          <tr><th>Título</th><th>Data</th><th>Status</th><th style="width:1px"></th></tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="4" class="empty-state">Nenhum post encontrado${q ? ' para "' + escapeHtml(q) + '"' : ''}.</td></tr>` : filtered.slice(0, 100).map((p) => `
            <tr>
              <td>
                <a href="/admin/edit/${p.id}" class="post-link">${escapeHtml(p.title)}</a>
                <div class="muted">/${escapeHtml(p.slug)}</div>
              </td>
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
            </tr>`).join('')}
        </tbody>
      </table>
      ${filtered.length > 100 ? `<div class="table-footer muted">Mostrando 100 de ${filtered.length}. Use a busca pra refinar.</div>` : ''}
    </section>
  `);
}

// ====== Admin: shell with sidebar nav ======
type AdminSection = 'dashboard' | 'posts' | 'settings' | 'configuracoes' | 'analytics' | 'api-keys' | 'cache';

interface AdminShellOptions {
  active: AdminSection;
  title: string;
  subtitle?: string;
  actions?: string;  // HTML pro lado direito do header
  bodyClass?: string;
}

/** Ícones SVG inline — 20px, stroke 1.75, currentColor */
const ICONS: Record<AdminSection, string> = {
  dashboard: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
  posts:     '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>',
  settings:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
  configuracoes: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  'api-keys':'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  cache:     '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
};

function adminShell(env: Env, opts: AdminShellOptions, body: string): string {
  const { active, title, subtitle, actions = '', bodyClass = '' } = opts;
  const navItems: Array<[AdminSection, string, string]> = [
    ['dashboard', '/admin', 'Início'],
    ['posts',     '/admin/posts', 'Posts'],
    ['analytics', '/admin/analytics', 'Analytics'],
    ['settings',  '/admin/settings', 'Monetização'],
    ['configuracoes', '/admin/configuracoes', 'Configurações'],
    ['api-keys',  '/admin/api-keys', 'API'],
    ['cache',     '/admin/cache', 'Cache'],
  ];

  // Mobile bottom nav: show only the 5 most important items
  const mobileNavItems: Array<[AdminSection, string, string]> = [
    ['dashboard', '/admin', 'Início'],
    ['posts',     '/admin/posts', 'Posts'],
    ['analytics', '/admin/analytics', 'Analytics'],
    ['settings',  '/admin/settings', 'Ads'],
    ['configuracoes', '/admin/configuracoes', 'Config'],
  ];

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
export function renderAdminSettings(
  env: Env, request: Request,
  data: {
    publisherId: string;
    autoAds: boolean;
    adConfig: AdConfig;
    saved?: boolean;
    error?: string;
  },
): string {
  void request;
  const { publisherId, autoAds, adConfig, saved, error } = data;

  const placements: Array<{
    key: keyof AdConfig;
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

  const placementsHtml = placements.map((pl) => {
    const cfg = adConfig[pl.key];
    const n = pl.hasN === 'paragraphs' ? (cfg as any).everyNParagraphs
            : pl.hasN === 'cards'      ? (cfg as any).everyNCards : null;
    const isOn = cfg.enabled && cfg.slotId;
    return `<div class="placement-card ${isOn ? 'is-on' : ''}" data-placement="${pl.key}">
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
            <label>Slot ID</label>
            <input type="text" name="slot.${pl.key}" value="${escapeHtml(cfg.slotId ?? '')}" placeholder="1234567890" inputmode="numeric">
          </div>
          <div class="field">
            <label>Formato</label>
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
  }, `
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
    </script>
  `);
}

// ====== Admin: Configurações (Typography) ======
export function renderAdminConfiguracoes(
  env: Env, request: Request,
  data: {
    typography: { titleScale: 'sm' | 'md' | 'lg' | 'xl'; bodyScale: 'sm' | 'md' | 'lg' };
    saved?: boolean;
  },
): string {
  void request;

  return adminShell(env, {
    active: 'configuracoes',
    title: 'Configurações',
    subtitle: 'Tipografia, aparência e preferências do site público',
  }, `
    ${data.saved ? `<div class="alert alert--success"><span class="alert__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span><div><strong>Configurações salvas.</strong> O cache do site foi limpo automaticamente.</div></div>` : ''}

    <form method="POST" action="/admin/configuracoes">
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
          <div class="type-preview" id="type-preview">
            <div class="type-preview__label">Pré-visualização</div>
            <h1 class="type-preview__h1">Título de exemplo</h1>
            <p class="type-preview__p">Este é um parágrafo de exemplo do corpo do texto. Use essas configurações para encontrar o tamanho mais confortável para os leitores do seu blog.</p>
          </div>
        </div>
      </section>

      <div class="sticky-actions">
        <button type="submit" class="btn btn--primary btn--lg">Salvar configurações</button>
      </div>
    </form>

    <script>
    (() => {
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
  },
): string {
  void request;
  const max = Math.max(1, ...data.daily.map((d) => d.views));

  // KPI trends: comparar com período anterior
  // 7d vs 7d anteriores: precisaria de dados — uso média diária
  const avg7 = data.totals.last7d / 7;
  const avg30 = data.totals.last30d / 30;
  const trend24h = data.totals.last24h > avg7
    ? { label: `+${pct((data.totals.last24h - avg7) / Math.max(1, avg7))}`, dir: 'up' as const }
    : data.totals.last24h < avg7
      ? { label: `-${pct((avg7 - data.totals.last24h) / Math.max(1, avg7))}`, dir: 'down' as const }
      : { label: 'estável', dir: 'flat' as const };
  const trend7d: { label: string; dir: 'up' | 'down' | 'flat' } = avg7 > avg30
    ? { label: `+${pct((avg7 - avg30) / Math.max(1, avg30))}`, dir: 'up' }
    : avg7 < avg30
      ? { label: `-${pct((avg30 - avg7) / Math.max(1, avg30))}`, dir: 'down' }
      : { label: 'estável', dir: 'flat' };

  const chart = data.daily.length === 0
    ? `<div class="chart-empty">
        <span class="chart-empty__icon"><svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg></span>
        <p>Sem dados ainda</p>
        <small>As visitas aparecem aqui em poucos minutos.</small>
      </div>`
    : `<div class="chart">
      ${data.daily.map((d) => `
        <div class="chart__col" title="${d.day}: ${d.views.toLocaleString('pt-BR')} views">
          <div class="chart__bar" style="height:${(d.views / max * 100).toFixed(1)}%"></div>
          <div class="chart__label">${d.day.slice(8)}</div>
        </div>
      `).join('')}
    </div>`;

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

  // Ícones SVG inline
  const iEye = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const iCalDay = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/></svg>';
  const iCalMo  = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
  const iTrend  = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>';
  const iFire   = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>';
  const iChart  = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>';

  return adminShell(env, {
    active: 'analytics',
    title: 'Analytics',
    subtitle: 'Visualizações, páginas populares e tendências',
  }, `
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
          <span class="kpi-card__label">Últimos 30 dias</span>
          <span class="kpi-card__icon">${iCalMo}</span>
        </div>
        <div class="kpi-card__value">${data.totals.last30d.toLocaleString('pt-BR')}</div>
        <div class="kpi-card__hint">~${Math.round(avg30).toLocaleString('pt-BR')} views/dia em média</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card__head">
          <span class="kpi-card__label">Pico diário</span>
          <span class="kpi-card__icon kpi-card__icon--warning">${iTrend}</span>
        </div>
        <div class="kpi-card__value">${(data.daily.length ? Math.max(...data.daily.map((d) => d.views)) : 0).toLocaleString('pt-BR')}</div>
        <div class="kpi-card__hint">maior volume diário em 30 dias</div>
      </div>
    </section>

    <section class="card">
      <header class="card__header card__header--icon">
        <span class="card__header-icon">${iChart}</span>
        <div>
          <h2 class="card__title">Visualizações por dia</h2>
          <p class="card__desc">Últimos 30 dias — passe o mouse pra ver detalhes</p>
        </div>
      </header>
      <div class="card__body">${chart}</div>
    </section>

    <section class="card">
      <header class="card__header card__header--icon">
        <span class="card__header-icon">${iFire}</span>
        <div>
          <h2 class="card__title">Em alta — 48 horas</h2>
          <p class="card__desc">Posts mais visualizados nas últimas 48h</p>
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
          <h2 class="card__title">Top de todos os tempos — 30 dias</h2>
          <p class="card__desc">Conteúdo mais consistente do último mês</p>
        </div>
      </header>
      <table class="data-table data-table--ranked">
        <thead><tr><th>#</th><th>Página</th><th>Visualizações</th></tr></thead>
        <tbody>${topRows(data.top30d, max30d)}</tbody>
      </table>
    </section>
  `);
}

function pct(n: number): string {
  const v = Math.round(n * 100);
  return Number.isFinite(v) ? `${v}%` : '0%';
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
    author: post?.author ?? 'Erick Aoki',
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
