const TRACKING_QUERY_PARAM = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;

export function publicCacheKeyUrl(requestUrl: string, version: string): string {
  const url = new URL(requestUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_QUERY_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.set('__cv', version);
  return url.toString();
}
