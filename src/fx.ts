/**
 * Cotação USD → BRL para converter o RPM do AdSense (que vem em dólar) no teste nativo.
 * Fonte pública sem chave (AwesomeAPI). Cache de 6 h na Cache API da borda; só é chamada no
 * admin. Retorna null se a fonte falhar — aí o painel pede a cotação manual.
 */
const FX_URL = 'https://economia.awesomeapi.com.br/json/last/USD-BRL';
const CACHE_KEY = 'https://capitulodehoje.internal/fx/usd-brl-v1';

export interface FxRate { rate: number; at: number }

/** Valida a resposta da AwesomeAPI (faixa plausível evita usar lixo como cotação). */
export function parseUsdBrl(json: unknown, now = Date.now()): FxRate | null {
  const bid = Number((json as { USDBRL?: { bid?: string } } | null)?.USDBRL?.bid);
  return Number.isFinite(bid) && bid > 1 && bid < 20 ? { rate: bid, at: now } : null;
}

export async function usdBrl(): Promise<FxRate | null> {
  const key = new Request(CACHE_KEY);
  try {
    const hit = await caches.default.match(key);
    if (hit) return await hit.json<FxRate>();
  } catch { /* cache indisponível: segue para a fonte */ }
  try {
    const res = await fetch(FX_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const value = parseUsdBrl(await res.json());
    if (!value) return null;
    try {
      await caches.default.put(key, new Response(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=21600' },
      }));
    } catch { /* sem cache: tudo bem */ }
    return value;
  } catch {
    return null;
  }
}
