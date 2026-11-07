import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createSession, verifySession, requireAuth, revokeSession, reserveLoginAttempt, clearLoginAttempts, cleanupAuthState } from './auth.ts';
import { generateApiKey, sha256 } from './apikey.ts';
import { insertApiKey, findApiKeyByHash } from './db.ts';

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const path of ['schema.sql', 'migrations/0003-settings-analytics-api.sql', 'migrations/0009_security_auth.sql']) {
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

test('sessions use random IDs, reject tampering and legacy cookies, and revoke after logout or password change', async () => {
  const { DB, sqlite } = await fixture();
  try {
    const token = await createSession(secret, DB, password);
    const req = request(token);
    assert.equal(await verifySession(secret, token, DB, password), true);
    assert.equal(await verifySession(secret, token + '.extra', DB, password), false);
    assert.equal(await verifySession(secret, token.replace('v2.', 'v3.'), DB, password), false);
    assert.equal(await verifySession(secret, `${Date.now() + 10000}.old-signature`, DB, password), false);
    assert.equal(await requireAuth(req, secret, DB, password), true);
    assert.equal(await requireAuth(req, secret, DB, 'changed-password'), false);
    assert.equal(await requireAuth(request('malformed%'), secret, DB, password), false);
    const stored = sqlite.prepare('SELECT * FROM admin_sessions').get();
    assert.ok(!JSON.stringify(stored).includes(token.split('.')[2]), 'only the hash of the random ID is stored');
    assert.ok(!JSON.stringify(stored).includes(password));
    await revokeSession(req, secret, DB);
    assert.equal(await requireAuth(req, secret, DB, password), false);
    const second = await createSession(secret, DB, password);
    sqlite.prepare('UPDATE admin_sessions SET expires_at = 0').run();
    assert.equal(await requireAuth(request(second), secret, DB, password), false);
  } finally { sqlite.close(); }
});

test('login limit is atomic across attempts, isolates IPs, and resets after successful login', async () => {
  const { DB, sqlite } = await fixture();
  const req = new Request('https://example.com/admin/login', { headers: { 'CF-Connecting-IP': '192.0.2.1' } });
  try {
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveLoginAttempt(req, secret, DB)));
    assert.equal(results.filter(Boolean).length, 10);
    assert.equal(await reserveLoginAttempt(new Request(req, { headers: { 'CF-Connecting-IP': '192.0.2.2' } }), secret, DB), true);
    assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM admin_login_limits').all()).includes('192.0.2.'));
    await clearLoginAttempts(req, secret, DB);
    assert.equal(await reserveLoginAttempt(req, secret, DB), true);
    sqlite.prepare('UPDATE admin_login_limits SET window_start = 0').run();
    assert.equal(await reserveLoginAttempt(req, secret, DB), true);
  } finally { sqlite.close(); }
});

test('additive key migration preserves legacy integrations while expiry and scopes protect new keys', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(new URL('../migrations/0003-settings-analytics-api.sql', import.meta.url), 'utf8'));
  const legacy = await generateApiKey();
  sqlite.prepare('INSERT INTO api_keys(key_prefix,key_hash,name,created_at) VALUES(?,?,?,?)').run(legacy.prefix, legacy.hash, 'legacy', Date.now());
  sqlite.exec(await readFile(new URL('../migrations/0009_security_auth.sql', import.meta.url), 'utf8'));
  try {
    const old = sqlite.prepare('SELECT scopes,expires_at FROM api_keys').get();
    assert.equal(old.scopes, 'read,write'); assert.equal(old.expires_at, null);
    assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM api_keys').all()).includes(legacy.token));
  } finally { sqlite.close(); }
  const { DB, sqlite: current } = await fixture();
  try {
    const key = await generateApiKey();
    await insertApiKey(DB, 'reader', key.prefix, key.hash, 'read', Date.now() + 60000);
    assert.equal((await findApiKeyByHash(DB, key.hash)).scopes, 'read');
    current.prepare('UPDATE api_keys SET expires_at = 0').run();
    assert.equal(await findApiKeyByHash(DB, key.hash), null);
  } finally { current.close(); }
});

const built = await build({ entryPoints: ['src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], plugins: [{
  name: 'unused-photon', setup(builder) { builder.onResolve({ filter: /^@cf-wasm\/photon$/ }, () => ({ path: 'photon', namespace: 'test' })); builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export class PhotonImage {} export const SamplingFilter = {}; export function crop(){throw Error("unused")} export function resize(){throw Error("unused")}', loader: 'js' })); },
}] });
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('real key flow shows secret only in POST body, never a URL; read-only and expired keys cannot publish', async () => {
  const { DB, sqlite } = await fixture();
  const env = { DB, SESSION_SECRET: secret, ADMIN_PASSWORD: password, SITE_TITLE: 'Site', SITE_DESCRIPTION: 'Test', CANONICAL_URL: 'https://example.com' };
  const tasks = [], ctx = { waitUntil(p) { tasks.push(p); } };
  try {
    const token = await createSession(secret, DB, password);
    const post = new Request('https://example.com/admin/api-keys/new', { method: 'POST', headers: { Cookie: `session=${token}`, Origin: 'https://example.com' }, body: new URLSearchParams({ name: 'reader', scopes: 'read', expiry_days: '30' }) });
    const res = await worker.fetch(post, env, ctx);
    assert.equal(res.status, 200); assert.equal(res.headers.get('location'), null); assert.match(res.headers.get('cache-control'), /no-store/);
    const html = await res.text(), key = html.match(/cdh_[A-Za-z0-9_-]{43}/)?.[0];
    assert.ok(key); assert.equal(sqlite.prepare('SELECT scopes FROM api_keys').get().scopes, 'read');
    const get = await worker.fetch(request(token), env, ctx);
    assert.equal(get.status, 200); assert.ok(!(await get.text()).includes(key));
    const oldUrl = await worker.fetch(request(token, '/admin/api-keys?new=' + key), env, ctx);
    assert.equal(oldUrl.status, 303); assert.equal(oldUrl.headers.get('location'), '/admin/api-keys'); assert.ok(!(await oldUrl.text()).includes(key));
    const noWrite = await worker.fetch(new Request('https://example.com/api/posts', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ title: 'Post', content: '<p>Teste</p>' }) }), env, ctx);
    assert.equal(noWrite.status, 403);
    const read = await worker.fetch(new Request('https://example.com/api/posts', { headers: { Authorization: `Bearer ${key}` } }), env, ctx);
    assert.equal(read.status, 200);
    sqlite.prepare('UPDATE api_keys SET expires_at=0').run();
    const expired = await worker.fetch(new Request('https://example.com/api/posts', { headers: { Authorization: `Bearer ${key}` } }), env, ctx);
    assert.equal(expired.status, 401);
    const csrf = await worker.fetch(new Request('https://example.com/admin/api-keys/new', { method: 'POST', headers: { Cookie: `session=${token}`, Origin: 'https://evil.example' }, body: new URLSearchParams({ name: 'bad' }) }), env, ctx);
    assert.equal(csrf.status, 403);
    const logout = await worker.fetch(new Request('https://example.com/admin/logout', { method: 'POST', headers: { Cookie: `session=${token}`, Origin: 'https://example.com' } }), env, ctx);
    assert.equal(logout.status, 303); assert.equal(await requireAuth(request(token), secret, DB, password), false);
    await Promise.all(tasks);
  } finally { sqlite.close(); }
});


test('auth cleanup deletes at most 100 expired records per indexed table and preserves active state', async () => {
  const { DB, sqlite, queries } = await fixture();
  try {
    for (let i = 0; i < 101; i++) {
      sqlite.prepare('INSERT INTO admin_sessions VALUES (?, 0, ?)').run('expired-' + i, 'hash');
      sqlite.prepare('INSERT INTO admin_login_limits VALUES (?, 0, 1)').run('expired-' + i);
    }
    sqlite.prepare('INSERT INTO admin_sessions VALUES (?, ?, ?)').run('active', Date.now() + 60000, 'hash');
    sqlite.prepare('INSERT INTO admin_login_limits VALUES (?, ?, 1)').run('active', Date.now());
    await cleanupAuthState(DB);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM admin_sessions').get().n, 2);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM admin_login_limits').get().n, 2);
    assert.ok(sqlite.prepare("SELECT 1 FROM admin_sessions WHERE id_hash='active'").get());
    const deletes = queries.filter(sql => sql.startsWith('DELETE'));
    assert.equal(deletes.length, 2);
    assert.ok(deletes.every(sql => /LIMIT 100/.test(sql)));
    for (const sql of deletes) {
      const plan = JSON.stringify(sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(Date.now()));
      assert.match(plan, /idx_admin_(sessions_expiry|login_limits_window)/);
      assert.doesNotMatch(plan, /SCAN admin_(sessions|login_limits)/);
    }
  } finally { sqlite.close(); }
});
