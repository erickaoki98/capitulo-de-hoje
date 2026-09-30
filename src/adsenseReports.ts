import type { Env } from './types';

const ROOT = '_internal/adsense-v1/';
const CONNECTION = ROOT + 'connection';
const REPORT = ROOT + 'report';
const GUARD = ROOT + 'guard';
export const SYNC_INTERVAL = 60 * 60 * 1000;
export const ADSENSE_SCOPE = 'https://www.googleapis.com/auth/adsense.readonly';
export const METRICS = ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'IMPRESSIONS', 'CLICKS', 'PAGE_VIEWS_RPM', 'PAGE_VIEWS_CTR'] as const;
export interface Connection { email: string; account: string; timeZone: string; refreshToken: string; id: string }
export interface ReportRow { date: string; values: number[] }
export interface ReportSnapshot {
  connectionId: string; generatedAt: number; start: string; end: string; domain: string;
  currency: string; timeZone: string; rows: ReportRow[]; totals: number[]; warnings: string[];
}
export interface SyncGuard { nextAttemptAt: number; status: 'syncing' | 'ready' | 'error'; error?: string }
export interface ReportsView {
  configured: boolean; email: string; connected: boolean; account?: string;
  snapshot: ReportSnapshot | null; guard: SyncGuard | null; error?: string;
}
export class AdSenseError extends Error {}
const enc = new TextEncoder();
function base64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function bytes(s: string): Uint8Array { return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
export function randomToken(): string { return base64(crypto.getRandomValues(new Uint8Array(32))); }
export async function digest(s: string): Promise<string> { return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))); }
async function encryptionKey(env: Env): Promise<CryptoKey> {
  if (!env.SESSION_SECRET) throw new AdSenseError('Sessão administrativa não configurada.');
  const material = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('cdh-adsense-v1'), info: enc.encode('private-storage') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(env: Env, purpose: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(purpose) }, await encryptionKey(env), enc.encode(JSON.stringify(value)));
  return base64(iv) + '.' + base64(new Uint8Array(cipher));
}
export async function unseal<T>(env: Env, purpose: string, value: string): Promise<T> {
  const [iv, cipher] = value.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: enc.encode(purpose) }, await encryptionKey(env), bytes(cipher));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
async function readPrivate<T>(env: Env, key: string): Promise<T | null> {
  const object = await env.IMAGES.get(key);
  return object ? unseal<T>(env, key, await object.text()) : null;
}
async function writePrivate(env: Env, key: string, value: unknown): Promise<void> {
  await env.IMAGES.put(key, await seal(env, key, value), { httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' } });
}
export function isConfigured(env: Env): boolean {
  return !!(env.ADSENSE_CLIENT_ID && env.ADSENSE_CLIENT_SECRET && env.ADSENSE_GOOGLE_EMAIL && env.CANONICAL_URL?.startsWith('https://'));
}
export function callbackUrl(env: Env): string { return new URL('/admin/adsense/callback', env.CANONICAL_URL).href; }
export async function googleJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new AdSenseError(response.status === 401 ? 'Autorização expirada. Reconecte a conta Google.' : response.status === 403 ? 'Acesso negado. Verifique a permissão de leitura e a API AdSense no Google Cloud.' : `O Google não respondeu ao relatório (HTTP ${response.status}).`);
  return response.json() as Promise<T>;
}
export async function exchangeToken(env: Env, fields: Record<string, string>): Promise<{access_token: string; refresh_token?: string; scope?: string}> {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: env.ADSENSE_CLIENT_ID!, client_secret: env.ADSENSE_CLIENT_SECRET!, ...fields }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new AdSenseError('Não foi possível renovar a autorização Google. Reconecte a conta ou verifique o cliente OAuth.');
  const result = await response.json() as { access_token: string; refresh_token?: string; scope?: string };
  if (!result.access_token) throw new AdSenseError('O Google não forneceu uma autorização válida.');
  return result;
}
export async function saveConnection(env: Env, token: {access_token: string; refresh_token?: string}, publisherId: string): Promise<void> {
  const user = await googleJson<{ email?: string; email_verified?: boolean }>('https://openidconnect.googleapis.com/v1/userinfo', token.access_token);
  if (!user.email || !user.email_verified || user.email.toLowerCase() !== env.ADSENSE_GOOGLE_EMAIL?.toLowerCase()) throw new AdSenseError('A conta Google autorizada não corresponde à conta solicitada.');
  if (!token.refresh_token) throw new AdSenseError('Autorize o acesso contínuo para sincronizar. Tente conectar novamente.');
  const publisher = publisherId.replace(/^ca-/, '');
  if (!/^pub-\d{16}$/.test(publisher)) throw new AdSenseError('Configure primeiro o Publisher ID correto em Monetização.');
  const account = await googleJson<{ name: string; timeZone?: { id: string } }>(`https://adsense.googleapis.com/v2/accounts/${publisher}`, token.access_token);
  if (account.name !== `accounts/${publisher}` || !account.timeZone?.id) throw new AdSenseError('A conta AdSense não retornou o identificador ou fuso esperado.');
  new Intl.DateTimeFormat('en', { timeZone: account.timeZone.id }).format();
  await writePrivate(env, CONNECTION, { id: randomToken(), email: user.email, account: account.name, timeZone: account.timeZone.id, refreshToken: token.refresh_token } satisfies Connection);
}
export function reportPeriod(timeZone: string, now = Date.now()): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
  const today = Date.UTC(get('year'), get('month') - 1, get('day'));
  return { start: new Date(today - 30 * 86400000).toISOString().slice(0, 10), end: new Date(today - 86400000).toISOString().slice(0, 10) };
}
export function reportUrl(account: string, domain: string, period: {start: string; end: string}): string {
  if (!/^accounts\/pub-\d{16}$/.test(account) || !/^[a-z0-9.-]+$/.test(domain)) throw new AdSenseError('Conta ou domínio inválido.');
  const url = new URL(`https://adsense.googleapis.com/v2/${account}/reports:generate`);
  url.searchParams.set('dateRange', 'CUSTOM');
  for (const [key, value] of [['startDate', period.start], ['endDate', period.end]]) {
    const [year, month, day] = value.split('-');
    for (const [unit, part] of [['year', year], ['month', month], ['day', day]]) url.searchParams.set(`${key}.${unit}`, String(Number(part)));
  }
  url.searchParams.set('dimensions', 'DATE');
  METRICS.forEach(metric => url.searchParams.append('metrics', metric));
  url.searchParams.set('filters', `DOMAIN_CODE==${domain},DOMAIN_CODE==www.${domain}`);
  url.searchParams.set('reportingTimeZone', 'ACCOUNT_TIME_ZONE');
  url.searchParams.set('orderBy', '+DATE');
  url.searchParams.set('limit', '31');
  return url.href;
}
interface RawReport {
  headers?: { name: string; currencyCode?: string }[];
  rows?: { cells: { value: string }[] }[];
  totals?: { cells: { value: string }[] };
  totalMatchedRows?: string; warnings?: string[];
}
export function parseReport(raw: RawReport): Pick<ReportSnapshot, 'currency' | 'rows' | 'totals' | 'warnings'> {
  const headers = raw.headers ?? [];
  const indexes = METRICS.map(name => headers.findIndex(h => h.name === name));
  const dateIndex = headers.findIndex(h => h.name === 'DATE');
  if (dateIndex < 0 || indexes.some(i => i < 0)) throw new AdSenseError('Relatório recebido em formato inesperado.');
  const currency = headers[indexes[0]].currencyCode;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new AdSenseError('O relatório não informou a moeda.');
  const rows = raw.rows ?? [];
  if (rows.length > 30 || Number(raw.totalMatchedRows ?? rows.length) > rows.length) throw new AdSenseError('Relatório truncado. Os dados anteriores foram preservados.');
  function values(row: {cells: {value: string}[]}): number[] {
    return indexes.map(i => {
      const v = row.cells[i]?.value;
      if (v === undefined || v.trim() === '' || !Number.isFinite(Number(v))) throw new AdSenseError('O relatório contém uma métrica inválida.');
      return Number(v);
    });
  }
  const parsed = rows.map(row => {
    const date = row.cells[dateIndex]?.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AdSenseError('O relatório contém uma data inválida.');
    return { date, values: values(row) };
  });
  if (new Set(parsed.map(r => r.date)).size !== parsed.length) throw new AdSenseError('O relatório contém datas duplicadas.');
  if (rows.length && !raw.totals) throw new AdSenseError('O relatório não retornou os totais.');
  return { currency, rows: parsed, totals: raw.totals ? values(raw.totals) : METRICS.map(() => 0), warnings: raw.warnings ?? [] };
}
export function safeError(e: unknown): string { return e instanceof AdSenseError ? e.message : 'Sincronização indisponível. Os últimos dados válidos foram preservados.'; }
export async function reportsView(env: Env): Promise<ReportsView> {
  const base: ReportsView = { configured: isConfigured(env), email: env.ADSENSE_GOOGLE_EMAIL ?? '', connected: false, snapshot: null, guard: null };
  if (!base.configured) return base;
  try {
    const connection = await readPrivate<Connection>(env, CONNECTION);
    if (!connection) return base;
    const [snapshot, object] = await Promise.all([readPrivate<ReportSnapshot>(env, REPORT), env.IMAGES.get(GUARD)]);
    return { ...base, connected: true, account: connection.account, snapshot: snapshot?.connectionId === connection.id ? snapshot : null, guard: object ? await object.json<SyncGuard>() : null };
  } catch (e) { return { ...base, error: safeError(e) }; }
}
/** Both cron and explicit admin refresh use one conditional global reservation. Failures consume it. */
export async function syncReports(env: Env, now = Date.now()): Promise<'disabled' | 'disconnected' | 'limited' | 'ready' | 'error'> {
  if (!isConfigured(env)) return 'disabled';
  try {
    const connection = await readPrivate<Connection>(env, CONNECTION);
    if (!connection) return 'disconnected';
    const previous = await env.IMAGES.get(GUARD);
    const guard = previous ? await previous.json<SyncGuard>() : null;
    if (guard && (!Number.isFinite(guard.nextAttemptAt) || guard.nextAttemptAt > now)) return 'limited';
    const reserved: SyncGuard = { nextAttemptAt: now + SYNC_INTERVAL, status: 'syncing' };
    const reservation = await env.IMAGES.put(GUARD, JSON.stringify(reserved), { onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' } });
    if (!reservation) return 'limited';
    try {
      const token = await exchangeToken(env, { grant_type: 'refresh_token', refresh_token: connection.refreshToken });
      const domain = new URL(env.CANONICAL_URL!).hostname.replace(/^www\./, '');
      const period = reportPeriod(connection.timeZone, now);
      const raw = await googleJson<RawReport>(reportUrl(connection.account, domain, period), token.access_token);
      const parsed = parseReport(raw);
      if (parsed.rows.some(row => row.date < period.start || row.date > period.end)) throw new AdSenseError('O relatório retornou dados fora do período solicitado.');
      await writePrivate(env, REPORT, { ...parsed, ...period, domain, timeZone: connection.timeZone, connectionId: connection.id, generatedAt: now } satisfies ReportSnapshot);
      await env.IMAGES.put(GUARD, JSON.stringify({ ...reserved, status: 'ready' }), { onlyIf: { etagMatches: reservation.etag } });
      return 'ready';
    } catch (e) {
      await env.IMAGES.put(GUARD, JSON.stringify({ ...reserved, status: 'error', error: safeError(e) }), { onlyIf: { etagMatches: reservation.etag } });
      return 'error';
    }
  } catch { return 'error'; }
}
