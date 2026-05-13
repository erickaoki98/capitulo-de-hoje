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
}

function layout(opts: LayoutOptions, body: string): string {
  const {
    title, description, url, siteTitle,
    type = 'website', pubDate, updatedDate, author,
    image, tags = [], category, jsonLd, bodyClass = '',
    headInject = '', stickyAd = '',
  } = opts;

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
<link rel="preload" href="/styles.css" as="style">
<link rel="stylesheet" href="/styles.css">
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
<body class="${bodyClass}">
<header class="site-header">
  <div class="container">
    <a href="/" class="site-logo">${escapeHtml(siteTitle)}</a>
    <nav>${bodyClass.includes('admin')
      ? '<a href="/admin">Admin</a>'
      : '<a href="/">Início</a><a href="/privacidade">Privacidade</a><a href="/rss.xml">RSS</a>'}</nav>
  </div>
</header>
<main class="container">
${body}
</main>
<footer class="site-footer">
  <div class="container">
    <p>© ${new Date().getFullYear()} ${escapeHtml(siteTitle)} · <a href="/privacidade">Política de Privacidade</a></p>
  </div>
</footer>
${stickyAd}
</body>
</html>`;
}

// ====== Home ======
export function renderHome(
  env: Env, request: Request, posts: Post[], ads?: SiteAdSettings,
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
  related: Post[] = [], ads?: SiteAdSettings,
): string {
  const url = new URL(request.url);
  const siteOrigin = siteCanonical(env, url);
  const postUrl = `${siteOrigin}/${post.slug}`;
  const tags = parseTags(post.tags);
  let html = renderMarkdown(post.content);

  // injeta ads in-content se configurado
  const pubId = ads?.publisherId;
  if (pubId && ads?.config.inContent.enabled && ads.config.inContent.slotId) {
    html = injectInContentAds(
      html, pubId, ads.config.inContent.slotId,
      ads.config.inContent.format, ads.config.inContent.everyNParagraphs ?? 4,
    );
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
  ${post.hero_image ? `<img src="${escapeHtml(post.hero_image)}" alt="" class="post__hero" loading="eager" fetchpriority="high" decoding="async">` : ''}
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
<p class="back"><a href="/">← Voltar</a></p>`;

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
      bodyClass: 'admin',
    },
    `<div class="admin-login">
      <h1>Admin</h1>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <form method="POST" action="/admin/login" autocomplete="off">
        <label>Usuário
          <input type="text" name="username" required autofocus autocomplete="username">
        </label>
        <label>Senha
          <input type="password" name="password" required autocomplete="current-password">
        </label>
        <button type="submit" class="btn btn--primary">Entrar</button>
      </form>
    </div>`,
  );
}

// ====== Admin: dashboard ======
export function renderAdminDashboard(env: Env, request: Request, posts: Post[]): string {
  const url = new URL(request.url);
  const rows = posts.length === 0
    ? `<tr><td colspan="4" class="empty">Nenhum post ainda.</td></tr>`
    : posts.map((p) => `<tr>
        <td>
          <a href="/admin/edit/${p.id}">${escapeHtml(p.title)}</a>
          <div class="muted">/p/${escapeHtml(p.slug)}</div>
        </td>
        <td><time datetime="${isoDate(p.pub_date)}">${formatDate(p.pub_date)}</time></td>
        <td>${p.draft ? '<span class="badge badge--draft">Rascunho</span>' : '<span class="badge">Publicado</span>'}</td>
        <td>
          <form method="POST" action="/admin/delete/${p.id}" onsubmit="return confirm('Excluir este post?')">
            <button type="submit" class="btn btn--danger">Excluir</button>
          </form>
        </td>
      </tr>`).join('');

  return layout(
    {
      title: `Admin — ${env.SITE_TITLE}`,
      description: 'Painel administrativo',
      url: `${url.protocol}//${url.host}/admin`,
      siteTitle: env.SITE_TITLE,
      bodyClass: 'admin',
    },
    `<div class="admin-dashboard">
      <header class="admin-header">
        <h1>Posts</h1>
        <div class="admin-actions">
          <a href="/admin/new" class="btn btn--primary">+ Novo post</a>
          <form method="POST" action="/admin/logout" style="display:inline">
            <button type="submit" class="btn">Sair</button>
          </form>
        </div>
      </header>
      ${adminTabs('posts')}
      <table class="admin-table">
        <thead>
          <tr><th>Título</th><th>Data</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`,
  );
}

// ====== Admin: shared shell with tabs ======
function adminTabs(active: 'posts' | 'settings' | 'analytics' | 'api-keys'): string {
  const links: Array<[string, string, typeof active]> = [
    ['/admin', 'Posts', 'posts'],
    ['/admin/settings', 'Configurações', 'settings'],
    ['/admin/analytics', 'Analytics', 'analytics'],
    ['/admin/api-keys', 'API Keys', 'api-keys'],
  ];
  return `<nav class="admin-tabs">${links.map(([href, label, k]) =>
    `<a class="admin-tab ${active === k ? 'is-active' : ''}" href="${href}">${label}</a>`,
  ).join('')}</nav>`;
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
  const url = new URL(request.url);
  const { publisherId, autoAds, adConfig, saved, error } = data;
  const placements: Array<{ key: keyof AdConfig; label: string; help: string; hasN?: 'paragraphs' | 'cards' }> = [
    { key: 'beforePost',   label: 'Antes do título',           help: 'Aparece acima da imagem de capa. Use com moderação.' },
    { key: 'topOfContent', label: 'Topo do conteúdo',          help: 'Logo após o título, antes do primeiro parágrafo. Alto RPM.' },
    { key: 'inContent',    label: 'No meio do texto',          help: 'A cada N parágrafos. Formato "in-article" recomendado.', hasN: 'paragraphs' },
    { key: 'afterContent', label: 'Final do conteúdo',         help: 'Após o último parágrafo, antes dos posts relacionados.' },
    { key: 'bottomOfPage', label: 'Rodapé da página',          help: 'Depois dos posts relacionados.' },
    { key: 'betweenCards', label: 'Entre cards (home)',        help: 'Insere um card de anúncio a cada N cards da listagem.', hasN: 'cards' },
    { key: 'stickyFooter', label: 'Sticky no rodapé (mobile)', help: 'Anúncio fixo na parte inferior em telas pequenas.' },
  ];

  const placementInputs = placements.map((pl) => {
    const cfg = adConfig[pl.key];
    const n = pl.hasN === 'paragraphs' ? (cfg as any).everyNParagraphs
            : pl.hasN === 'cards'      ? (cfg as any).everyNCards : null;
    return `<fieldset class="placement">
      <legend>${pl.label}</legend>
      <p class="muted">${pl.help}</p>
      <label class="placement__check">
        <input type="checkbox" name="enabled.${pl.key}" value="1" ${cfg.enabled ? 'checked' : ''}>
        Ativar
      </label>
      <div class="field-row">
        <div class="field">
          <label>Slot ID (data-ad-slot)</label>
          <input type="text" name="slot.${pl.key}" value="${escapeHtml(cfg.slotId ?? '')}" placeholder="1234567890">
        </div>
        <div class="field">
          <label>Formato</label>
          <select name="format.${pl.key}">
            ${(['auto','fluid','banner','rectangle','in-article'] as const).map((f) =>
              `<option value="${f}" ${cfg.format === f ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
        </div>
        ${pl.hasN ? `<div class="field">
          <label>${pl.hasN === 'paragraphs' ? 'A cada N parágrafos' : 'A cada N cards'}</label>
          <input type="number" name="n.${pl.key}" min="1" max="20" value="${n ?? (pl.hasN === 'paragraphs' ? 4 : 6)}">
        </div>` : ''}
      </div>
    </fieldset>`;
  }).join('');

  return layout(
    {
      title: `Configurações — ${env.SITE_TITLE}`,
      description: 'Admin',
      url: `${url.protocol}//${url.host}/admin/settings`,
      siteTitle: env.SITE_TITLE,
      bodyClass: 'admin',
    },
    `<div class="admin-import">
      <header class="admin-header">
        <h1>Configurações</h1>
        <form method="POST" action="/admin/logout" style="display:inline">
          <button type="submit" class="btn">Sair</button>
        </form>
      </header>
      ${adminTabs('settings')}
      ${saved ? `<div class="success"><p>✓ Configurações salvas.</p></div>` : ''}
      ${error ? `<div class="error"><p>${escapeHtml(error)}</p></div>` : ''}

      <form method="POST" action="/admin/settings" class="editor-form">
        <section class="settings-section">
          <h2>Google AdSense</h2>
          <p class="muted">Cole o ID do seu publisher (ex.: <code>ca-pub-1234567890123456</code>). Os slots de anúncio individuais ficam configurados na seção abaixo.</p>
          <div class="field">
            <label>Publisher ID</label>
            <input type="text" name="adsense.publisher_id" value="${escapeHtml(publisherId)}" placeholder="ca-pub-XXXXXXXXXXXXXXXX">
          </div>
          <div class="field field--check">
            <label><input type="checkbox" name="adsense.auto_ads" value="1" ${autoAds ? 'checked' : ''}> Ativar Auto Ads do Google (decide automaticamente onde inserir anúncios — pode coexistir com placements manuais)</label>
          </div>
        </section>

        <section class="settings-section">
          <h2>Inserção de Anúncios</h2>
          <p class="muted">Marque os pontos onde deseja exibir anúncios. Cada ponto precisa de um <strong>slot ID</strong> criado no painel do AdSense.</p>
          ${placementInputs}
        </section>

        <div class="form-actions">
          <button type="submit" class="btn btn--primary">Salvar configurações</button>
        </div>
      </form>
    </div>`,
  );
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
  const url = new URL(request.url);
  const max = Math.max(1, ...data.daily.map((d) => d.views));
  const chart = data.daily.length === 0 ? '<p class="muted">Sem dados ainda. As páginas visitadas começarão a aparecer aqui em alguns minutos.</p>' : `
    <div class="chart">
      ${data.daily.map((d) => `
        <div class="chart__col" title="${d.day}: ${d.views} views">
          <div class="chart__bar" style="height:${(d.views / max * 100).toFixed(1)}%"></div>
          <div class="chart__label">${d.day.slice(8)}</div>
        </div>
      `).join('')}
    </div>`;

  const topRows = (list: Array<{ path: string; views: number; title?: string }>) =>
    list.length === 0
      ? `<tr><td colspan="3" class="muted">Sem dados.</td></tr>`
      : list.map((r) => `
        <tr>
          <td class="path"><a href="${escapeHtml(r.path)}" target="_blank" rel="noopener">${escapeHtml(r.title ?? r.path)}</a><div class="muted">${escapeHtml(r.path)}</div></td>
          <td class="views">${r.views.toLocaleString('pt-BR')}</td>
        </tr>`).join('');

  return layout(
    {
      title: `Analytics — ${env.SITE_TITLE}`,
      description: 'Admin',
      url: `${url.protocol}//${url.host}/admin/analytics`,
      siteTitle: env.SITE_TITLE,
      bodyClass: 'admin',
    },
    `<div class="admin-import">
      <header class="admin-header">
        <h1>Analytics</h1>
        <form method="POST" action="/admin/logout" style="display:inline">
          <button type="submit" class="btn">Sair</button>
        </form>
      </header>
      ${adminTabs('analytics')}

      <section class="kpi-grid">
        <div class="kpi"><div class="kpi__label">Últimas 24h</div><div class="kpi__value">${data.totals.last24h.toLocaleString('pt-BR')}</div></div>
        <div class="kpi"><div class="kpi__label">Últimos 7 dias</div><div class="kpi__value">${data.totals.last7d.toLocaleString('pt-BR')}</div></div>
        <div class="kpi"><div class="kpi__label">Últimos 30 dias</div><div class="kpi__value">${data.totals.last30d.toLocaleString('pt-BR')}</div></div>
      </section>

      <section class="analytics-section">
        <h2>Visualizações por dia (últimos 30 dias)</h2>
        ${chart}
      </section>

      <section class="analytics-section">
        <h2>Top posts — últimas 48h</h2>
        <table class="admin-table">
          <thead><tr><th>Página</th><th>Views</th></tr></thead>
          <tbody>${topRows(data.top48h)}</tbody>
        </table>
      </section>

      <section class="analytics-section">
        <h2>Top posts — últimos 30 dias</h2>
        <table class="admin-table">
          <thead><tr><th>Página</th><th>Views</th></tr></thead>
          <tbody>${topRows(data.top30d)}</tbody>
        </table>
      </section>
    </div>`,
  );
}

// ====== Admin: API Keys ======
export function renderAdminApiKeys(
  env: Env, request: Request,
  keys: Array<{ id: number; name: string; key_prefix: string; created_at: number; last_used_at: number | null }>,
  newToken?: string,
): string {
  const url = new URL(request.url);
  return layout(
    {
      title: `API Keys — ${env.SITE_TITLE}`,
      description: 'Admin',
      url: `${url.protocol}//${url.host}/admin/api-keys`,
      siteTitle: env.SITE_TITLE,
      bodyClass: 'admin',
    },
    `<div class="admin-import">
      <header class="admin-header">
        <h1>API Keys</h1>
        <form method="POST" action="/admin/logout" style="display:inline">
          <button type="submit" class="btn">Sair</button>
        </form>
      </header>
      ${adminTabs('api-keys')}

      ${newToken ? `<div class="success">
        <p><strong>Token criado:</strong></p>
        <pre class="token-display">${escapeHtml(newToken)}</pre>
        <p class="muted">⚠️ Anote agora — não será exibido novamente.</p>
      </div>` : ''}

      <div class="import-info">
        <p>Use a API para publicar posts a partir de sistemas externos:</p>
        <pre class="api-example">POST https://${url.host}/api/posts
Authorization: Bearer cdh_xxxxxxxx...
Content-Type: application/json

{
  "title": "Título do post",
  "slug": "titulo-do-post",          // opcional (gerado do título)
  "description": "Resumo curto",
  "content": "&lt;p&gt;Conteúdo HTML ou markdown&lt;/p&gt;",
  "category": "Notícias",            // opcional
  "tags": ["tag1", "tag2"],          // opcional
  "author": "Erick Aoki",            // opcional
  "hero_image": "https://...",       // opcional
  "pub_date": "2026-05-13T10:00:00Z",// opcional (usa now)
  "draft": false                     // opcional
}</pre>
      </div>

      <form method="POST" action="/admin/api-keys/new" class="editor-form">
        <div class="field">
          <label>Nome da chave (descrição)</label>
          <input type="text" name="name" placeholder="ex: Bot de notícias, n8n, etc." required>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn--primary">+ Gerar nova chave</button>
        </div>
      </form>

      <h2 style="margin-top:2rem">Chaves ativas</h2>
      <table class="admin-table">
        <thead><tr><th>Nome</th><th>Prefixo</th><th>Criada</th><th>Último uso</th><th></th></tr></thead>
        <tbody>
          ${keys.length === 0 ? `<tr><td colspan="5" class="muted">Nenhuma chave ainda.</td></tr>` : keys.map((k) => `
            <tr>
              <td>${escapeHtml(k.name)}</td>
              <td><code>${escapeHtml(k.key_prefix)}…</code></td>
              <td>${formatDate(k.created_at)}</td>
              <td>${k.last_used_at ? formatDate(k.last_used_at) : '<span class="muted">nunca</span>'}</td>
              <td>
                <form method="POST" action="/admin/api-keys/delete/${k.id}" onsubmit="return confirm('Revogar essa chave?')">
                  <button class="btn btn--danger" type="submit">Revogar</button>
                </form>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`,
  );
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

  return layout(
    {
      title: `${isNew ? 'Novo post' : 'Editar'} — ${env.SITE_TITLE}`,
      description: 'Editor',
      url: `${url.protocol}//${url.host}${url.pathname}`,
      siteTitle: env.SITE_TITLE,
      bodyClass: 'admin',
    },
    `<div class="admin-editor">
      <header class="admin-header">
        <h1>${isNew ? 'Novo post' : 'Editar post'}</h1>
        <a href="/admin" class="btn">← Voltar</a>
      </header>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <form method="POST" action="${isNew ? '/admin/new' : `/admin/edit/${post?.id}`}" class="editor-form">
        <div class="field">
          <label>Título</label>
          <input type="text" name="title" value="${escapeHtml(data.title)}" required>
        </div>
        <div class="field">
          <label>Slug (URL)</label>
          <input type="text" name="slug" value="${escapeHtml(data.slug)}" placeholder="auto-gerado se vazio" pattern="[a-z0-9-]*">
        </div>
        <div class="field">
          <label>Descrição (resumo)</label>
          <textarea name="description" rows="2">${escapeHtml(data.description)}</textarea>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Categoria</label>
            <input type="text" name="category" value="${escapeHtml(data.category ?? '')}">
          </div>
          <div class="field">
            <label>Tags (separadas por vírgula)</label>
            <input type="text" name="tags" value="${escapeHtml(data.tags)}">
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
          <label>Imagem de capa (URL)</label>
          <input type="url" name="hero_image" value="${escapeHtml(data.hero_image ?? '')}" placeholder="https://...">
        </div>
        <div class="field">
          <label>Conteúdo (Markdown)</label>
          <textarea name="content" rows="20" class="editor-content">${escapeHtml(data.content)}</textarea>
        </div>
        <div class="field field--check">
          <label><input type="checkbox" name="draft" value="1" ${data.draft ? 'checked' : ''}> Salvar como rascunho</label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn--primary">${isNew ? 'Criar post' : 'Salvar alterações'}</button>
        </div>
      </form>
    </div>`,
  );
}
