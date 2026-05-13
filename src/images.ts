// Migração de imagens do WordPress para Cloudflare R2.
// Faz download da URL original, faz upload no R2 com nome derivado de hash,
// e reescreve URLs no conteúdo HTML para apontar para /img/<filename>.

const FETCH_TIMEOUT_MS = 5_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB

export interface ImageMigrationStats {
  totalFound: number;
  uniqueFound: number;
  migrated: number;
  failed: Array<{ url: string; error: string }>;
  skipped: number; // já existia no R2 (dedupe)
}

/**
 * Extrai URLs de imagens de uma string HTML (atributos src de <img>).
 */
export function extractImageUrls(html: string): string[] {
  const urls = new Set<string>();
  // <img src="..."> — case-insensitive, aceita aspas simples e duplas
  const regex = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const u = match[1].trim();
    if (u && /^https?:\/\//i.test(u)) urls.add(u);
  }
  // srcset também (toma só a primeira variante de cada)
  const srcsetRegex = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
  while ((match = srcsetRegex.exec(html)) !== null) {
    for (const piece of match[1].split(',')) {
      const url = piece.trim().split(/\s+/)[0];
      if (url && /^https?:\/\//i.test(url)) urls.add(url);
    }
  }
  return Array.from(urls);
}

/**
 * Gera um nome de arquivo determinístico baseado em hash da URL.
 * Preserva a extensão original.
 */
async function generateFilename(url: string): Promise<string> {
  // hash sha-256 truncado em 16 chars hex
  const data = new TextEncoder().encode(url);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
  // extrai extensão
  const pathPart = url.split('?')[0].split('#')[0];
  const m = pathPart.match(/\.([a-zA-Z0-9]{2,5})$/);
  const ext = m ? m[1].toLowerCase() : 'bin';
  return `${hex}.${ext}`;
}

/**
 * Detecta Content-Type pela extensão (fallback se o servidor não enviar).
 */
function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Faz fetch com timeout.
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CapituloDeHoje-Importer/1.0)',
      },
      cf: { cacheTtl: 0 },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Migra uma única imagem. Retorna o novo path (/img/xxx.jpg) ou null em caso de erro.
 */
async function migrateOne(
  url: string,
  bucket: R2Bucket,
): Promise<{ newPath: string; skipped: boolean } | { error: string }> {
  try {
    const filename = await generateFilename(url);

    // dedupe: se já existe no R2, retorna o path
    const existing = await bucket.head(filename);
    if (existing) {
      return { newPath: `/img/${filename}`, skipped: true };
    }

    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return { error: `HTTP ${res.status}` };

    // limita tamanho via Content-Length
    const lenHeader = res.headers.get('Content-Length');
    if (lenHeader && Number(lenHeader) > MAX_IMAGE_BYTES) {
      return { error: `imagem muito grande: ${lenHeader} bytes` };
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      return { error: `imagem muito grande: ${buf.byteLength} bytes` };
    }

    const contentType =
      res.headers.get('Content-Type')?.split(';')[0].trim() || guessContentType(filename);

    await bucket.put(filename, buf, {
      httpMetadata: { contentType },
      customMetadata: { 'source-url': url.slice(0, 1024) },
    });

    return { newPath: `/img/${filename}`, skipped: false };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Migra todas as imagens de um conjunto de URLs para o R2.
 * Retorna um mapa { urlOriginal: urlLocal } e estatísticas.
 */
export async function migrateImages(
  urls: string[],
  bucket: R2Bucket,
): Promise<{ urlMap: Map<string, string>; stats: ImageMigrationStats }> {
  const unique = Array.from(new Set(urls));
  const urlMap = new Map<string, string>();
  const stats: ImageMigrationStats = {
    totalFound: urls.length,
    uniqueFound: unique.length,
    migrated: 0,
    failed: [],
    skipped: 0,
  };

  // processa sequencialmente — Workers tem CPU limit, mas fetches em paralelo
  // estouram limite de subrequests. 1 a 1 com timeout curto é mais previsível.
  for (const url of unique) {
    const result = await migrateOne(url, bucket);
    if ('error' in result) {
      stats.failed.push({ url, error: result.error });
    } else {
      urlMap.set(url, result.newPath);
      if (result.skipped) stats.skipped++;
      else stats.migrated++;
    }
  }

  return { urlMap, stats };
}

/**
 * Reescreve URLs em uma string HTML usando o mapa de tradução.
 */
export function rewriteHtmlUrls(html: string, urlMap: Map<string, string>): string {
  let out = html;
  for (const [oldUrl, newUrl] of urlMap) {
    // escape de caracteres regex
    const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), newUrl);
  }
  return out;
}

/**
 * Migra imagens com orçamento de tempo e subrequests.
 * Bota um teto pra garantir que a request termina antes do CPU/wall-time limit.
 */
export interface MigrationBudget {
  /** epoch ms quando começou */
  startedAt: number;
  /** ms até bater no limite (default 20s) */
  maxWallTimeMs: number;
  /** máx imagens a baixar nessa request */
  maxImages: number;
}

export async function migrateImagesWithBudget(
  urls: string[],
  bucket: R2Bucket,
  budget: MigrationBudget,
): Promise<{
  urlMap: Map<string, string>;
  stats: ImageMigrationStats;
  exhausted: boolean;
}> {
  const unique = Array.from(new Set(urls));
  const urlMap = new Map<string, string>();
  const stats: ImageMigrationStats = {
    totalFound: urls.length,
    uniqueFound: unique.length,
    migrated: 0,
    failed: [],
    skipped: 0,
  };

  let exhausted = false;
  // Paraleliza em workers (Promise.all de N URLs por vez)
  const CONCURRENCY = 8;
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (true) {
      // pega próximo URL
      const idx = nextIdx++;
      if (idx >= unique.length) return;
      if (idx >= budget.maxImages) { exhausted = true; return; }
      if (Date.now() - budget.startedAt > budget.maxWallTimeMs) { exhausted = true; return; }

      const url = unique[idx];
      const result = await migrateOne(url, bucket);
      if ('error' in result) {
        stats.failed.push({ url, error: result.error });
      } else {
        urlMap.set(url, result.newPath);
        if (result.skipped) stats.skipped++;
        else stats.migrated++;
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  return { urlMap, stats, exhausted };
}
