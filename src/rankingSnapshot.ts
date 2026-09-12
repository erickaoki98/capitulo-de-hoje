import { normalizeCategoryKey } from './archive.ts';

// Limites fixos: tráfego, parâmetros de URL e cache purge não ampliam esse trabalho.
export const REFRESH_MS = 30 * 60_000;
export const MAX_AGE_MS = 48 * 3600_000;
export const MAX_VIEW_ROWS = 100_000;
export const MAX_POST_ROWS = 20_000;
export const MAX_ARCHIVE_ROWS = 100;
export const STATE_KEY = '_internal/d1-ranking-guard-v1.json';
export interface RankedPath { path: string; views: number }
export interface RankingSnapshot {
  generatedAt: number;
  top48h: RankedPath[];
  top24h: RankedPath[];
}
interface RankingState {
  nextAttemptAt: number;
  snapshot: RankingSnapshot | null;
  status: 'refreshing' | 'ready' | 'blocked';
}
const EMPTY: RankingSnapshot = { generatedAt: 0, top48h: [], top24h: [] };

// INDEXED BY impede fallback silencioso para um scan de todo o histórico.
// LIMIT restringe a entrada, antes de qualquer filtro/agregação em JavaScript.
export const VIEW_SQL = `SELECT bucket, path, count
  FROM pageviews_hourly INDEXED BY idx_ph_bucket_path_count
  WHERE bucket >= ? ORDER BY bucket DESC LIMIT ?`;
export const POST_SQL = `SELECT slug, category, draft FROM posts ORDER BY id LIMIT ?`;
export const ARCHIVE_SQL = `SELECT category_key FROM archived_categories LIMIT ?`;

function bounded<T>(rows: T[], limit: number): T[] {
  if (rows.length > limit) throw new Error('ranking_input_budget_exceeded');
  return rows;
}

/** Só a rotina agendada pode chamar este produtor. Nunca como fallback de request. */
export async function buildRankingSnapshot(db: D1Database, now: number): Promise<RankingSnapshot> {
  const archives = await db.prepare(ARCHIVE_SQL).bind(MAX_ARCHIVE_ROWS + 1)
    .all<{ category_key: string }>();
  const archived = new Set(bounded(archives.results ?? [], MAX_ARCHIVE_ROWS).map(r => r.category_key));
  const posts = await db.prepare(POST_SQL).bind(MAX_POST_ROWS + 1)
    .all<{ slug: string; category: string | null; draft: number }>();
  const visible = new Set(bounded(posts.results ?? [], MAX_POST_ROWS)
    .filter(p => !p.draft && !archived.has(normalizeCategoryKey(p.category)))
    .map(p => '/' + p.slug));
  const since48 = new Date(now - MAX_AGE_MS).toISOString().slice(0, 13);
  const since24 = new Date(now - 24 * 3600_000).toISOString().slice(0, 13);
  const result = await db.prepare(VIEW_SQL).bind(since48, MAX_VIEW_ROWS + 1)
    .all<{ bucket: string; path: string; count: number }>();
  const rows = bounded(result.results ?? [], MAX_VIEW_ROWS);
  const totals48 = new Map<string, number>();
  const totals24 = new Map<string, number>();
  for (const row of rows) {
    if (!visible.has(row.path)) continue;
    totals48.set(row.path, (totals48.get(row.path) ?? 0) + row.count);
    if (row.bucket >= since24) totals24.set(row.path, (totals24.get(row.path) ?? 0) + row.count);
  }
  const rank = (totals: Map<string, number>) => [...totals]
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path)).slice(0, 100);
  return { generatedAt: now, top48h: rank(totals48), top24h: rank(totals24) };
}

/** Reserva no R2 antes do D1. CAS evita múltiplos crons/isolate/retry no mesmo intervalo. */
export async function refreshRankingSnapshot(
  bucket: R2Bucket, db: D1Database, now = Date.now(),
  onError: (error: unknown) => void = error => console.error('[d1-ranking-guard]', error),
): Promise<'ready' | 'skipped' | 'blocked'> {
  try {
    const object = await bucket.get(STATE_KEY);
    const state = object ? await object.json<RankingState>() : null;
    if (state && (!Number.isFinite(state.nextAttemptAt) || state.nextAttemptAt > now)) return 'skipped';
    const reserved: RankingState = {
      nextAttemptAt: now + REFRESH_MS,
      snapshot: state?.snapshot ?? null,
      status: 'refreshing',
    };
    const claim = await bucket.put(STATE_KEY, JSON.stringify(reserved), {
      onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: '*' },
    });
    if (!claim) return 'skipped';
    try {
      reserved.snapshot = await buildRankingSnapshot(db, now);
      reserved.status = 'ready';
    } catch (error) {
      // Reserva continua consumida mesmo em erro; não tentar outra vez a cada minuto.
      reserved.status = 'blocked';
      onError(error);
    }
    const saved = await bucket.put(STATE_KEY, JSON.stringify(reserved), { onlyIf: { etagMatches: claim.etag } });
    if (!saved) return 'blocked';
    return reserved.status === 'ready' ? 'ready' : 'blocked';
  } catch (error) {
    // Sem R2 não há reserva, portanto não há consulta de ranking no D1.
    onError(error);
    return 'blocked';
  }
}

function validSnapshot(value: unknown, now: number): value is RankingSnapshot {
  const s = value as RankingSnapshot | null;
  const paths = (rows: unknown): rows is RankedPath[] => Array.isArray(rows) && rows.length <= 100 && rows.every(
    row => row && typeof row.path === 'string' && /^\/[a-z0-9-]+$/.test(row.path)
      && Number.isFinite(row.views) && row.views >= 0,
  );
  return !!s && Number.isFinite(s.generatedAt) && s.generatedAt <= now
    && now - s.generatedAt <= MAX_AGE_MS && paths(s.top48h) && paths(s.top24h);
}

/** Leitor não recebe DB: cache frio, expirado ou indisponível nunca dispara agregação. */
export async function readRankingSnapshot(bucket: R2Bucket, cache: Cache, origin: string, now = Date.now()): Promise<RankingSnapshot> {
  const key = new Request(new URL('/__internal-cache/rankings-guard-v1', origin));
  try {
    const cached = await cache.match(key);
    if (cached) {
      const snapshot: unknown = await cached.json();
      if (validSnapshot(snapshot, now)) return snapshot;
      // Sentinel vazio também recebe cache curto para não bater no R2 por visitante.
      const empty = snapshot as RankingSnapshot | null;
      if (empty?.generatedAt === 0 && Array.isArray(empty.top48h) && !empty.top48h.length
        && Array.isArray(empty.top24h) && !empty.top24h.length) return EMPTY;
    }
  } catch { /* R2 permanece disponível quando só o cache falha. */ }
  let snapshot = EMPTY;
  try {
    const object = await bucket.get(STATE_KEY);
    const state = object ? await object.json<RankingState>() : null;
    if (validSnapshot(state?.snapshot, now)) snapshot = state!.snapshot!;
  } catch { /* Fallback barato: artigos recentes, nunca recalcular ranking. */ }
  try {
    await cache.put(key, new Response(JSON.stringify(snapshot), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    }));
  } catch { /* Falha de cache não abre acesso ao D1. */ }
  return snapshot;
}

export function rankingsForArticle(snapshot: RankingSnapshot, path: string) {
  return {
    topViews: snapshot.top48h.filter(row => row.path !== path).slice(0, 12),
    top24h: snapshot.top24h.filter(row => row.path !== path).slice(0, 4),
  };
}
