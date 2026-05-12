import type { Env, PostInput } from './types';
import {
  listPosts, getPostBySlug, getPostById,
  createPost, updatePost, deletePost,
} from './db';
import {
  renderHome, renderPost, render404,
  renderLogin, renderAdminDashboard, renderAdminEditor,
} from './render';
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
        return env.ASSETS.fetch(request);
      }

      // ===== Public: home =====
      if (pathname === '/' && request.method === 'GET') {
        const posts = await listPosts(env.DB, { includeDrafts: false, limit: 50 });
        return new Response(renderHome(env, request, posts), { headers: PUBLIC_CACHE_HEADERS });
      }

      // ===== Public: post by slug =====
      if (pathname.startsWith('/p/') && request.method === 'GET') {
        const slug = pathname.slice(3);
        const post = await getPostBySlug(env.DB, slug);
        if (!post || post.draft) {
          return new Response(render404(env, request), { status: 404, headers: HTML_HEADERS });
        }
        return new Response(renderPost(env, request, post), { headers: PUBLIC_CACHE_HEADERS });
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
        const password = String(form.get('password') ?? '');
        if (password !== env.ADMIN_PASSWORD) {
          return new Response(renderLogin(env, request, 'Senha incorreta.'), {
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

      // ===== Admin: delete post =====
      const deleteMatch = pathname.match(/^\/admin\/delete\/(\d+)$/);
      if (deleteMatch && request.method === 'POST') {
        if (!authed) return redirectToLogin();
        await deletePost(env.DB, Number(deleteMatch[1]));
        return new Response(null, { status: 303, headers: { Location: '/admin' } });
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
