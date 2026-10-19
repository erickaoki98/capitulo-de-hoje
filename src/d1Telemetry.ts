/** Per-invocation telemetry, not an account-wide spending cutoff.
 * No retries, database writes, bind values or raw SQL in logs. Essential work is preserved.
 */
const GUARDED = Symbol.for('cdh.d1.telemetry');
const RAW = Symbol('raw');
export interface D1Pressure {
  scope: string; reason: string; queryKey: string; queries: number;
  rowsRead: number; rowsWritten: number; elapsedMs: number;
}
function fingerprint(sql: string): string {
  let hash = 2166136261;
  for (let i = 0; i < sql.length; i++) hash = Math.imul(hash ^ sql.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function withD1Telemetry(
  db: D1Database, scope: string,
  warn: (event: D1Pressure) => void = event => console.warn('[d1-pressure]', JSON.stringify(event)),
): D1Database {
  if ((db as unknown as Record<symbol, unknown>)[GUARDED]) return db;
  let queries = 0, rowsRead = 0, rowsWritten = 0;
  const reported = new Set<string>();
  function report(reason: string, key: string, elapsedMs: number) {
    if (reported.has(reason) || reported.size >= 4) return;
    reported.add(reason);
    try { warn({scope, reason, queryKey: key, queries, rowsRead, rowsWritten, elapsedMs: Math.round(elapsedMs)}); } catch { /* Logging cannot break a request. */ }
  }
  async function measure<T>(run: () => Promise<T>, key: string, count = 1): Promise<T> {
    const start = performance.now(); queries += count;
    try {
      const result = await run();
      const results = (Array.isArray(result) ? result : [result]) as Array<{meta?: {rows_read?: number; rows_written?: number}}>;
      for (const r of results) { rowsRead += r?.meta?.rows_read ?? 0; rowsWritten += r?.meta?.rows_written ?? 0; }
      const elapsed = performance.now() - start;
      if (rowsRead > 100_000 || rowsWritten > 1_000 || queries > 100) report('budget', key, elapsed);
      const sqlDuration = (result as {meta?: {duration?: number}})?.meta?.duration ?? 0;
      if (elapsed > 250 || sqlDuration > 250) report('slow', key, elapsed);
      return result;
    } catch (error) {
      report(/overloaded|queued for too long/i.test(String(error)) ? 'overload' : 'error', key, performance.now() - start);
      throw error;
    }
  }
  function statement(stmt: D1PreparedStatement, key: string): D1PreparedStatement {
    return new Proxy(stmt, {get(target, prop) {
      if (prop === RAW) return target;
      if (prop === 'bind') return (...args: unknown[]) => statement(target.bind(...args), key);
      if (prop === 'all') return () => measure(() => target.all(), key);
      if (prop === 'run') return () => measure(() => target.run(), key);
      if (prop === 'first') return async (column?: string) => {
        const res = await measure(() => target.all<Record<string, unknown>>(), key);
        const row = res.results?.[0] ?? null;
        if (row && column !== undefined && !(column in row)) throw new Error('D1_COLUMN_NOTFOUND');
        return row && column !== undefined ? row[column] : row;
      };
      if (prop === 'raw') return (options?: {columnNames?: boolean}) => measure(() => options?.columnNames ? target.raw({columnNames: true}) : target.raw(), key);
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }});
  }
  return new Proxy(db, {get(target, prop) {
    if (prop === GUARDED) return true;
    if (prop === 'prepare') return (sql: string) => statement(target.prepare(sql), fingerprint(sql));
    if (prop === 'batch') return (statements: D1PreparedStatement[]) => measure(
      () => target.batch(statements.map(s => (s as unknown as Record<symbol, D1PreparedStatement>)[RAW] ?? s)),
      'batch', statements.length,
    );
    if (prop === 'exec') return (sql: string) => measure(() => target.exec(sql), fingerprint(sql));
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
}
