/** Images already use immutable filenames. Cache bytes per PoP and format,
 * avoiding an R2 GET on every reader while retaining the original R2 fallback.
 * A cache outage must never prevent serving an image.
 */
export async function cachedImageResponse(
  request: Request,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  load: () => Promise<Response>,
): Promise<Response> {
  // HEAD retains original-object metadata; partial responses are never stored.
  if (request.method !== 'GET' || request.headers.has('Range')) return load();
  const url = new URL(request.url);
  const optimized = url.searchParams.get('orig') !== '1'
    && (request.headers.get('Accept') || '').includes('image/webp');
  url.search = '';
  url.searchParams.set('__image_cache', optimized ? 'opt3' : 'original');
  const key = new Request(url.toString());
  try {
    const hit = await caches.default.match(key);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('X-Image-Cache', 'HIT');
      const etag = headers.get('ETag');
      const condition = request.headers.get('If-None-Match');
      if (etag && condition && condition.split(',').some(value =>
        value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''),
      )) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(hit.body, { status: hit.status, headers });
    }
  } catch { /* R2 remains available when the optional cache fails. */ }

  const response = await load();
  if (response.status === 200 && !response.headers.has('Set-Cookie')) {
    const cloned = response.clone();
    const headers = new Headers(cloned.headers);
    headers.set('Cache-Control', 'public, max-age=31536000, s-maxage=86400, immutable');
    ctx.waitUntil((async () => {
      try {
        await caches.default.put(key, new Response(cloned.body, { headers }));
      } catch { /* Optional cache writes never affect the reader. */ }
    })());
  }
  const headers = new Headers(response.headers);
  headers.set('X-Image-Cache', 'MISS');
  return new Response(response.body, { status: response.status, headers });
}
