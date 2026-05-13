import type { Env, Post } from './types';
import { renderMarkdown, readingTime } from './markdown';

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
}

function layout(opts: LayoutOptions, body: string): string {
  const {
    title, description, url, siteTitle,
    type = 'website', pubDate, updatedDate, author,
    image, tags = [], category, jsonLd, bodyClass = '',
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
</head>
<body class="${bodyClass}">
<header class="site-header">
  <div class="container">
    <a href="/" class="site-logo">${escapeHtml(siteTitle)}</a>
    <nav>${bodyClass.includes('admin')
      ? '<a href="/admin">Admin</a>'
      : '<a href="/">Início</a><a href="/rss.xml">RSS</a>'}</nav>
  </div>
</header>
<main class="container">
${body}
</main>
<footer class="site-footer">
  <div class="container">© ${new Date().getFullYear()} ${escapeHtml(siteTitle)}</div>
</footer>
</body>
</html>`;
}

// ====== Home ======
export function renderHome(env: Env, request: Request, posts: Post[]): string {
  const url = new URL(request.url);
  const siteUrl = siteCanonical(env, url);

  const cards = posts
    .map((p, i) => {
      const tags = parseTags(p.tags);
      const eager = i < 2;
      return `<article class="post-card">
        ${p.hero_image ? `<a href="/${escapeHtml(p.slug)}" class="post-card__image"><img src="${escapeHtml(p.hero_image)}" alt="" loading="${eager ? 'eager' : 'lazy'}" ${eager ? 'fetchpriority="high"' : ''} decoding="async"></a>` : ''}
        <div class="post-card__body">
          ${p.category ? `<div class="post-card__category">${escapeHtml(p.category)}</div>` : ''}
          <h2 class="post-card__title"><a href="/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></h2>
          <p class="post-card__desc">${escapeHtml(p.description)}</p>
          <div class="post-card__meta">
            <time datetime="${isoDate(p.pub_date)}">${formatDate(p.pub_date)}</time>
            ${tags.length ? `<span class="dot">·</span><span>${tags.map((t) => escapeHtml(t)).join(', ')}</span>` : ''}
          </div>
        </div>
      </article>`;
    })
    .join('');

  const body = posts.length === 0
    ? `<div class="empty"><p>Ainda não há posts. <a href="/admin">Criar o primeiro</a>.</p></div>`
    : `<section class="posts-list">${cards}</section>`;

  return layout(
    {
      title: env.SITE_TITLE,
      description: env.SITE_DESCRIPTION,
      url: siteUrl + '/',
      siteTitle: env.SITE_TITLE,
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
export function renderPost(env: Env, request: Request, post: Post): string {
  const url = new URL(request.url);
  const siteOrigin = siteCanonical(env, url);
  const postUrl = `${siteOrigin}/${post.slug}`;
  const tags = parseTags(post.tags);
  const html = renderMarkdown(post.content);

  const body = `
<article class="post">
  ${post.hero_image ? `<img src="${escapeHtml(post.hero_image)}" alt="" class="post__hero" loading="eager" fetchpriority="high" decoding="async">` : ''}
  <header class="post__header">
    ${post.category ? `<div class="post__category">${escapeHtml(post.category)}</div>` : ''}
    <h1 class="post__title">${escapeHtml(post.title)}</h1>
    <div class="post__meta">
      <time datetime="${isoDate(post.pub_date)}">${formatDate(post.pub_date)}</time>
      <span>·</span>
      <span>${escapeHtml(post.author)}</span>
      <span>·</span>
      <span>${readingTime(post.content)}</span>
    </div>
    ${tags.length ? `<div class="tag-list">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
  </header>
  <div class="prose">${html}</div>
</article>
<p class="back"><a href="/">← Voltar</a></p>`;

  const heroAbs = post.hero_image
    ? (post.hero_image.startsWith('http') ? post.hero_image : `${siteOrigin}${post.hero_image}`)
    : undefined;

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
      <table class="admin-table">
        <thead>
          <tr><th>Título</th><th>Data</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
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
