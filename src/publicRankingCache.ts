export interface PublicRankingItem {
  path: string;
  views: number;
}

export interface PublicRankings {
  top48h: PublicRankingItem[];
  top24h: PublicRankingItem[];
  degraded?: boolean;
}

export interface RankingCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

const FRESH_TTL_SECONDS = 10 * 60;
const DEGRADED_TTL_SECONDS = 30;
const inFlight = new Map<string, Promise<PublicRankings>>();

function rankingCacheKey(origin: string, version: string): Request {
  const url = new URL('/__internal-cache/public-rankings', origin);
  url.searchParams.set('__cv', version);
  return new Request(url.toString());
}

async function store(
  cache: RankingCache,
  key: Request,
  value: PublicRankings,
  ttlSeconds: number,
): Promise<void> {
  await cache.put(key, new Response(JSON.stringify(value), {
    headers: {
      'Cache-Control': `public, max-age=${ttlSeconds}`,
      'Content-Type': 'application/json',
    },
  }));
}

export async function getCachedPublicRankings({
  cache,
  origin,
  version,
  load,
  onError = () => {},
}: {
  cache: RankingCache;
  origin: string;
  version: string;
  load: () => Promise<PublicRankings>;
  onError?: (error: unknown) => void;
}): Promise<PublicRankings> {
  const key = rankingCacheKey(origin, version);
  try {
    const cached = await cache.match(key);
    if (cached) return await cached.json<PublicRankings>();
  } catch (error) {
    onError(error);
  }

  const pending = inFlight.get(key.url);
  if (pending) return await pending;

  const loading = (async () => {
    let value: PublicRankings;
    let ttlSeconds = FRESH_TTL_SECONDS;
    try {
      value = await load();
    } catch (error) {
      onError(error);
      value = { top48h: [], top24h: [], degraded: true };
      ttlSeconds = DEGRADED_TTL_SECONDS;
    }

    try {
      await store(cache, key, value, ttlSeconds);
    } catch (error) {
      onError(error);
    }
    return value;
  })().finally(() => {
    inFlight.delete(key.url);
  });

  inFlight.set(key.url, loading);
  return await loading;
}

export function rankingsForArticle(
  rankings: PublicRankings,
  currentPath: string,
): { topViews: PublicRankingItem[]; top24h: PublicRankingItem[] } {
  return {
    topViews: rankings.top48h.filter((item) => item.path !== currentPath).slice(0, 12),
    top24h: rankings.top24h.filter((item) => item.path !== currentPath).slice(0, 4),
  };
}
