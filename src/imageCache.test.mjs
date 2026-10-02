import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedImageResponse } from './imageCache.ts';

async function withCache(run) {
  const previous = globalThis.caches;
  const entries = new Map();
  const tasks = [];
  globalThis.caches = { default: {
    async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, response) { entries.set(key.url, response.clone()); },
  } };
  const ctx = { waitUntil(promise) { tasks.push(promise); } };
  try { await run({ ctx, entries, flush: () => Promise.all(tasks) }); }
  finally { globalThis.caches = previous; }
}
const request = (suffix = '', headers = {}) => new Request(`https://example.com/img/photo.png${suffix}`, { headers });
const image = (body = 'original') => new Response(body, { headers: { 'Content-Type': 'image/png', ETag: '"photo"', Vary: 'Accept' } });

test('repeated image requests and tracking URLs reuse bytes without loading R2', () => withCache(async ({ ctx, flush }) => {
  let reads = 0;
  const load = async () => { reads++; return image(); };
  assert.equal(await (await cachedImageResponse(request(), ctx, load)).text(), 'original');
  await flush();
  for (let i = 0; i < 100; i++) {
    const response = await cachedImageResponse(request(`?utm_source=${i}`), ctx, load);
    assert.equal(response.headers.get('X-Image-Cache'), 'HIT');
    assert.equal(await response.text(), 'original');
  }
  assert.equal(reads, 1);
}));

test('WebP and originals stay separate; orig=1 ignores WebP Accept', () => withCache(async ({ ctx, entries, flush }) => {
  await cachedImageResponse(request('', { Accept: 'image/webp' }), ctx, async () => image('optimized'));
  await flush();
  assert.equal(await (await cachedImageResponse(request(), ctx, async () => image())).text(), 'original');
  await flush();
  const response = await cachedImageResponse(request('?orig=1', { Accept: 'image/webp' }), ctx, async () => { throw Error('unexpected R2 read'); });
  assert.equal(await response.text(), 'original');
  assert.equal(entries.size, 2);
}));

test('conditional cache hit returns 304 without R2 and preserves ETag', () => withCache(async ({ ctx, flush }) => {
  await cachedImageResponse(request(), ctx, async () => image());
  await flush();
  const response = await cachedImageResponse(request('', { 'If-None-Match': 'W/"other", W/"photo"' }), ctx, async () => { throw Error('unexpected R2 read'); });
  assert.equal(response.status, 304);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('ETag'), '"photo"');
}));

test('HEAD, Range, errors and conditional misses never pollute full image cache', () => withCache(async ({ ctx, entries, flush }) => {
  for (const req of [new Request(request(), { method: 'HEAD' }), request('', { Range: 'bytes=0-3' })]) {
    await cachedImageResponse(req, ctx, async () => image());
  }
  for (const status of [304, 404, 500, 206]) {
    assert.equal((await cachedImageResponse(request(), ctx, async () => new Response(null, { status }))).status, status);
  }
  await flush();
  assert.equal(entries.size, 0);
}));

test('cache read/write failure preserves successful image delivery', () => withCache(async ({ ctx, flush }) => {
  globalThis.caches.default = { async match() { throw Error('cache down'); }, async put() { throw Error('cache down'); } };
  const response = await cachedImageResponse(request(), ctx, async () => image());
  assert.equal(await response.text(), 'original');
  await flush();
}));
