import type { Env, PostInput } from './types';
import {
  listPosts, getPostBySlug, getPostById,
  createPost, updatePost, deletePost,
  upsertRedirect, findRedirect,
  countPostsWithExternalImages, countPostsWithAnyImages,
  nextPostsToMigrate, updatePostContent, markPostsMigrated,
  createPostsBatch, upsertRedirectsBatch, existingSlugs,
} from './db';
import {
  renderHome, renderPost, render404,
  renderLogin, renderAdminDashboard, renderAdminEditor,
} from './render';
import { parseWxr, streamWxrCollect } from './wxr';
import type { WxrPost } from './wxr';
import {
  extractImageUrls, rewriteHtmlUrls, migrateImagesWithBudget,
} from './images';
import type { ImageMigrationStats } from './images';
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
      // ===== Static assets (CSS, favicon, etc) =====
      if (pathname.startsWith('/styles.css') || pathname.startsWith('/favicon')) {
        const res = await env.ASSETS.fetch(request);
        // adiciona cache de longo prazo (mutaremos via versão se precisar)
        const headers = new Headers(res.headers);
        headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
        return new Response(res.body, { status: res.status, headers });
      }

      // ===== R2 images: /img/<filename> =====
      if (pathname.startsWith('/img/') && (request.method === 'GET' || request.method === 'HEAD')) {
        const key = pathname.slice(5);
        if (!key || key.includes('/') || key.includes('..')) {
          return new Response('Not found', { status: 404 });
        }
        const ifNoneMatch = request.headers.get('If-None-Match');
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
        const obj = await env.IMAGES.get(key);
        if (!obj) return new Response('Not found', { status: 404 });
        const headers = new Headers();
        obj.writeHttpMetadata(headers);
        headers.set('etag', obj.httpEtag);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        if (ifNoneMatch === obj.httpEtag) {
          return new Response(null, { status: 304, headers });
        }
        return new Response(obj.body, { headers });
      }

      // ===== Public: home =====
      if (pathname === '/' && request.method === 'GET') {
        const posts = await listPosts(env.DB, { includeDrafts: false, limit: 50 });
        return new Response(renderHome(env, request, posts), { headers: PUBLIC_CACHE_HEADERS });
      }

      // ===== Legacy /p/<slug> → 301 to /<slug> =====
      if (pathname.startsWith('/p/') && request.method === 'GET') {
        const slug = pathname.slice(3).replace(/\/$/, '');
        return Response.redirect(`${url.protocol}//${url.host}/${slug}`, 301);
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

      // ===== Sitemap =====
      if (pathname === '/sitemap.xml' && request.method === 'GET') {
        const posts = await listPosts(env.DB, { includeDrafts: false, limit: 1000 });
        const base = canonicalUrl(env, url);
        const urls = [
          `<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
          ...posts.map((p) => `<url><loc>${base}/${p.slug}</loc><lastmod>${new Date(p.updated_date || p.pub_date).toISOString()}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`),
        ].join('\n');
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }

      // ===== RSS feed =====
      if (pathname === '/rss.xml' && request.method === 'GET') {
        const posts = await listPosts(env.DB, { includeDrafts: false, limit: 50 });
        const siteUrl = `${url.protocol}//${url.host}`;
        const items = posts.map((p) => `
  <item>
    <title>${escapeXml(p.title)}</title>
    <link>${siteUrl}/p/${p.slug}</link>
    <guid>${siteUrl}/p/${p.slug}</guid>
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
        return new Response(xml, {
          headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          },
        });
      }

      // ===== Admin: login (GET) =====
      if (pathname === '/admin' && request.method === 'GET') {
        const authed = await requireAuth(request, env.SESSION_SECRET);
        if (!authed) {
          return new Response(renderLogin(env, request), { headers: NO_CACHE_HEADERS });
        }
        const posts = await listPosts(env.DB, { includeDrafts: true, limit: 200 });
        return new Response(renderAdminDashboard(env, request, posts), { headers: NO_CACHE_HEADERS });
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

      // ===== Admin: delete post =====
      const deleteMatch = pathname.match(/^\/admin\/delete\/(\d+)$/);
      if (deleteMatch && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        await deletePost(env.DB, Number(deleteMatch[1]));
        return new Response(null, { status: 303, headers: { Location: '/admin' } });
      }

      // ===== Public: post at bare /<slug> (catch-all) =====
      if (request.method === 'GET' && pathname !== '/' && !pathname.startsWith('/admin')) {
        // trailing slash → 301 to canonical
        if (pathname.endsWith('/') && pathname.length > 1) {
          return Response.redirect(`${url.protocol}//${url.host}${pathname.slice(0, -1)}`, 301);
        }
        const slug = pathname.slice(1);
        // valida formato — só letras minúsculas, números e hífens
        if (/^[a-z0-9-]+$/.test(slug)) {
          const post = await getPostBySlug(env.DB, slug);
          if (post && !post.draft) {
            return new Response(renderPost(env, request, post), { headers: PUBLIC_CACHE_HEADERS });
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
