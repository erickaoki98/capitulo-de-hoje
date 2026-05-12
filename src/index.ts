import type { Env, PostInput } from './types';
import {
  listPosts, getPostBySlug, getPostById,
  createPost, updatePost, deletePost,
  upsertRedirect, findRedirect,
  countPostsWithExternalImages, nextPostsToMigrate, updatePostContent,
} from './db';
import {
  renderHome, renderPost, render404,
  renderLogin, renderAdminDashboard, renderAdminEditor,
  renderAdminImport, renderAdminMigrate,
} from './render';
import { parseWxr } from './wxr';
import {
  extractImageUrls, rewriteHtmlUrls, migrateImagesWithBudget,
} from './images';
import type { ImageMigrationStats } from './images';
import {
  createSession, sessionCookie, clearSessionCookie, requireAuth,
} from './auth';
import { excerpt } from './markdown';

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

      // ===== Admin: import (GET) =====
      if (pathname === '/admin/import' && request.method === 'GET') {
        if (!authed) return redirectToLogin();
        return new Response(renderAdminImport(env, request), { headers: NO_CACHE_HEADERS });
      }

      // ===== Admin: import (POST) =====
      // Estratégia: SEMPRE importa rápido (só posts, sem imagens).
      // Migração de imagens é separada via /admin/migrate-images (batched).
      // Isso evita timeout do Workers (CPU/wall-time + subrequest limits).
      if (pathname === '/admin/import' && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        try {
          const form = await parseFormData(request);
          const file = form.get('wxr');
          if (!(file instanceof File)) {
            return new Response(renderAdminImport(env, request, undefined, 'Nenhum arquivo enviado.'), {
              status: 400, headers: NO_CACHE_HEADERS,
            });
          }
          const importDrafts = form.get('import_drafts') === '1';
          const xml = await file.text();
          const posts = parseWxr(xml);

          const result = {
            imported: 0,
            skipped: [] as Array<{ slug: string; title: string; reason: string }>,
            errors: [] as Array<{ title: string; error: string }>,
            total: posts.length,
            imageStats: null as ImageMigrationStats | null,
          };

          for (const p of posts) {
            const isDraft = p.status !== 'publish';
            if (isDraft && !importDrafts) {
              result.skipped.push({ slug: p.slug, title: p.title, reason: `status: ${p.status}` });
              continue;
            }
            const existing = await getPostBySlug(env.DB, p.slug);
            if (existing) {
              result.skipped.push({ slug: p.slug, title: p.title, reason: 'slug já existe' });
              continue;
            }
            try {
              await createPost(env.DB, {
                slug: p.slug,
                title: p.title,
                description: p.description || excerpt(p.content),
                content: p.content, // URLs originais — migradas depois
                category: p.category,
                tags: p.tags.join(', '),
                author: p.author,
                hero_image: p.heroImage,
                draft: isDraft ? 1 : 0,
                pub_date: p.pubDate,
                source_url: p.link || null,
              });
              if (p.link) {
                try {
                  const u = new URL(p.link);
                  const oldPath = u.pathname.replace(/\/+$/, '');
                  if (oldPath && oldPath !== `/${p.slug}`) {
                    await upsertRedirect(env.DB, oldPath, p.slug);
                  }
                } catch {/* link inválido */}
              }
              result.imported++;
            } catch (e: unknown) {
              result.errors.push({ title: p.title, error: e instanceof Error ? e.message : String(e) });
            }
          }

          return new Response(renderAdminImport(env, request, result), { headers: NO_CACHE_HEADERS });
        } catch (e: unknown) {
          return new Response(
            renderAdminImport(env, request, undefined, `Erro ao processar arquivo: ${e instanceof Error ? e.message : String(e)}`),
            { status: 500, headers: NO_CACHE_HEADERS },
          );
        }
      }

      // ===== Admin: migrate images (GET) =====
      if (pathname === '/admin/migrate-images' && request.method === 'GET') {
        if (!authed) return redirectToLogin();
        const pending = await countPostsWithExternalImages(env.DB);
        return new Response(renderAdminMigrate(env, request, { pending }), { headers: NO_CACHE_HEADERS });
      }

      // ===== Admin: migrate images (POST) — processa um lote =====
      if (pathname === '/admin/migrate-images' && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        const startedAt = Date.now();
        const BATCH_SIZE = 5;
        const batch = await nextPostsToMigrate(env.DB, BATCH_SIZE);

        let processedPosts = 0;
        const totalStats: ImageMigrationStats = {
          totalFound: 0, uniqueFound: 0, migrated: 0, skipped: 0, failed: [],
        };
        const perPostResults: Array<{ slug: string; migrated: number; failed: number; partial: boolean }> = [];

        for (const post of batch) {
          // checa budget global por request — 20s wall time total
          if (Date.now() - startedAt > 20_000) break;

          const urls = [
            ...(post.hero_image && /^https?:\/\//.test(post.hero_image) ? [post.hero_image] : []),
            ...extractImageUrls(post.content),
          ];
          if (urls.length === 0) {
            processedPosts++;
            continue;
          }

          const { urlMap, stats, exhausted } = await migrateImagesWithBudget(urls, env.IMAGES, {
            startedAt,
            maxWallTimeMs: 20_000,
            maxImages: 40,
          });

          // atualiza stats globais
          totalStats.totalFound += stats.totalFound;
          totalStats.uniqueFound += stats.uniqueFound;
          totalStats.migrated += stats.migrated;
          totalStats.skipped += stats.skipped;
          totalStats.failed.push(...stats.failed);

          const newContent = rewriteHtmlUrls(post.content, urlMap);
          const newHero = post.hero_image && urlMap.has(post.hero_image)
            ? urlMap.get(post.hero_image)!
            : post.hero_image;

          // só atualiza se alguma URL foi reescrita
          if (newContent !== post.content || newHero !== post.hero_image) {
            await updatePostContent(env.DB, post.id, newContent, newHero);
          }

          perPostResults.push({
            slug: post.slug,
            migrated: stats.migrated + stats.skipped,
            failed: stats.failed.length,
            partial: exhausted,
          });
          processedPosts++;

          if (exhausted) break;
        }

        const remaining = await countPostsWithExternalImages(env.DB);
        return new Response(
          renderAdminMigrate(env, request, {
            pending: remaining,
            lastBatch: { processedPosts, totalStats, perPostResults, elapsedMs: Date.now() - startedAt },
          }),
          { headers: NO_CACHE_HEADERS },
        );
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
};

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
