/**
 * Cache layer pra responses públicas.
 * Usa Workers Cache API (per-PoP) com versioning via settings.
 *
 * Estratégia:
 *  - Cada cache key inclui a "cache.version" (string numérica).
 *  - Bumpar a versão invalida tudo automaticamente — novas requests
 *    geram cache miss e re-hidratam com a nova versão.
 *  - "Limpeza gradual" emerge naturalmente: cada PoP regenera só os paths
 *    que recebem tráfego, conforme as requests chegam — sem rebuild stampede.
 */

import type { Env } from './types';
import { getSetting, setSetting } from './db';

const VERSION_CACHE_TTL_MS = 30_000; // bypass DB nessa janela (per-isolate)
let cachedVersion: { value: string; expiresAt: number } | null = null;

export async function getCacheVersion(env: Env): Promise<string> {
  const now = Date.now();
  if (cachedVersion && cachedVersion.expiresAt > now) return cachedVersion.value;
  const v = (await getSetting(env.DB, 'cache.version')) ?? '1';
  cachedVersion = { value: v, expiresAt: now + VERSION_CACHE_TTL_MS };
  return v;
}

/** Invalida o cache global incrementando a versão. */
export async function bumpCacheVersion(env: Env): Promise<string> {
  const current = Number((await getSetting(env.DB, 'cache.version')) ?? '1');
  const next = String(Number.isFinite(current) ? current + 1 : 1);
  await Promise.all([
    setSetting(env.DB, 'cache.version', next),
    setSetting(env.DB, 'cache.last_purged_at', String(Date.now())),
  ]);
  cachedVersion = { value: next, expiresAt: Date.now() + VERSION_CACHE_TTL_MS };
  return next;
}

/**
 * Constrói a chave de cache combinando URL + versão.
 * Adicionamos a versão como query param para que o Cloudflare Cache API
 * trate como request distinta sem mudar a URL real do cliente.
 */
function cacheKeyFor(request: Request, version: string): Request {
  const url = new URL(request.url);
  url.searchParams.set('__cv', version);
  return new Request(url.toString(), { method: 'GET', headers: request.headers });
}

/**
 * Tenta servir do cache. Retorna a Response cacheada ou null.
 */
export async function readCache(env: Env, request: Request): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const version = await getCacheVersion(env);
  const key = cacheKeyFor(request, version);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (!hit) return null;
  // Clone + adiciona header indicando cache hit (útil pra debug)
  const headers = new Headers(hit.headers);
  headers.set('X-Cache', 'HIT');
  headers.set('X-Cache-Version', version);
  return new Response(hit.body, { status: hit.status, headers });
}

/**
 * Salva uma response no cache. Não bloqueia — usa ctx.waitUntil.
 * Apenas cacheia respostas 200 com Content-Type HTML/text/JSON.
 */
export function writeCache(
  env: Env, ctx: ExecutionContext, request: Request, response: Response,
): Response {
  if (request.method !== 'GET') return response;
  if (response.status !== 200) return response;
  const ct = response.headers.get('Content-Type') ?? '';
  // não cacheia binários, imagens, etc.
  if (!/text\/html|application\/(xml|rss|json)|text\/plain|text\/xml/.test(ct)) return response;

  // Clone a response — uma cópia vai pro cache, outra vai pro cliente.
  const cloned = response.clone();

  ctx.waitUntil((async () => {
    try {
      const version = await getCacheVersion(env);
      const key = cacheKeyFor(request, version);
      // Garante Cache-Control + Cache-Tag pra observability
      const newHeaders = new Headers(cloned.headers);
      if (!newHeaders.has('Cache-Control')) {
        newHeaders.set('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
      }
      newHeaders.set('X-Cache-Version', version);
      const toStore = new Response(cloned.body, { status: cloned.status, headers: newHeaders });
      await caches.default.put(key, toStore);
    } catch {
      // cache write opcional — ignora erro
    }
  })());

  // marca a resposta original como MISS pra debug
  const finalHeaders = new Headers(response.headers);
  finalHeaders.set('X-Cache', 'MISS');
  return new Response(response.body, { status: response.status, headers: finalHeaders });
}

/**
 * Estatísticas + estado do cache (lido do settings).
 */
export async function cacheStatus(env: Env): Promise<{
  version: string;
  lastPurgedAt: number | null;
}> {
  const [v, last] = await Promise.all([
    getSetting(env.DB, 'cache.version'),
    getSetting(env.DB, 'cache.last_purged_at'),
  ]);
  return {
    version: v ?? '1',
    lastPurgedAt: last ? Number(last) : null,
  };
}
