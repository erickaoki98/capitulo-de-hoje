import type { Env, Post, PostInput } from './types';
import {
  listPosts, getPostBySlug, getPostById,
  createPost, updatePost, deletePost,
  upsertRedirect, findRedirect,
  countPostsWithExternalImages, countPostsWithAnyImages,
  nextPostsToMigrate, updatePostContent, markPostsMigrated,
  createPostsBatch, upsertRedirectsBatch, existingSlugs,
  getSetting, setSetting, getAllSettings,
  recordPageview, topPostsByViews, getPostsBySlugList, viewsForPath,
  pageviewsSummary, pageviewsByDay,
  listApiKeys, insertApiKey, findApiKeyByHash, touchApiKey, deleteApiKey,
  countPublishedPosts, countPostsSummary, listPostsForSitemap,
  ensureActiveVisitorsTable, recordHeartbeat, countActiveVisitors, cleanupStaleVisitors,
} from './db';
import {
  renderHome, renderPost, render404, renderPrivacy, renderDocs,
  renderLogin, renderAdminDashboard, renderAdminPosts, renderAdminEditor,
  renderAdminSettings, renderAdminConfiguracoes, renderAdminAnalytics, renderAdminApiKeys,
  renderAdminCache,
  type SiteAdSettings, type SiteTypography,
} from './render';
import {
  readCache, writeCache, bumpCacheVersion, cacheStatus,
} from './cache';
import { parseWxr, streamWxrCollect } from './wxr';
import type { WxrPost } from './wxr';
import {
  extractImageUrls, rewriteHtmlUrls, migrateImagesWithBudget,
} from './images';
import type { ImageMigrationStats } from './images';
import { optimizeImage, shouldOptimize } from './imageopt';
import { parseAdConfig, renderAdsTxt, type AdConfig, DEFAULT_AD_CONFIG } from './adsense';
import { generateApiKey, sha256 } from './apikey';
import {
  createSession, sessionCookie, clearSessionCookie, requireAuth,
} from './auth';
import { excerpt, sanitizeDescription } from './markdown';

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const PUBLIC_CACHE_HEADERS = {
  ...HTML_HEADERS,
  'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
};

const NO_CACHE_HEADERS = {
  ...HTML_HEADERS,
  'Cache-Control': 'private, no-store',
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function parseFormData(request: Request): Promise<FormData> {
  return await request.formData();
}

function buildPostInput(form: FormData, fallbackPubDate: number): PostInput {
  const title = String(form.get('title') ?? '').trim();
  let slug = String(form.get('slug') ?? '').trim();
  if (!slug && title) slug = slugify(title);
  const content = String(form.get('content') ?? '');
  const description = String(form.get('description') ?? '').trim() || excerpt(content);
  const category = String(form.get('category') ?? '').trim() || null;
  const tags = String(form.get('tags') ?? '').trim();
  const author = String(form.get('author') ?? '').trim() || 'Erick Aoki';
  const hero_image = String(form.get('hero_image') ?? '').trim() || null;
  const draft = form.get('draft') ? 1 : 0;
  const pubDateStr = String(form.get('pub_date') ?? '').trim();
  const pub_date = pubDateStr ? new Date(pubDateStr).getTime() : fallbackPubDate;
  return { title, slug, description, content, category, tags, author, hero_image, draft, pub_date };
}

function validatePostInput(input: PostInput): string | null {
  if (!input.title) return 'O título é obrigatório.';
  if (!input.slug) return 'O slug é obrigatório.';
  if (!/^[a-z0-9-]+$/.test(input.slug)) return 'O slug só pode conter letras minúsculas, números e hífens.';
  if (!input.content.trim()) return 'O conteúdo é obrigatório.';
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      // ===== www → apex redirect =====
      if (url.hostname.startsWith('www.')) {
        const dest = new URL(url.toString());
        dest.hostname = dest.hostname.replace(/^www\./, '');
        return Response.redirect(dest.toString(), 301);
      }

      // ===== Static assets (CSS, favicon, etc) =====
      if (pathname.startsWith('/styles.css') || pathname.startsWith('/favicon')) {
        const res = await env.ASSETS.fetch(request);
        const headers = new Headers(res.headers);
        // URLs versionadas (?v=cssVersion()) podem ser immutable: o ?v muda a cada
        // deploy, então nunca servem CSS velho. Sem ?v (acesso direto/raro): cache curto.
        const hasVersion = url.searchParams.has('v');
        headers.set(
          'Cache-Control',
          hasVersion
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'
        );
        return new Response(res.body, { status: res.status, headers });
      }

      // ===== R2 images: /img/<filename> (com otimização WebP on-the-fly) =====
      if (pathname.startsWith('/img/') && (request.method === 'GET' || request.method === 'HEAD')) {
        const key = pathname.slice(5);
        if (!key || key.includes('/') || key.includes('..')) {
          return new Response('Not found', { status: 404 });
        }
        const ifNoneMatch = request.headers.get('If-None-Match');
        const acceptsWebp = (request.headers.get('Accept') || '').includes('image/webp');
        const noOpt = url.searchParams.get('orig') === '1';
        const isPng = /\.png$/i.test(key);
        // Chave do derivado otimizado no R2. Versão 3 (_opt3) força regeneração dos
        // derivados: a v2 gerava WebP lossless (~1MB em fotos); a v3 também tenta
        // JPEG q80 para PNGs opacos, escolhendo o menor (heroes ~1MB → ~150KB).
        // Bump de versão = não-destrutivo; os _opt2 antigos viram órfãos inofensivos.
        const optKey = `_opt3/${key}.webp`;

        if (request.method === 'HEAD') {
          const meta = await env.IMAGES.head(key);
          if (!meta) return new Response(null, { status: 404 });
          const h = new Headers();
          meta.writeHttpMetadata(h);
          h.set('etag', meta.httpEtag);
          h.set('Cache-Control', 'public, max-age=31536000, immutable');
          h.set('Content-Length', String(meta.size));
          if (ifNoneMatch === meta.httpEtag) return new Response(null, { status: 304, headers: h });
          return new Response(null, { status: 200, headers: h });
        }

        // 1) Browser moderno (WebP) e não pediu original explicitamente:
        //    tenta servir o derivado otimizado já cacheado no R2.
        if (acceptsWebp && !noOpt) {
          const cachedOpt = await env.IMAGES.get(optKey);
          if (cachedOpt) {
            const h = new Headers();
            cachedOpt.writeHttpMetadata(h);
            h.set('etag', cachedOpt.httpEtag);
            h.set('Cache-Control', 'public, max-age=31536000, immutable');
            h.set('Vary', 'Accept');
            h.set('X-Image-Opt', 'hit');
            if (ifNoneMatch === cachedOpt.httpEtag) return new Response(null, { status: 304, headers: h });
            return new Response(cachedOpt.body, { headers: h });
          }
        }

        // 2) Carrega a original.
        const obj = await env.IMAGES.get(key);
        if (!obj) return new Response('Not found', { status: 404 });

        // 3) Se elegível, otimiza on-the-fly, guarda o derivado no R2 e serve.
        //    IMPORTANTE: ler obj.arrayBuffer() consome obj.body — por isso, se a
        //    otimização não compensar, servimos `buf` (bytes já lidos), NUNCA obj.body.
        if (acceptsWebp && !noOpt && shouldOptimize(key, obj.size, acceptsWebp)) {
          const buf = await obj.arrayBuffer();
          let opt: ReturnType<typeof optimizeImage> = null;
          try { opt = optimizeImage(buf, isPng); } catch { opt = null; }
          if (opt) {
            ctx.waitUntil(
              env.IMAGES.put(optKey, opt.bytes, {
                httpMetadata: { contentType: opt.contentType, cacheControl: 'public, max-age=31536000, immutable' },
              }).catch(() => {}),
            );
            const h = new Headers();
            h.set('Content-Type', opt.contentType);
            h.set('Cache-Control', 'public, max-age=31536000, immutable');
            h.set('Vary', 'Accept');
            h.set('X-Image-Opt', 'miss');
            return new Response(opt.bytes, { headers: h });
          }
          // Otimização não compensou/falhou → serve os bytes originais já lidos.
          const h = new Headers();
          obj.writeHttpMetadata(h);
          h.set('etag', obj.httpEtag);
          h.set('Cache-Control', 'public, max-age=31536000, immutable');
          h.set('Vary', 'Accept');
          h.set('X-Image-Opt', 'skip');
          return new Response(buf, { headers: h });
        }

        // 4) Não elegível (SVG/GIF/pequena/sem webp): serve a original (stream intacto).
        const headers = new Headers();
        obj.writeHttpMetadata(headers);
        headers.set('etag', obj.httpEtag);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Vary', 'Accept');
        if (ifNoneMatch === obj.httpEtag) {
          return new Response(null, { status: 304, headers });
        }
        return new Response(obj.body, { headers });
      }

      // ===== Public: home =====
      if (pathname === '/' && request.method === 'GET') {
        const cached = await readCache(env, request);
        if (cached) {
          ctx.waitUntil(recordPageview(env.DB, '/').catch(() => {}));
          return cached;
        }
        const [posts, ads, typo, gaId] = await Promise.all([
          listPosts(env.DB, { includeDrafts: false, limit: 60 }),
          loadAdSettings(env),
          loadTypography(env),
          loadGaId(env), // PROTEÇÃO ANALYTICS: gaId precisa chegar no render (ver loadGaId)
        ]);
        ctx.waitUntil(recordPageview(env.DB, '/').catch(() => {}));
        const resp = new Response(renderHome(env, request, posts, ads, typo, gaId), { headers: PUBLIC_CACHE_HEADERS });
        return writeCache(env, ctx, request, resp);
      }

      // ===== Public: privacy =====
      if (pathname === '/privacidade' && request.method === 'GET') {
        const cached = await readCache(env, request);
        if (cached) {
          ctx.waitUntil(recordPageview(env.DB, '/privacidade').catch(() => {}));
          return cached;
        }
        ctx.waitUntil(recordPageview(env.DB, '/privacidade').catch(() => {}));
        const resp = new Response(renderPrivacy(env, request), { headers: PUBLIC_CACHE_HEADERS });
        return writeCache(env, ctx, request, resp);
      }

      // ===== Public: docs =====
      if (pathname === '/doc' && request.method === 'GET') {
        const cached = await readCache(env, request);
        if (cached) return cached;
        const resp = new Response(renderDocs(env, request), { headers: PUBLIC_CACHE_HEADERS });
        return writeCache(env, ctx, request, resp);
      }

      // ===== Cartões descontinuado: /cartoes e redirects de afiliado → home (301) =====
      if (pathname === '/cartoes'
          || pathname.startsWith('/ir/cartao/')
          || pathname.startsWith('/ir/promo/')) {
        return Response.redirect(`${url.protocol}//${url.host}/`, 301);
      }

      // ===== Legacy WP: /?p=123 (shortlinks por ID) =====
      if ((request.method === 'GET' || request.method === 'HEAD') && url.searchParams.has('p')) {
        const wpId = url.searchParams.get('p');
        if (wpId && /^\d+$/.test(wpId)) {
          const target = await findRedirect(env.DB, `/?p=${wpId}`);
          if (target) {
            return Response.redirect(`${url.protocol}//${url.host}/${target}`, 301);
          }
        }
      }

      // ===== WP bot targets → 410 Gone =====
      if (/^\/(wp-login\.php|wp-admin|xmlrpc\.php|wp-cron\.php|wp-comments-post\.php|trackback)(\/|$)/.test(pathname)) {
        return new Response('Gone', { status: 410, headers: { 'Cache-Control': 'public, max-age=86400' } });
      }

      // ===== Legacy /p/<slug> → 301 to /<slug> =====
      if (pathname.startsWith('/p/') && (request.method === 'GET' || request.method === 'HEAD')) {
        const slug = pathname.slice(3).replace(/\/$/, '');
        return Response.redirect(`${url.protocol}//${url.host}/${slug}`, 301);
      }

      // ===== Legacy WordPress redirects =====
      // /category/<name>/ → home (WP usava categorias; nosso site não tem páginas de categoria)
      if (pathname.startsWith('/category/') && (request.method === 'GET' || request.method === 'HEAD')) {
        return Response.redirect(`${url.protocol}//${url.host}/`, 301);
      }
      // /author/<name>/ → home
      if (pathname.startsWith('/author/') && (request.method === 'GET' || request.method === 'HEAD')) {
        return Response.redirect(`${url.protocol}//${url.host}/`, 301);
      }
      // /tag/<name>/ → home (WP tag archives)
      if (pathname.startsWith('/tag/') && (request.method === 'GET' || request.method === 'HEAD')) {
        return Response.redirect(`${url.protocol}//${url.host}/`, 301);
      }
      // /page/<n>/ → home (WP pagination)
      if (pathname.startsWith('/page/') && (request.method === 'GET' || request.method === 'HEAD')) {
        return Response.redirect(`${url.protocol}//${url.host}/`, 301);
      }
      // WP pages: sobre-nos, contato, termos-de-uso, politica-de-privacidade → /privacidade ou home
      if (/^\/(sobre-nos|contato|termos-de-uso|politica-de-privacidade)\/?$/.test(pathname)) {
        const dest = pathname.startsWith('/termos') || pathname.startsWith('/politica')
          ? '/privacidade'
          : '/';
        return Response.redirect(`${url.protocol}//${url.host}${dest}`, 301);
      }
      // /feed/, /feed/rss2/, etc → /rss.xml
      if (/^\/feed(\/.*)?$/.test(pathname) && (request.method === 'GET' || request.method === 'HEAD')) {
        return Response.redirect(`${url.protocol}//${url.host}/rss.xml`, 301);
      }
      // /wp-content/* → 410 Gone (old media paths)
      if (pathname.startsWith('/wp-content/') || pathname.startsWith('/wp-includes/') || pathname.startsWith('/wp-json/')) {
        return new Response('Gone', { status: 410, headers: { 'Cache-Control': 'public, max-age=86400' } });
      }

      // ===== robots.txt =====
      if (pathname === '/robots.txt' && request.method === 'GET') {
        const canonical = canonicalUrl(env, url);
        const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/

Sitemap: ${canonical}/sitemap.xml
`;
        return new Response(robots, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }

      // ===== ads.txt (AdSense — IAB Authorized Digital Sellers) =====
      if (pathname === '/ads.txt' && request.method === 'GET') {
        const adSettings = await loadAdSettings(env);
        if (adSettings?.publisherId) {
          return new Response(renderAdsTxt(adSettings.publisherId), {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'public, max-age=86400',
            },
          });
        }
        return new Response('', { status: 404 });
      }

      // ===== Sitemap index =====
      if (pathname === '/sitemap.xml' && request.method === 'GET') {
        const cached = await readCache(env, request);
        if (cached) return cached;
        const total = await countPublishedPosts(env.DB);
        const SITEMAP_PAGE_SIZE = 1000;
        const pages = Math.max(1, Math.ceil(total / SITEMAP_PAGE_SIZE));
        const base = canonicalUrl(env, url);
        const sitemaps = [];
        for (let i = 1; i <= pages; i++) {
          sitemaps.push(`<sitemap><loc>${base}/sitemap-${i}.xml</loc></sitemap>`);
        }
        // Inclui sitemap de páginas estáticas
        sitemaps.push(`<sitemap><loc>${base}/sitemap-pages.xml</loc></sitemap>`);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.join('\n')}
</sitemapindex>`;
        const resp = new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        });
        return writeCache(env, ctx, request, resp);
      }

      // ===== Sitemap de posts paginado: /sitemap-{n}.xml =====
      const sitemapMatch = pathname.match(/^\/sitemap-(\d+)\.xml$/);
      if (sitemapMatch && request.method === 'GET') {
        const cached = await readCache(env, request);
        if (cached) return cached;
        const page = Number(sitemapMatch[1]);
        const SITEMAP_PAGE_SIZE = 1000;
        const offset = (page - 1) * SITEMAP_PAGE_SIZE;
        const posts = await listPostsForSitemap(env.DB, SITEMAP_PAGE_SIZE, offset);
        if (posts.length === 0) {
          return new Response(render404(env, request), { status: 404, headers: HTML_HEADERS });
        }
        const base = canonicalUrl(env, url);
        const urls = posts.map((p) =>
          `<url><loc>${base}/${p.slug}</loc><lastmod>${new Date(p.updated_date || p.pub_date).toISOString()}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`
        );
        // Primeira página inclui a home
        if (page === 1) {
          urls.unshift(`<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`);
        }
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
        const resp = new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        });
        return writeCache(env, ctx, request, resp);
      }

      // ===== Sitemap de páginas estáticas =====
      if (pathname === '/sitemap-pages.xml' && request.method === 'GET') {
        const cached = await readCache(env, request);
        if (cached) return cached;
        const base = canonicalUrl(env, url);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
<url><loc>${base}/privacidade</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>
</urlset>`;
        const resp = new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
          },
        });
        return writeCache(env, ctx, request, resp);
      }

      // ===== RSS feed =====
      if (pathname === '/rss.xml' && request.method === 'GET') {
        const cached = await readCache(env, request);
        if (cached) return cached;
        const posts = await listPosts(env.DB, { includeDrafts: false, limit: 50 });
        const siteUrl = canonicalUrl(env, url);
        const items = posts.map((p) => `
  <item>
    <title>${escapeXml(p.title)}</title>
    <link>${siteUrl}/${p.slug}</link>
    <guid>${siteUrl}/${p.slug}</guid>
    <pubDate>${new Date(p.pub_date).toUTCString()}</pubDate>
    <description>${escapeXml(p.description)}</description>
  </item>`).join('');
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${escapeXml(env.SITE_TITLE)}</title>
<link>${siteUrl}</link>
<description>${escapeXml(env.SITE_DESCRIPTION)}</description>
<language>pt-BR</language>${items}
</channel></rss>`;
        const resp = new Response(xml, {
          headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          },
        });
        return writeCache(env, ctx, request, resp);
      }

      // ===== Admin: login (GET) / Dashboard =====
      if (pathname === '/admin' && request.method === 'GET') {
        const authed = await requireAuth(request, env.SESSION_SECRET);
        if (!authed) {
          return new Response(renderLogin(env, request), { headers: NO_CACHE_HEADERS });
        }
        // Carrega dados pro dashboard em paralelo
        await ensureActiveVisitorsTable(env.DB);
        const [recent, postCounts, summary24h, top24h, activeNow] = await Promise.all([
          listPosts(env.DB, { includeDrafts: true, limit: 6 }),
          // Contagem via SQL (não derivar de uma lista limitada — travava em 500).
          countPostsSummary(env.DB),
          pageviewsSummary(env.DB, 24),
          topPostsByViews(env.DB, 24, 5),
          countActiveVisitors(env.DB),
        ]);
        const { total, published, drafts } = postCounts;
        // enrich top with titles
        const topSlugs = top24h.map((t) => t.path.replace(/^\//, ''));
        const topPostsData = topSlugs.length ? await getPostsBySlugList(env.DB, topSlugs) : [];
        const titleMap = new Map(topPostsData.map((p) => [p.slug, p.title]));
        const topToday = top24h.map((t) => ({
          path: t.path,
          views: t.views,
          title: titleMap.get(t.path.replace(/^\//, '')),
        }));
        return new Response(renderAdminDashboard(env, request, {
          stats: {
            total,
            published,
            drafts,
            views24h: summary24h.total ?? 0,
            activeVisitors: activeNow,
          },
          recent,
          topToday,
        }), { headers: NO_CACHE_HEADERS });
      }

      // ===== Admin: Posts list =====
      if (pathname === '/admin/posts' && request.method === 'GET') {
        const authed = await requireAuth(request, env.SESSION_SECRET);
        if (!authed) return redirectToLogin();
        const posts = await listPosts(env.DB, { includeDrafts: true, limit: 500 });
        const q = url.searchParams.get('q') ?? '';
        const statusParam = url.searchParams.get('status');
        const status = (statusParam === 'published' || statusParam === 'draft') ? statusParam : 'all';
        return new Response(renderAdminPosts(env, request, posts, { q, status }), {
          headers: NO_CACHE_HEADERS,
        });
      }

      // ===== Admin: login (POST) =====
      if (pathname === '/admin/login' && request.method === 'POST') {
        const form = await parseFormData(request);
        const username = String(form.get('username') ?? '').trim();
        const password = String(form.get('password') ?? '');
        if (username !== env.ADMIN_USERNAME || password !== env.ADMIN_PASSWORD) {
          return new Response(renderLogin(env, request, 'Usuário ou senha incorretos.'), {
            status: 401,
            headers: NO_CACHE_HEADERS,
          });
        }
        const token = await createSession(env.SESSION_SECRET);
        return new Response(null, {
          status: 303,
          headers: { Location: '/admin', 'Set-Cookie': sessionCookie(token) },
        });
      }

      // ===== Admin: logout =====
      if (pathname === '/admin/logout' && request.method === 'POST') {
        return new Response(null, {
          status: 303,
          headers: { Location: '/admin', 'Set-Cookie': clearSessionCookie() },
        });
      }

      // ===== Everything below requires auth =====
      const authed = await requireAuth(request, env.SESSION_SECRET);

      // ===== Admin: new post (GET form) =====
      if (pathname === '/admin/new' && request.method === 'GET') {
        if (!authed) return redirectToLogin();
        return new Response(renderAdminEditor(env, request, null), { headers: NO_CACHE_HEADERS });
      }

      // ===== Admin: new post (POST) =====
      if (pathname === '/admin/new' && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        const form = await parseFormData(request);
        const input = buildPostInput(form, Date.now());
        const err = validatePostInput(input);
        if (err) {
          return new Response(renderAdminEditor(env, request, { ...input } as any, err), {
            status: 400,
            headers: NO_CACHE_HEADERS,
          });
        }
        // checa slug duplicado
        const existing = await getPostBySlug(env.DB, input.slug);
        if (existing) {
          return new Response(renderAdminEditor(env, request, { ...input } as any, 'Já existe um post com esse slug.'), {
            status: 400, headers: NO_CACHE_HEADERS,
          });
        }
        await createPost(env.DB, input);
        return new Response(null, { status: 303, headers: { Location: '/admin' } });
      }

      // ===== Admin: edit post (GET form) =====
      const editMatch = pathname.match(/^\/admin\/edit\/(\d+)$/);
      if (editMatch && request.method === 'GET') {
        if (!authed) return redirectToLogin();
        const post = await getPostById(env.DB, Number(editMatch[1]));
        if (!post) return new Response(render404(env, request), { status: 404, headers: HTML_HEADERS });
        return new Response(renderAdminEditor(env, request, post), { headers: NO_CACHE_HEADERS });
      }

      // ===== Admin: edit post (POST) =====
      if (editMatch && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        const id = Number(editMatch[1]);
        const existing = await getPostById(env.DB, id);
        if (!existing) return new Response(render404(env, request), { status: 404, headers: HTML_HEADERS });
        const form = await parseFormData(request);
        const input = buildPostInput(form, existing.pub_date);
        const err = validatePostInput(input);
        if (err) {
          return new Response(renderAdminEditor(env, request, { ...input, id } as any, err), {
            status: 400, headers: NO_CACHE_HEADERS,
          });
        }
        // checa slug duplicado (mas permite o próprio post)
        const dup = await getPostBySlug(env.DB, input.slug);
        if (dup && dup.id !== id) {
          return new Response(renderAdminEditor(env, request, { ...input, id } as any, 'Já existe outro post com esse slug.'), {
            status: 400, headers: NO_CACHE_HEADERS,
          });
        }
        await updatePost(env.DB, id, input);
        return new Response(null, { status: 303, headers: { Location: '/admin' } });
      }

      // ===== Admin: import — endpoint legado (compat com curl simples) =====
      // Aceita POST direto se o arquivo for pequeno o suficiente.
      // Estratégia chunked é via /admin/import/chunk + /admin/import/finalize.
      if (pathname === '/admin/import' && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        try {
          const ct = request.headers.get('Content-Type') || '';
          let xml: string;
          let importDrafts = false;
          if (ct.startsWith('multipart/form-data')) {
            const form = await parseFormData(request);
            const file = form.get('wxr');
            if (!file || typeof file === 'string' || typeof (file as Blob).text !== 'function') {
              return new Response(JSON.stringify({ error: 'Nenhum arquivo enviado.' }), {
                status: 400, headers: { 'Content-Type': 'application/json' },
              });
            }
            importDrafts = form.get('import_drafts') === '1';
            xml = await (file as Blob).text();
          } else {
            // raw body (application/xml ou octet-stream)
            xml = await request.text();
          }
          const posts = parseWxr(xml);
          const result = await importPostsBatch(env, posts, importDrafts);
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (e: unknown) {
          return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
            status: 500, headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // ===== Admin: chunked upload — recebe um chunk e salva no R2 =====
      // PUT /admin/import/chunk/<uploadId>/<seq>
      const chunkMatch = pathname.match(/^\/admin\/import\/chunk\/([a-f0-9-]{8,})\/(\d+)$/);
      if (chunkMatch && request.method === 'PUT') {
        if (!authed) return new Response('{"error":"unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } });
        const [, uploadId, seqStr] = chunkMatch;
        const seq = Number(seqStr);
        if (seq > 9999) return new Response('{"error":"chunk seq too high"}', { status: 400 });
        const key = `_imports/${uploadId}/${seq.toString().padStart(5, '0')}.bin`;
        if (!request.body) return new Response('{"error":"empty body"}', { status: 400 });
        await env.IMAGES.put(key, request.body);
        return new Response(JSON.stringify({ ok: true, seq }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ===== Admin: finalize — junta chunks, faz parse streaming, insere =====
      // POST /admin/import/finalize/<uploadId>
      const finalMatch = pathname.match(/^\/admin\/import\/finalize\/([a-f0-9-]{8,})$/);
      if (finalMatch && request.method === 'POST') {
        if (!authed) return new Response('{"error":"unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } });
        const [, uploadId] = finalMatch;
        try {
          const { totalChunks, importDrafts } = await request.json<{ totalChunks: number; importDrafts: boolean }>();
          if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 9999) {
            return new Response('{"error":"invalid totalChunks"}', { status: 400 });
          }
          // Single-pass: lê chunks do R2 em stream, parseia, coleta posts
          const stream = await buildChunkStream(env.IMAGES, uploadId, totalChunks);
          const posts = await streamWxrCollect(stream);
          // Insere em batch
          const result = await importPostsBatch(env, posts, !!importDrafts);
          // Cleanup chunks
          await cleanupChunks(env.IMAGES, uploadId, totalChunks);
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (e: unknown) {
          // tenta limpar mesmo em erro
          try {
            const totalChunks = await request.clone().json<{ totalChunks: number }>().then((d) => d.totalChunks).catch(() => 0);
            if (totalChunks) await cleanupChunks(env.IMAGES, uploadId, totalChunks);
          } catch {/* ignore */}
          return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
            status: 500, headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // ===== Admin: cancel chunked upload =====
      const cancelMatch = pathname.match(/^\/admin\/import\/cancel\/([a-f0-9-]{8,})$/);
      if (cancelMatch && request.method === 'POST') {
        if (!authed) return new Response('{"error":"unauthorized"}', { status: 401 });
        // best-effort: lista e deleta tudo abaixo do prefix
        const list = await env.IMAGES.list({ prefix: `_imports/${cancelMatch[1]}/` });
        for (const obj of list.objects) await env.IMAGES.delete(obj.key);
        return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
      }

      // ===== Admin: migrate images status (JSON) — usado por script externo =====
      if (pathname === '/admin/migrate-images/status' && request.method === 'GET') {
        if (!authed) return new Response('{"error":"unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } });
        const [pending, totalWithImages] = await Promise.all([
          countPostsWithExternalImages(env.DB),
          countPostsWithAnyImages(env.DB),
        ]);
        return new Response(JSON.stringify({
          pending,
          totalWithImages,
          migrated: totalWithImages - pending,
        }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      }

      // ===== Admin: migrate images batch (JSON) — processa um lote =====
      if (pathname === '/admin/migrate-images/batch' && request.method === 'POST') {
        if (!authed) return new Response('{"error":"unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } });

        const result = await runImageMigrationBatch(env, 25);
        return new Response(JSON.stringify({
          processedPosts: result.batchSize,
          perPost: result.perPost,
          failed: result.failed.slice(0, 20),
          elapsedMs: result.elapsedMs,
          pending: result.pending,
          totalWithImages: result.totalWithImages,
          migrated: result.migrated,
        }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      }

      // ============= Admin: Settings (Monetização) =============
      if (pathname === '/admin/settings' && request.method === 'GET') {
        if (!authed) return redirectToLogin();
        const settings = await getAllSettings(env.DB);
        return new Response(renderAdminSettings(env, request, {
          publisherId: settings['adsense.publisher_id'] ?? '',
          autoAds: settings['adsense.auto_ads'] === '1',
          adConfig: parseAdConfig(settings['adsense.placements'] ?? null),
          saved: url.searchParams.get('saved') === '1',
        }), { headers: NO_CACHE_HEADERS });
      }

      if (pathname === '/admin/settings' && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        const form = await request.formData();
        const pubId = String(form.get('adsense.publisher_id') ?? '').trim();
        const autoAds = form.get('adsense.auto_ads') === '1' ? '1' : '0';
        const cfg: AdConfig = { ...DEFAULT_AD_CONFIG };
        for (const key of Object.keys(cfg) as Array<keyof AdConfig>) {
          const enabled = form.get(`enabled.${key}`) === '1';
          const slot = String(form.get(`slot.${key}`) ?? '').trim() || undefined;
          const format = String(form.get(`format.${key}`) ?? 'auto') as any;
          const n = Number(form.get(`n.${key}`));
          (cfg as any)[key] = {
            enabled, slotId: slot, format,
            ...(key === 'inContent' ? { everyNParagraphs: Number.isFinite(n) && n > 0 ? n : 4 } : {}),
            ...(key === 'betweenCards' ? { everyNCards: Number.isFinite(n) && n > 0 ? n : 6 } : {}),
          };
        }
        await Promise.all([
          setSetting(env.DB, 'adsense.publisher_id', pubId),
          setSetting(env.DB, 'adsense.auto_ads', autoAds),
          setSetting(env.DB, 'adsense.placements', JSON.stringify(cfg)),
        ]);
        await bumpCacheVersion(env);
        return new Response(null, { status: 303, headers: { Location: '/admin/settings?saved=1' } });
      }

      // ============= Admin: Configurações (Typography) =============
      if (pathname === '/admin/configuracoes' && request.method === 'GET') {
        if (!authed) return redirectToLogin();
        const [t, b] = await Promise.all([
          getSetting(env.DB, 'typography.title_scale'),
          getSetting(env.DB, 'typography.body_scale'),
        ]);
        const titleScale = (['sm','md','lg','xl'] as const).includes(t as any)
          ? t as 'sm' | 'md' | 'lg' | 'xl' : 'md';
        const bodyScale = (['sm','md','lg'] as const).includes(b as any)
          ? b as 'sm' | 'md' | 'lg' : 'md';
        return new Response(renderAdminConfiguracoes(env, request, {
          typography: { titleScale, bodyScale },
          saved: url.searchParams.get('saved') === '1',
        }), { headers: NO_CACHE_HEADERS });
      }

      if (pathname === '/admin/configuracoes' && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        const form = await request.formData();
        const titleScale = String(form.get('typography.title_scale') ?? 'md');
        const bodyScale = String(form.get('typography.body_scale') ?? 'md');
        await Promise.all([
          setSetting(env.DB, 'typography.title_scale', titleScale),
          setSetting(env.DB, 'typography.body_scale', bodyScale),
        ]);
        await bumpCacheVersion(env);
        return new Response(null, { status: 303, headers: { Location: '/admin/configuracoes?saved=1' } });
      }

      // ============= Admin: Analytics =============
      if (pathname === '/admin/analytics' && request.method === 'GET') {
        if (!authed) return redirectToLogin();
        await ensureActiveVisitorsTable(env.DB);
        const [s24, s7d, s30d, daily, activeNow] = await Promise.all([
          pageviewsSummary(env.DB, 24),
          pageviewsSummary(env.DB, 24 * 7),
          pageviewsSummary(env.DB, 24 * 30),
          pageviewsByDay(env.DB, 30),
          countActiveVisitors(env.DB),
        ]);
        const top48hRaw = await topPostsByViews(env.DB, 48, 15);
        // enriquece com títulos
        const allSlugs = Array.from(new Set([
          ...top48hRaw.map((r) => r.path.replace(/^\//, '')),
          ...s30d.topPaths.slice(0, 15).map((r) => r.path.replace(/^\//, '')),
        ]));
        const enrichPosts = allSlugs.length > 0 ? await getPostsBySlugList(env.DB, allSlugs) : [];
        const titleMap = new Map(enrichPosts.map((p) => [p.slug, p.title]));
        return new Response(renderAdminAnalytics(env, request, {
          totals: {
            last24h: s24.total ?? 0,
            last7d: s7d.total ?? 0,
            last30d: s30d.total ?? 0,
          },
          top48h: top48hRaw.map((r) => ({
            path: r.path, views: r.views, title: titleMap.get(r.path.replace(/^\//, '')),
          })),
          top30d: s30d.topPaths.slice(0, 15).map((r) => ({
            path: r.path, views: r.views, title: titleMap.get(r.path.replace(/^\//, '')),
          })),
          daily,
          activeVisitors: activeNow,
        }), { headers: NO_CACHE_HEADERS });
      }

      // ============= Admin: API Keys =============
      if (pathname === '/admin/api-keys' && request.method === 'GET') {
        if (!authed) return redirectToLogin();
        const keys = await listApiKeys(env.DB);
        // pega token recém criado da query string (one-shot)
        const newToken = url.searchParams.get('new') || undefined;
        return new Response(renderAdminApiKeys(env, request, keys, newToken), {
          headers: NO_CACHE_HEADERS,
        });
      }

      if (pathname === '/admin/api-keys/new' && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        const form = await request.formData();
        const name = String(form.get('name') ?? '').trim() || 'Chave sem nome';
        const { token, prefix, hash } = await generateApiKey();
        await insertApiKey(env.DB, name, prefix, hash);
        return new Response(null, {
          status: 303,
          headers: { Location: `/admin/api-keys?new=${encodeURIComponent(token)}` },
        });
      }

      const delKeyMatch = pathname.match(/^\/admin\/api-keys\/delete\/(\d+)$/);
      if (delKeyMatch && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        await deleteApiKey(env.DB, Number(delKeyMatch[1]));
        return new Response(null, { status: 303, headers: { Location: '/admin/api-keys' } });
      }

      // ============= Admin: Cache =============
      if (pathname === '/admin/cache' && request.method === 'GET') {
        if (!authed) return redirectToLogin();
        const status = await cacheStatus(env);
        return new Response(renderAdminCache(env, request, {
          version: status.version,
          lastPurgedAt: status.lastPurgedAt,
          purgedNow: url.searchParams.get('purged') === '1',
        }), { headers: NO_CACHE_HEADERS });
      }

      if (pathname === '/admin/cache/purge' && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        await bumpCacheVersion(env);
        return new Response(null, { status: 303, headers: { Location: '/admin/cache?purged=1' } });
      }

      // ===== Heartbeat do contador ao vivo (público, sem auth) =====
      if (pathname === '/api/heartbeat' && request.method === 'POST') {
        try {
          const body = await request.json() as { vid?: string; path?: string };
          const vid = typeof body.vid === 'string' ? body.vid.slice(0, 64) : '';
          const p = typeof body.path === 'string' ? body.path.slice(0, 256) : '/';
          if (vid) {
            ctx.waitUntil(ensureActiveVisitorsTable(env.DB).then(() =>
              recordHeartbeat(env.DB, vid, p),
            ).catch(() => {}));
          }
        } catch { /* ignora corpo malformado */ }
        return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
      }

      // ===== Contagem de visitantes ao vivo (admin, session auth) =====
      if (pathname === '/api/active-visitors' && request.method === 'GET') {
        const authedApi = await requireAuth(request, env.SESSION_SECRET);
        if (!authedApi) return json({ error: 'Unauthorized' }, 401);
        await ensureActiveVisitorsTable(env.DB);
        const count = await countActiveVisitors(env.DB);
        ctx.waitUntil(cleanupStaleVisitors(env.DB).catch(() => {}));
        return new Response(JSON.stringify({ active: count }), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }

      // ============= External API =============
      if (pathname.startsWith('/api/')) {
        // Auth helper
        const auth = request.headers.get('Authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        if (!token || !token.startsWith('cdh_')) {
          return json({ error: 'Missing or invalid Authorization header. Use: Bearer cdh_xxx' }, 401);
        }
        const hash = await sha256(token);
        const apiKey = await findApiKeyByHash(env.DB, hash);
        if (!apiKey) return json({ error: 'Invalid or revoked API key' }, 401);
        ctx.waitUntil(touchApiKey(env.DB, apiKey.id).catch(() => {}));

        const siteOrigin = `${url.protocol}//${url.host}`;
        // CORS headers para uso em browsers
        const corsHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        };

        const formatPost = (p: Post, views?: number) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          description: p.description,
          category: p.category,
          tags: p.tags ? p.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
          author: p.author,
          hero_image: p.hero_image,
          draft: !!p.draft,
          pub_date: new Date(p.pub_date).toISOString(),
          updated_date: new Date(p.updated_date).toISOString(),
          url: `${siteOrigin}/${p.slug}`,
          ...(views !== undefined ? { views_last_24h: views } : {}),
        });

        // ===== GET /api/posts/top?hours=24&limit=10 =====
        if (pathname === '/api/posts/top' && request.method === 'GET') {
          const hours = Math.min(720, Math.max(1, Number(url.searchParams.get('hours') ?? 24)));
          const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 10)));
          const top = await topPostsByViews(env.DB, hours, limit);
          const slugs = top.map((t) => t.path.replace(/^\//, ''));
          const posts = slugs.length > 0 ? await getPostsBySlugList(env.DB, slugs) : [];
          const byMap = new Map(posts.map((p) => [p.slug, p]));
          const result = top
            .map((t) => {
              const p = byMap.get(t.path.replace(/^\//, ''));
              if (!p) return null;
              return formatPost(p, t.views);
            })
            .filter(Boolean);
          return new Response(JSON.stringify({
            window_hours: hours,
            count: result.length,
            posts: result,
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // ===== GET /api/posts/:slug =====
        const singleMatch = pathname.match(/^\/api\/posts\/([a-z0-9-]+)$/);
        if (singleMatch && request.method === 'GET') {
          const slug = singleMatch[1];
          const post = await getPostBySlug(env.DB, slug);
          if (!post) return new Response(JSON.stringify({ error: 'Post not found' }), {
            status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
          const views24h = await viewsForPath(env.DB, '/' + slug, 24);
          return new Response(JSON.stringify({
            ...formatPost(post, views24h),
            content: post.content,  // só na single inclui o body completo
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // ===== GET /api/posts (lista) =====
        if (pathname === '/api/posts' && request.method === 'GET') {
          const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
          const includeViews = url.searchParams.get('views') === '1';
          const items = await listPosts(env.DB, { includeDrafts: false, limit });
          // se views=1, busca contadores em paralelo
          let viewsMap: Map<string, number> | null = null;
          if (includeViews) {
            viewsMap = new Map();
            const promises = items.map(async (p) => {
              const v = await viewsForPath(env.DB, '/' + p.slug, 24);
              viewsMap!.set(p.slug, v);
            });
            await Promise.all(promises);
          }
          return new Response(JSON.stringify({
            count: items.length,
            posts: items.map((p) => formatPost(p, viewsMap?.get(p.slug))),
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // ===== POST /api/posts (criar) =====
        if (pathname === '/api/posts' && request.method === 'POST') {
          let payload: Record<string, unknown>;
          try {
            payload = await request.json();
          } catch {
            return new Response(JSON.stringify({ error: 'Body must be valid JSON' }), {
              status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }

          const title = String(payload.title ?? '').trim();
          if (!title) return new Response(JSON.stringify({ error: 'title is required' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
          const content = String(payload.content ?? '').trim();
          if (!content) return new Response(JSON.stringify({ error: 'content is required' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });

          let slug = String(payload.slug ?? '').trim();
          if (!slug) slug = slugify(title);
          if (!/^[a-z0-9-]+$/.test(slug)) {
            return new Response(JSON.stringify({ error: 'slug must contain only a-z, 0-9 and hyphens' }), {
              status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
          // Idempotência (a fila de postagem reenvia/retenta links): se o slug já
          // existe, NÃO é erro — devolve o post existente como sucesso. Antes isso
          // retornava 409 e, em corrida (2 requests do mesmo slug quase juntos), o
          // 2º INSERT estourava a constraint UNIQUE → 500, mesmo com o post já criado.
          const existing = await getPostBySlug(env.DB, slug);
          if (existing) return new Response(JSON.stringify({
            id: existing.id, slug, url: `${siteOrigin}/${slug}`, duplicate: true,
          }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

          const description = String(payload.description ?? '').trim() || excerpt(content);
          const tags = Array.isArray(payload.tags) ? (payload.tags as unknown[]).map(String).join(', ') : '';
          const category = (payload.category != null && String(payload.category).trim()) || null;
          const author = String(payload.author ?? 'Erick Aoki').trim();
          const hero = (payload.hero_image != null && String(payload.hero_image).trim()) || null;
          const draft = payload.draft === true || payload.draft === 1 ? 1 : 0;
          const pubDateStr = String(payload.pub_date ?? '').trim();
          const pub_date = pubDateStr ? new Date(pubDateStr).getTime() : Date.now();
          if (pubDateStr && !Number.isFinite(pub_date)) {
            return new Response(JSON.stringify({ error: 'pub_date must be a valid ISO timestamp' }), {
              status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }

          let id: number;
          try {
            id = await createPost(env.DB, {
              slug, title, description, content, category, tags, author,
              hero_image: hero, draft, pub_date,
              source_url: typeof payload.source_url === 'string' ? payload.source_url : null,
            });
          } catch (e) {
            // Corrida: o slug foi inserido entre o getPostBySlug e este INSERT
            // (UNIQUE constraint failed). Trata como idempotente em vez de 500 —
            // o post já existe, então devolvemos ele como sucesso.
            const dupe = await getPostBySlug(env.DB, slug);
            if (dupe) return new Response(JSON.stringify({
              id: dupe.id, slug, url: `${siteOrigin}/${slug}`, duplicate: true,
            }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            throw e; // erro real (não-duplicado) → deixa o catch global responder 500
          }
          return new Response(JSON.stringify({
            id, slug, url: `${siteOrigin}/${slug}`,
          }), { status: 201, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // ===== Endpoint não encontrado dentro de /api/* =====
        return new Response(JSON.stringify({ error: 'Endpoint not found', method: request.method, path: pathname }), {
          status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ===== Admin: delete post =====
      const deleteMatch = pathname.match(/^\/admin\/delete\/(\d+)$/);
      if (deleteMatch && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        await deletePost(env.DB, Number(deleteMatch[1]));
        return new Response(null, { status: 303, headers: { Location: '/admin' } });
      }

      // ===== Public: post at bare /<slug> (catch-all) =====
      if ((request.method === 'GET' || request.method === 'HEAD') && pathname !== '/' && !pathname.startsWith('/admin') && !pathname.startsWith('/api')) {
        // trailing slash → 301 to canonical
        if (pathname.endsWith('/') && pathname.length > 1) {
          return Response.redirect(`${url.protocol}//${url.host}${pathname.slice(0, -1)}`, 301);
        }
        const slug = pathname.slice(1);
        if (/^[a-z0-9-]+$/.test(slug)) {
          // try cache first
          const cached = await readCache(env, request);
          if (cached) {
            ctx.waitUntil(recordPageview(env.DB, pathname).catch(() => {}));
            return cached;
          }
          const post = await getPostBySlug(env.DB, slug);
          if (post && !post.draft) {
            const [topViews, top24h, ads, typo, gaId] = await Promise.all([
              topPostsByViews(env.DB, 48, 12, pathname),
              topPostsByViews(env.DB, 24, 4, pathname),
              loadAdSettings(env),
              loadTypography(env),
              loadGaId(env), // PROTEÇÃO ANALYTICS: gaId precisa chegar no render (ver loadGaId)
            ]);
            const slugs = topViews.map((v) => v.path.replace(/^\//, ''));
            let relatedPosts = slugs.length > 0
              ? await getPostsBySlugList(env.DB, slugs)
              : [];
            const slugOrder = new Map(slugs.map((s, i) => [s, i]));
            relatedPosts = relatedPosts.sort((a, b) =>
              (slugOrder.get(a.slug) ?? 999) - (slugOrder.get(b.slug) ?? 999),
            );
            // "Em Alta": posts mais vistos nas últimas 24h (excluindo o atual).
            const trendSlugs = top24h.map((v) => v.path.replace(/^\//, ''));
            let trendingPosts = trendSlugs.length > 0
              ? await getPostsBySlugList(env.DB, trendSlugs)
              : [];
            const trendOrder = new Map(trendSlugs.map((s, i) => [s, i]));
            trendingPosts = trendingPosts
              .sort((a, b) => (trendOrder.get(a.slug) ?? 999) - (trendOrder.get(b.slug) ?? 999))
              .slice(0, 4);
            if (relatedPosts.length < 6) {
              const recent = await listPosts(env.DB, { includeDrafts: false, limit: 20 });
              for (const r of recent) {
                if (r.slug !== slug && !relatedPosts.find((x) => x.slug === r.slug)) {
                  relatedPosts.push(r);
                  if (relatedPosts.length >= 12) break;
                }
              }
            }
            ctx.waitUntil(recordPageview(env.DB, pathname).catch(() => {}));
            const resp = new Response(
              renderPost(env, request, post, relatedPosts.slice(0, 12), ads, typo, trendingPosts, undefined, gaId, null, null),
              { headers: PUBLIC_CACHE_HEADERS },
            );
            return writeCache(env, ctx, request, resp);
          }
        }
        // Não bateu como slug direto → checa tabela de redirects (URL antiga do WP)
        const target = await findRedirect(env.DB, pathname);
        if (target) {
          return Response.redirect(`${url.protocol}//${url.host}/${target}`, 301);
        }
      }

      // ===== Default 404 =====
      return new Response(render404(env, request), { status: 404, headers: HTML_HEADERS });
    } catch (err) {
      console.error('Worker error:', err);
      return new Response(`<h1>Erro interno</h1><pre>${String(err)}</pre>`, {
        status: 500,
        headers: HTML_HEADERS,
      });
    }
  },

  /**
   * Cron Trigger — roda dentro da infra do Cloudflare, sem rate limit de IP.
   * Configurado pra disparar a cada minuto via wrangler.jsonc.
   * Cada tick processa um batch grande de posts pendentes.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        // batch maior pra aproveitar a janela do worker no cron (sem cap de IP)
        const result = await runImageMigrationBatch(env, 50);
        console.log(`[cron] migrated batch: ${result.batchSize} posts, ${result.pending} pending, ${result.elapsedMs}ms`);
      } catch (e) {
        console.error('[cron] migration error:', e);
      }
    })());
  },
};

/** Lógica de migração de imagens reutilizada por endpoint POST e por cron */
async function runImageMigrationBatch(env: Env, batchSize: number): Promise<{
  batchSize: number;
  perPost: Array<{ slug: string; title: string; migrated: number; failed: number; skipped: number; partial: boolean }>;
  failed: Array<{ url: string; error: string }>;
  elapsedMs: number;
  pending: number;
  totalWithImages: number;
  migrated: number;
}> {
  const startedAt = Date.now();
  const batch = await nextPostsToMigrate(env.DB, batchSize);

  if (batch.length === 0) {
    const [remaining, totalWithImages] = await Promise.all([
      countPostsWithExternalImages(env.DB),
      countPostsWithAnyImages(env.DB),
    ]);
    return {
      batchSize: 0, perPost: [], failed: [], elapsedMs: Date.now() - startedAt,
      pending: remaining, totalWithImages, migrated: totalWithImages - remaining,
    };
  }

  const allUrls = new Set<string>();
  for (const post of batch) {
    if (post.hero_image && /^https?:\/\//.test(post.hero_image)) allUrls.add(post.hero_image);
    for (const u of extractImageUrls(post.content)) allUrls.add(u);
  }

  const { urlMap, stats } = await migrateImagesWithBudget(Array.from(allUrls), env.IMAGES, {
    startedAt,
    maxWallTimeMs: 25_000,
    maxImages: 500,
  });

  const perPost: Array<{ slug: string; title: string; migrated: number; failed: number; skipped: number; partial: boolean }> = [];
  await Promise.all(batch.map(async (post) => {
    const newContent = rewriteHtmlUrls(post.content, urlMap);
    const newHero = post.hero_image && urlMap.has(post.hero_image)
      ? urlMap.get(post.hero_image)!
      : post.hero_image;
    if (newContent !== post.content || newHero !== post.hero_image) {
      await updatePostContent(env.DB, post.id, newContent, newHero);
    }
    const urls = [
      ...(post.hero_image && /^https?:\/\//.test(post.hero_image) ? [post.hero_image] : []),
      ...extractImageUrls(post.content),
    ];
    let mig = 0;
    for (const u of urls) if (urlMap.has(u)) mig++;
    perPost.push({
      slug: post.slug, title: post.title,
      migrated: mig, failed: urls.length - mig, skipped: 0, partial: false,
    });
  }));

  await markPostsMigrated(env.DB, batch.map((p) => p.id));

  const [remaining, totalWithImages] = await Promise.all([
    countPostsWithExternalImages(env.DB),
    countPostsWithAnyImages(env.DB),
  ]);

  return {
    batchSize: batch.length, perPost,
    failed: stats.failed,
    elapsedMs: Date.now() - startedAt,
    pending: remaining,
    totalWithImages,
    migrated: totalWithImages - remaining,
  };
}

function redirectToLogin(): Response {
  return new Response(null, { status: 303, headers: { Location: '/admin' } });
}

/**
 * URL canônica do site. Usa CANONICAL_URL se definida, senão o host da request.
 * Sempre sem trailing slash. Permite que canonical/og:url/sitemap apontem
 * para o dominio final mesmo quando servidor responde via workers.dev.
 */
function canonicalUrl(env: Env, url: URL): string {
  const fromEnv = (env as Env & { CANONICAL_URL?: string }).CANONICAL_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return `${url.protocol}//${url.host}`;
}

/** Carrega configurações de AdSense do D1, ou retorna undefined se não configurado. */
async function loadAdSettings(env: Env): Promise<SiteAdSettings | undefined> {
  const [pubId, autoAds, placements] = await Promise.all([
    getSetting(env.DB, 'adsense.publisher_id'),
    getSetting(env.DB, 'adsense.auto_ads'),
    getSetting(env.DB, 'adsense.placements'),
  ]);
  if (!pubId || pubId.length < 8) return undefined;
  return {
    publisherId: pubId,
    autoAds: autoAds === '1',
    config: parseAdConfig(placements),
  };
}

/**
 * ⚠️ PROTEÇÃO ANALYTICS — NÃO REMOVER ESTA FUNÇÃO NEM PARAR DE PASSAR O gaId.
 *
 * Carrega o Measurement ID do Google Analytics (settings key: 'google_analytics_id',
 * salvo pelo admin em /admin/settings). Retorna '' quando não configurado.
 *
 * INVARIANTE (já quebrou uma vez → GA parou de receber dados silenciosamente):
 *   Toda página pública que renderiza HTML para visitantes (home, post e QUALQUER
 *   rota pública nova) DEVE chamar loadGaId(env) e repassar o resultado para a
 *   função de render (renderHome/renderPost/...). O script do GA só é injetado em
 *   layout() (src/render.ts) quando `gaId` chega preenchido. Se esquecer de passar
 *   o gaId, NÃO há erro — o GA simplesmente some do HTML e o tráfego deixa de ser
 *   medido. Ao criar uma página pública nova: inclua loadGaId(env) no Promise.all
 *   e passe o valor ao render. Teste rápido:
 *     curl -s https://capitulodehoje.com.br/ | grep googletagmanager   (deve achar)
 */
async function loadGaId(env: Env): Promise<string> {
  const raw = (await getSetting(env.DB, 'google_analytics_id'))?.trim() ?? '';
  if (!raw) return '';
  // Aceita só o formato GA4 (G-XXXXXXXXXX). ID malformado não é injetado (não quebra
  // a página) e fica registrado no log pra facilitar o diagnóstico.
  if (!/^G-[A-Z0-9]{6,}$/i.test(raw)) {
    console.warn(`[analytics] google_analytics_id inválido em settings: "${raw}" — esperado G-XXXXXXXXXX. GA não será injetado.`);
    return '';
  }
  return raw;
}

/** Carrega typography (defaults se não configurado). */
async function loadTypography(env: Env): Promise<SiteTypography> {
  const [t, b] = await Promise.all([
    getSetting(env.DB, 'typography.title_scale'),
    getSetting(env.DB, 'typography.body_scale'),
  ]);
  const titleScale = (['sm','md','lg','xl'] as const).includes(t as any)
    ? t as 'sm' | 'md' | 'lg' | 'xl' : 'md';
  const bodyScale = (['sm','md','lg'] as const).includes(b as any)
    ? b as 'sm' | 'md' | 'lg' : 'md';
  return { titleScale, bodyScale };
}

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ===== Import helpers =====

/**
 * Constrói um ReadableStream concatenando todos os chunks do R2 em sequência.
 * Permite ao parser ler em streaming sem carregar tudo na memória.
 */
function buildChunkStream(
  bucket: R2Bucket,
  uploadId: string,
  totalChunks: number,
): Promise<ReadableStream<Uint8Array>> {
  return Promise.resolve(new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 0; i < totalChunks; i++) {
          const key = `_imports/${uploadId}/${i.toString().padStart(5, '0')}.bin`;
          const obj = await bucket.get(key);
          if (!obj) {
            controller.error(new Error(`chunk ${i} faltando (key=${key})`));
            return;
          }
          const reader = obj.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  }));
}

async function cleanupChunks(bucket: R2Bucket, uploadId: string, totalChunks: number): Promise<void> {
  const deletes: Promise<void>[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const key = `_imports/${uploadId}/${i.toString().padStart(5, '0')}.bin`;
    deletes.push(bucket.delete(key));
  }
  await Promise.all(deletes);
}

interface ImportBatchResult {
  imported: number;
  skipped: Array<{ slug: string; title: string; reason: string }>;
  errors: Array<{ title: string; error: string }>;
  total: number;
}

/**
 * Importa um array de WxrPost em batches para o D1. Usa createPostsBatch
 * (batch insert) e upsertRedirectsBatch (batch redirect) pra ser eficiente.
 */
async function importPostsBatch(
  env: Env,
  posts: WxrPost[],
  importDrafts: boolean,
): Promise<ImportBatchResult> {
  const BATCH = 50; // posts por batch insert — D1 aguenta bem
  const result: ImportBatchResult = {
    imported: 0,
    skipped: [],
    errors: [],
    total: posts.length,
  };

  // 1. Filtra rascunhos
  const candidates: WxrPost[] = [];
  for (const p of posts) {
    const isDraft = p.status !== 'publish';
    if (isDraft && !importDrafts) {
      result.skipped.push({ slug: p.slug, title: p.title, reason: `status: ${p.status}` });
      continue;
    }
    candidates.push(p);
  }

  // 2. Dedup local (mesmo slug aparecendo 2x no XML)
  const seenSlugs = new Set<string>();
  const dedupCandidates: WxrPost[] = [];
  for (const p of candidates) {
    if (seenSlugs.has(p.slug)) {
      result.skipped.push({ slug: p.slug, title: p.title, reason: 'slug duplicado no XML' });
      continue;
    }
    seenSlugs.add(p.slug);
    dedupCandidates.push(p);
  }

  if (dedupCandidates.length === 0) return result;

  // 3. Verifica TODOS os slugs existentes de uma vez (1 subrequest único)
  const allSlugs = dedupCandidates.map((p) => p.slug);
  let alreadyExisting: Set<string>;
  try {
    alreadyExisting = await existingSlugs(env.DB, allSlugs);
  } catch (e) {
    for (const p of dedupCandidates) {
      result.errors.push({ title: p.title, error: 'check existing failed' });
    }
    return result;
  }

  const toInsert = dedupCandidates.filter((p) => {
    if (alreadyExisting.has(p.slug)) {
      result.skipped.push({ slug: p.slug, title: p.title, reason: 'slug já existe' });
      return false;
    }
    return true;
  });

  if (toInsert.length === 0) return result;

  // 4. Prepara redirects todos juntos
  const allRedirects: Array<{ from: string; to: string }> = [];
  for (const p of toInsert) {
    if (!p.link) continue;
    try {
      const u = new URL(p.link);
      const oldPath = u.pathname.replace(/\/+$/, '');
      if (oldPath && oldPath !== `/${p.slug}`) {
        allRedirects.push({ from: oldPath, to: p.slug });
      }
    } catch {/* link inválido */}
  }

  // 5. Insere posts em batches grandes
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const slice = toInsert.slice(i, i + BATCH);
    try {
      await createPostsBatch(
        env.DB,
        slice.map((p) => ({
          slug: p.slug,
          title: p.title,
          description: sanitizeDescription(p.description) || excerpt(p.content),
          content: p.content,
          category: p.category,
          tags: p.tags.join(', '),
          author: p.author,
          hero_image: p.heroImage,
          draft: p.status !== 'publish' ? 1 : 0,
          pub_date: p.pubDate,
          source_url: p.link || null,
        })),
      );
      result.imported += slice.length;
    } catch (e: unknown) {
      for (const p of slice) {
        result.errors.push({ title: p.title, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // 6. Insere redirects em batches separados (só pros que foram importados)
  if (allRedirects.length > 0 && result.imported > 0) {
    for (let i = 0; i < allRedirects.length; i += BATCH) {
      try {
        await upsertRedirectsBatch(env.DB, allRedirects.slice(i, i + BATCH));
      } catch {/* ignore */}
    }
  }

  return result;
}
