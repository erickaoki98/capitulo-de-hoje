// Cookies carry a signed random session ID; D1 controls revocation independently
// of SESSION_SECRET, which also protects the existing AdSense connection.
import { sha256 } from './apikey.ts';

const COOKIE_NAME = 'session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

async function hmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}
function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
async function credentialHash(secret: string, password: string): Promise<string> {
  return hmac(secret, `admin-credentials:${password}`);
}

export async function createSession(secret: string, db?: D1Database, password = ''): Promise<string> {
  const exp = Date.now() + SESSION_DURATION_MS;
  const id = base64(crypto.getRandomValues(new Uint8Array(32)));
  const payload = `v2.${exp}.${id}`;
  if (db) {
    await db.prepare('INSERT INTO admin_sessions (id_hash, expires_at, credential_hash) VALUES (?, ?, ?)')
      .bind(await sha256(id), exp, await credentialHash(secret, password)).run();
  }
  return `${payload}.${await hmac(secret, payload)}`;
}

async function sessionId(secret: string, token: string | null): Promise<string | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v2' || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null;
  const [version, expiry, id, sig] = parts;
  const exp = Number(expiry);
  if (!Number.isFinite(exp) || Date.now() >= exp || exp > Date.now() + SESSION_DURATION_MS) return null;
  // Verify HMAC through WebCrypto instead of comparing signatures in JS.
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const bytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    return await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(`${version}.${expiry}.${id}`)) ? id : null;
  } catch { return null; }
}
export function getSessionFromRequest(request: Request): string | null {
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  try { return match ? decodeURIComponent(match[1]) : null; } catch { return null; }
}
export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION_MS / 1000}`;
}
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
export async function verifySession(secret: string, token: string | null, db: D1Database, password = ''): Promise<boolean> {
  const id = await sessionId(secret, token);
  if (!id) return false;
  const found = await db.prepare('SELECT 1 AS valid FROM admin_sessions WHERE id_hash = ? AND expires_at > ? AND credential_hash = ?')
    .bind(await sha256(id), Date.now(), await credentialHash(secret, password)).first();
  return !!found;
}
export async function requireAuth(request: Request, secret: string, db: D1Database, password = ''): Promise<boolean> {
  return verifySession(secret, getSessionFromRequest(request), db, password);
}
export async function revokeSession(request: Request, secret: string, db: D1Database): Promise<void> {
  const id = await sessionId(secret, getSessionFromRequest(request));
  if (id) await db.prepare('DELETE FROM admin_sessions WHERE id_hash = ?').bind(await sha256(id)).run();
}

/** A global, atomic per-IP window survives Worker instance changes. No IP is stored. */
export async function reserveLoginAttempt(request: Request, secret: string, db: D1Database): Promise<boolean> {
  const ip = request.headers.get('CF-Connecting-IP') || 'local-development';
  const id = await hmac(secret, `login-ip:${ip}`);
  const window = Math.floor(Date.now() / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS;
  const row = await db.prepare(`INSERT INTO admin_login_limits (id_hash, window_start, attempts) VALUES (?, ?, 1)
    ON CONFLICT(id_hash) DO UPDATE SET window_start = excluded.window_start,
    attempts = CASE WHEN admin_login_limits.window_start = excluded.window_start THEN admin_login_limits.attempts + 1 ELSE 1 END
    WHERE admin_login_limits.window_start != excluded.window_start OR admin_login_limits.attempts < 10
    RETURNING attempts`).bind(id, window).first();
  return !!row;
}
export async function clearLoginAttempts(request: Request, secret: string, db: D1Database): Promise<void> {
  const id = await hmac(secret, `login-ip:${request.headers.get('CF-Connecting-IP') || 'local-development'}`);
  await db.prepare('DELETE FROM admin_login_limits WHERE id_hash = ?').bind(id).run();
}

export async function cleanupAuthState(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE id_hash IN (SELECT id_hash FROM admin_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)')
    .bind(Date.now()).run();
  await db.prepare('DELETE FROM admin_login_limits WHERE id_hash IN (SELECT id_hash FROM admin_login_limits WHERE window_start < ? ORDER BY window_start LIMIT 100)')
    .bind(Date.now() - LOGIN_WINDOW_MS).run();
}
