import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createSession } from './auth.ts';
import { renderMarkdown, sanitizeArticleHtml, scriptJson } from './markdown.ts';

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const path of ['schema.sql', 'migrations/0003-settings-analytics-api.sql']) {
    sqlite.exec(await readFile(new URL('../' + path, import.meta.url), 'utf8'));
  }
  const queries = [];
  const DB = { prepare(sql) { queries.push(sql); let args = []; const stmt = {
    bind(...values) { args = values; return stmt; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
  }; return stmt; } };
  return { sqlite, DB, queries };
}
const secret = 'test-only-secret-with-no-production-access';
const password = 'test-only-admin-password';
const request = (token, path = '/admin/api-keys', extra = {}) => new Request('https://example.com' + path, { headers: { Cookie: `session=${encodeURIComponent(token)}`, ...extra } });

test('article sanitizer preserves images, tables and formatting while rejecting executable HTML and obfuscated URLs', () => {
  const dirty = `<p class="wp-paragraph">Texto <strong>forte</strong> <em>ênfase</em></p>
    <figure><img src="https://example.com/image.jpg" alt="Retrato" width="640" onerror="alert(1)"><figcaption>Legenda</figcaption></figure>
    <table><tr><td colspan="2">Tabela</td></tr></table><a href="https://example.com/post">Link</a>
    <script>alert('bad')</script><iframe srcdoc="<script>alert(1)</script>"></iframe>
    <img src="x" onload="alert(1)"><a href="jav&#x61;script:alert(1)">bad</a>
    <a href="java&#10;script:alert(1)">bad2</a><img src="data:image/svg+xml,<svg onload=alert(1)>">
    <svg><a xlink:href="javascript:alert(1)">x</a></svg><form action="/admin/api-keys/new"><input name="name" value="attack"></form>`;
  const clean = sanitizeArticleHtml(dirty);
  assert.match(clean, /<strong>forte<\/strong>/); assert.match(clean, /<em>ênfase<\/em>/);
  assert.match(clean, /<figure>/); assert.match(clean, /src="https:\/\/example.com\/image.jpg"/);
  assert.match(clean, /alt="Retrato"/); assert.match(clean, /colspan="2"/); assert.match(clean, /href="https:\/\/example.com\/post"/);
  assert.doesNotMatch(clean, /<script|<iframe|<svg|<form|onerror|onload|javascript:|data:image|srcdoc/i);
  assert.doesNotMatch(renderMarkdown('[x](javascript:alert(1))\n\n<p onclick="bad()">Seguro</p>'), /javascript:|onclick/i);
});

test('script JSON cannot close its HTML container and round-trips the original metadata', () => {
  const value = { title: '</script><script>alert(1)</script>', category: '\u2028\u2029' };
  const encoded = scriptJson(value);
  assert.doesNotMatch(encoded, /</); assert.deepEqual(JSON.parse(encoded), value);
});

const built = await build({ entryPoints: ['src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], plugins: [{
  name: 'unused-photon', setup(builder) { builder.onResolve({ filter: /^@cf-wasm\/photon$/ }, () => ({ path: 'photon', namespace: 'test' })); builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export class PhotonImage {} export const SamplingFilter = {}; export function crop(){throw Error("unused")} export function resize(){throw Error("unused")}', loader: 'js' })); },
}] });
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('real key flow shows secret only in POST body, never a URL or later GET', async () => {
  const { DB, sqlite } = await fixture();
  const env = { DB, SESSION_SECRET: secret, ADMIN_PASSWORD: password, SITE_TITLE: 'Site', SITE_DESCRIPTION: 'Test', CANONICAL_URL: 'https://example.com' };
  const tasks = [], ctx = { waitUntil(p) { tasks.push(p); } };
  try {
    const token = await createSession(secret, DB, password);
    const post = new Request('https://example.com/admin/api-keys/new', { method: 'POST', headers: { Cookie: `session=${token}`, Origin: 'https://example.com' }, body: new URLSearchParams({ name: 'reader', scopes: 'read', expiry_days: '30' }) });
    const res = await worker.fetch(post, env, ctx);
    assert.equal(res.status, 200); assert.equal(res.headers.get('location'), null); assert.match(res.headers.get('cache-control'), /no-store/);
    const html = await res.text(), key = html.match(/cdh_[A-Za-z0-9_-]{43}/)?.[0];
    assert.ok(key);
    const get = await worker.fetch(request(token), env, ctx);
    assert.equal(get.status, 200); assert.ok(!(await get.text()).includes(key));
    const oldUrl = await worker.fetch(request(token, '/admin/api-keys?new=' + key), env, ctx);
    assert.equal(oldUrl.status, 303); assert.equal(oldUrl.headers.get('location'), '/admin/api-keys'); assert.ok(!(await oldUrl.text()).includes(key));
    const csrf = await worker.fetch(new Request('https://example.com/admin/api-keys/new', { method: 'POST', headers: { Cookie: `session=${token}`, Origin: 'https://evil.example' }, body: new URLSearchParams({ name: 'bad' }) }), env, ctx);
    assert.equal(csrf.status, 403);
    await Promise.all(tasks);
  } finally { sqlite.close(); }
});
