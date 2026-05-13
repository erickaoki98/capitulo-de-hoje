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
          <a href="/admin/import" class="btn">Importar WordPress</a>
          <a href="/admin/migrate-images" class="btn">Migrar imagens</a>
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

// ====== Admin: import WordPress ======
export interface ImportResult {
  imported: number;
  skipped: Array<{ slug: string; title: string; reason: string }>;
  errors: Array<{ title: string; error: string }>;
  total: number;
  imageStats?: {
    totalFound: number;
    uniqueFound: number;
    migrated: number;
    failed: Array<{ url: string; error: string }>;
    skipped: number;
  } | null;
}

export function renderAdminImport(
  env: Env,
  request: Request,
  result?: ImportResult,
  error?: string,
): string {
  const url = new URL(request.url);

  const imgStatsHtml = result?.imageStats
    ? `<div class="success">
        <p><strong>${result.imageStats.migrated}</strong> imagens enviadas para o R2 (${result.imageStats.skipped} já existiam, ${result.imageStats.failed.length} falharam) de <strong>${result.imageStats.uniqueFound}</strong> únicas encontradas.</p>
      </div>
      ${result.imageStats.failed.length > 0
        ? `<details><summary><strong>${result.imageStats.failed.length}</strong> imagens com falha</summary>
            <ul class="import-list">
              ${result.imageStats.failed.map((f) =>
                `<li><code>${escapeHtml(f.url)}</code> — <span class="muted">${escapeHtml(f.error)}</span></li>`,
              ).join('')}
            </ul>
          </details>`
        : ''}`
    : '';

  // O HTML do `result` legacy não é mais usado — o novo fluxo é totalmente
  // JS-driven com upload em chunks. Mantemos `result` no signature por compat.
  void result;

  return layout(
    {
      title: `Importar WordPress — ${env.SITE_TITLE}`,
      description: 'Importação',
      url: `${url.protocol}//${url.host}/admin/import`,
      siteTitle: env.SITE_TITLE,
      bodyClass: 'admin',
    },
    `<div class="admin-import">
      <header class="admin-header">
        <h1>Importar do WordPress</h1>
        <a href="/admin" class="btn">← Voltar</a>
      </header>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}

      <div class="import-info">
        <p>Faça upload do arquivo XML exportado pelo WordPress (<em>Ferramentas → Exportar → Todo o conteúdo</em>).</p>
        <ul>
          <li><strong>Slugs originais preservados</strong> — URLs antigas continuam funcionando via 301.</li>
          <li>Posts com slug duplicado são <strong>pulados</strong>.</li>
          <li>Páginas, attachments e revisões são ignorados — apenas posts.</li>
          <li>O arquivo é enviado em <strong>chunks de 4 MB</strong> direto pro R2 — funciona com arquivos de qualquer tamanho.</li>
          <li>Depois do import: vá em <em>Migrar imagens</em> pra baixar e salvar todas as imagens no R2.</li>
        </ul>
      </div>

      <div class="upload-panel">
        <div class="field">
          <label for="wxr-file">Arquivo XML (.xml)</label>
          <input type="file" id="wxr-file" accept=".xml,application/xml,text/xml">
        </div>
        <div class="field field--check">
          <label><input type="checkbox" id="import-drafts"> Importar rascunhos também</label>
        </div>

        <div class="upload-progress" id="upload-progress" hidden>
          <div class="migrate-progress__head">
            <strong id="up-stage">Enviando…</strong>
            <span id="up-percent" class="muted">0%</span>
          </div>
          <div class="progress-bar"><div class="progress-bar__fill" id="up-bar" style="width:0%"></div></div>
          <div class="muted" id="up-detail">—</div>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn--primary" id="up-start">Iniciar importação</button>
          <button type="button" class="btn" id="up-cancel" hidden>Cancelar</button>
        </div>

        <div id="up-result"></div>
      </div>
    </div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    file: $('wxr-file'),
    drafts: $('import-drafts'),
    start: $('up-start'),
    cancel: $('up-cancel'),
    progress: $('upload-progress'),
    bar: $('up-bar'),
    percent: $('up-percent'),
    stage: $('up-stage'),
    detail: $('up-detail'),
    result: $('up-result'),
  };

  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB
  let aborted = false;
  let uploadId = null;

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function setProgress(pct, stage, detail) {
    els.progress.hidden = false;
    els.bar.style.width = pct + '%';
    els.percent.textContent = pct + '%';
    if (stage) els.stage.textContent = stage;
    if (detail) els.detail.textContent = detail;
  }

  function setResult(html, kind) {
    els.result.innerHTML = '<div class="' + (kind || 'success') + '">' + html + '</div>';
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16),
    );
  }

  async function uploadChunk(uploadId, seq, blob, attempt = 0) {
    try {
      const res = await fetch('/admin/import/chunk/' + uploadId + '/' + seq, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      if (attempt < 2 && !aborted) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        return uploadChunk(uploadId, seq, blob, attempt + 1);
      }
      throw err;
    }
  }

  async function startUpload() {
    aborted = false;
    els.result.innerHTML = '';
    const file = els.file.files && els.file.files[0];
    if (!file) {
      setResult('Selecione um arquivo XML primeiro.', 'error');
      return;
    }
    if (!/\\.xml$/i.test(file.name)) {
      setResult('O arquivo deve ter extensão .xml.', 'error');
      return;
    }

    els.start.disabled = true;
    els.cancel.hidden = false;
    uploadId = uuid();

    const total = Math.ceil(file.size / CHUNK_SIZE);
    setProgress(0, 'Enviando…', \`0 / \${total} chunks (\${fmtBytes(file.size)} total)\`);

    try {
      // 1. Upload em chunks
      for (let i = 0; i < total; i++) {
        if (aborted) throw new Error('Cancelado pelo usuário');
        const blob = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        await uploadChunk(uploadId, i, blob);
        const pct = Math.round(((i + 1) / total) * 90); // upload = 0-90%
        setProgress(pct, 'Enviando…', \`\${i + 1} / \${total} chunks (\${fmtBytes((i + 1) * CHUNK_SIZE)} de \${fmtBytes(file.size)})\`);
      }

      // 2. Finalizar — parse + insert
      setProgress(92, 'Processando…', 'Parseando XML e inserindo posts no banco.');
      const res = await fetch('/admin/import/finalize/' + uploadId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ totalChunks: total, importDrafts: els.drafts.checked }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error('Finalize falhou: ' + errBody);
      }
      const result = await res.json();
      setProgress(100, '✓ Concluído', \`\${result.imported} posts importados\`);

      // 3. Mostra resultado
      let html = \`<p><strong>\${result.imported}</strong> posts importados de <strong>\${result.total}</strong> encontrados.</p>\`;
      if (result.skipped && result.skipped.length > 0) {
        html += '<details><summary>' + result.skipped.length + ' pulados</summary><ul class="import-list">' +
          result.skipped.slice(0, 50).map(s => '<li><code>' + s.slug + '</code> — ' + s.title + ' <span class="muted">(' + s.reason + ')</span></li>').join('') +
          (result.skipped.length > 50 ? '<li class="muted">... e mais ' + (result.skipped.length - 50) + '</li>' : '') +
          '</ul></details>';
      }
      if (result.errors && result.errors.length > 0) {
        html += '<details open><summary>' + result.errors.length + ' erros</summary><ul class="import-list">' +
          result.errors.slice(0, 20).map(e => '<li><strong>' + e.title + ':</strong> ' + e.error + '</li>').join('') +
          '</ul></details>';
      }
      html += '<p style="margin-top:1rem"><a href="/admin/migrate-images" class="btn btn--primary">Próximo passo: migrar imagens →</a></p>';
      setResult(html, result.imported > 0 ? 'success' : 'error');

    } catch (err) {
      setResult('<strong>Falhou:</strong> ' + (err.message || err), 'error');
      // tenta limpar chunks no servidor
      if (uploadId) {
        fetch('/admin/import/cancel/' + uploadId, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      }
    } finally {
      els.start.disabled = false;
      els.cancel.hidden = true;
    }
  }

  els.start.addEventListener('click', startUpload);
  els.cancel.addEventListener('click', () => { aborted = true; });
})();
</script>`,
  );
}

// ====== Admin: migrate images ======
export function renderAdminMigrate(env: Env, request: Request): string {
  const url = new URL(request.url);

  return layout(
    {
      title: `Migrar imagens — ${env.SITE_TITLE}`,
      description: 'Migração',
      url: `${url.protocol}//${url.host}/admin/migrate-images`,
      siteTitle: env.SITE_TITLE,
      bodyClass: 'admin',
    },
    `<div class="admin-migrate">
      <header class="admin-header">
        <h1>Migrar imagens para o R2</h1>
        <a href="/admin" class="btn">← Voltar</a>
      </header>

      <div class="migrate-panel">
        <div class="migrate-progress">
          <div class="migrate-progress__head">
            <strong id="mig-progress-text">Carregando…</strong>
            <span id="mig-percent" class="muted">0%</span>
          </div>
          <div class="progress-bar"><div class="progress-bar__fill" id="mig-bar" style="width:0%"></div></div>
        </div>

        <div class="migrate-stats" id="mig-stats">
          <div class="stat"><span class="stat__label">Total</span><span class="stat__value" id="mig-total">—</span></div>
          <div class="stat"><span class="stat__label">Migrados</span><span class="stat__value" id="mig-migrated">—</span></div>
          <div class="stat"><span class="stat__label">Pendentes</span><span class="stat__value" id="mig-pending">—</span></div>
          <div class="stat"><span class="stat__label">Falhas</span><span class="stat__value" id="mig-failed">0</span></div>
        </div>

        <div class="migrate-actions">
          <button type="button" class="btn btn--primary" id="mig-start">▶ Iniciar migração</button>
          <button type="button" class="btn" id="mig-pause" disabled>⏸ Pausar</button>
          <span class="migrate-status" id="mig-status">Pronto.</span>
        </div>

        <div class="migrate-log-wrap">
          <div class="migrate-log-header">
            <strong>Atividade</strong>
            <span class="muted" id="mig-elapsed"></span>
          </div>
          <ul class="migrate-log" id="mig-log" aria-live="polite"></ul>
        </div>
      </div>
    </div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    bar: $('mig-bar'),
    percent: $('mig-percent'),
    progressText: $('mig-progress-text'),
    total: $('mig-total'),
    migrated: $('mig-migrated'),
    pending: $('mig-pending'),
    failed: $('mig-failed'),
    start: $('mig-start'),
    pause: $('mig-pause'),
    status: $('mig-status'),
    log: $('mig-log'),
    elapsed: $('mig-elapsed'),
  };

  let running = false;
  let totalFailed = 0;
  let startedAt = 0;
  let elapsedTimer = null;

  function log(html, level = 'info') {
    const li = document.createElement('li');
    li.className = 'migrate-log__item migrate-log__item--' + level;
    li.innerHTML = html;
    els.log.prepend(li);
    // limita a 60 entradas
    while (els.log.children.length > 60) els.log.removeChild(els.log.lastChild);
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? \`\${m}m \${s % 60}s\` : \`\${s}s\`;
  }

  function setRunning(on) {
    running = on;
    els.start.disabled = on;
    els.pause.disabled = !on;
    els.start.textContent = on ? '▶ Rodando…' : '▶ Iniciar migração';
    if (on) {
      startedAt = Date.now();
      elapsedTimer = setInterval(() => {
        els.elapsed.textContent = fmtTime(Date.now() - startedAt);
      }, 1000);
    } else if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function updateStats(s) {
    els.total.textContent = s.totalWithImages;
    els.migrated.textContent = s.migrated;
    els.pending.textContent = s.pending;
    const total = s.totalWithImages || 1;
    const pct = Math.round((s.migrated / total) * 100);
    els.bar.style.width = pct + '%';
    els.percent.textContent = pct + '%';
    els.progressText.textContent = \`\${s.migrated} de \${s.totalWithImages} posts\`;
  }

  async function fetchStatus() {
    const r = await fetch('/admin/migrate-images/status', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('Status HTTP ' + r.status);
    return r.json();
  }

  async function runBatch() {
    const r = await fetch('/admin/migrate-images/batch', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!r.ok) throw new Error('Batch HTTP ' + r.status);
    return r.json();
  }

  async function loop() {
    setRunning(true);
    els.status.textContent = 'Migrando…';
    try {
      // status inicial
      const initial = await fetchStatus();
      updateStats(initial);
      if (initial.pending === 0) {
        els.status.textContent = '✓ Tudo migrado.';
        setRunning(false);
        return;
      }

      while (running) {
        const result = await runBatch();
        updateStats(result);

        // log dos posts processados
        for (const p of result.perPost) {
          const meta = p.migrated > 0 || p.skipped > 0
            ? \`\${p.migrated} novas, \${p.skipped} dedupe\${p.failed > 0 ? ', ' + p.failed + ' falhas' : ''}\${p.partial ? ' <em>(parcial)</em>' : ''}\`
            : (p.failed > 0 ? \`\${p.failed} falhas\` : 'sem imagens');
          const level = p.failed > 0 && p.migrated === 0 ? 'warn' : 'info';
          log(\`<span class="muted">/\${p.slug}</span> — \${meta}\`, level);
        }
        // log das falhas globais (uma amostra)
        for (const f of (result.failed || []).slice(0, 3)) {
          log(\`<span class="muted">\${f.url.slice(0, 80)}…</span> — \${f.error}\`, 'error');
        }
        totalFailed += (result.failed || []).length;
        els.failed.textContent = totalFailed;

        if (result.pending === 0) {
          log('<strong>✓ Concluído.</strong>', 'success');
          els.status.textContent = '✓ Tudo migrado.';
          setRunning(false);
          return;
        }
        if (result.processedPosts === 0) {
          // nada foi processado mas ainda tem pendentes — possivelmente todos têm imagens problemáticas
          log('<em>Lote sem progresso. Verifique falhas.</em>', 'warn');
          els.status.textContent = 'Sem progresso.';
          setRunning(false);
          return;
        }
        // pequena pausa entre lotes pra não sobrecarregar
        await new Promise(r => setTimeout(r, 300));
      }
      els.status.textContent = 'Pausado.';
    } catch (err) {
      log('<strong>Erro:</strong> ' + (err.message || err), 'error');
      els.status.textContent = 'Erro — clique em Iniciar para tentar de novo.';
      setRunning(false);
    }
  }

  els.start.addEventListener('click', loop);
  els.pause.addEventListener('click', () => {
    running = false;
    els.status.textContent = 'Pausando…';
  });

  // status inicial
  fetchStatus().then(updateStats).catch((e) => {
    els.status.textContent = 'Erro ao carregar status: ' + e.message;
  });
})();
</script>`,
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
