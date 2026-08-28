import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  getCachedPublicRankings,
  rankingsForArticle,
} from './publicRankingCache.ts';

class MemoryCache {
  values = new Map();

  async match(request) {
    return this.values.get(request.url)?.clone();
  }

  async put(request, response) {
    this.values.set(request.url, response.clone());
  }
}

const ranking = {
  top48h: [{ path: '/a', views: 10 }, { path: '/b', views: 9 }],
  top24h: [{ path: '/a', views: 5 }, { path: '/c', views: 4 }],
};

test('reutiliza o ranking público sem consultar o D1 novamente', async () => {
  const cache = new MemoryCache();
  let loads = 0;
  const load = async () => { loads += 1; return ranking; };

  const first = await getCachedPublicRankings({ cache, origin: 'https://example.com', version: '1', load });
  const second = await getCachedPublicRankings({ cache, origin: 'https://example.com', version: '1', load });

  assert.deepEqual(first, ranking);
  assert.deepEqual(second, ranking);
  assert.equal(loads, 1);
});

test('agrupa misses simultâneos no mesmo carregamento', async () => {
  const cache = new MemoryCache();
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const load = async () => { loads += 1; await gate; return ranking; };

  const first = getCachedPublicRankings({ cache, origin: 'https://example.com', version: '2', load });
  const second = getCachedPublicRankings({ cache, origin: 'https://example.com', version: '2', load });
  release();

  assert.deepEqual(await first, ranking);
  assert.deepEqual(await second, ranking);
  assert.equal(loads, 1);
});

test('falha do ranking degrada para listas vazias e recebe cache curto', async () => {
  const cache = new MemoryCache();
  let loads = 0;
  let errors = 0;
  const load = async () => { loads += 1; throw new Error('D1 overloaded'); };
  const onError = () => { errors += 1; };

  const first = await getCachedPublicRankings({ cache, origin: 'https://example.com', version: '3', load, onError });
  const second = await getCachedPublicRankings({ cache, origin: 'https://example.com', version: '3', load, onError });

  assert.deepEqual(first, { top48h: [], top24h: [], degraded: true });
  assert.deepEqual(second, first);
  assert.equal(loads, 1);
  assert.equal(errors, 1);
});

test('remove o artigo atual depois de carregar o ranking compartilhado', () => {
  assert.deepEqual(rankingsForArticle(ranking, '/a'), {
    topViews: [{ path: '/b', views: 9 }],
    top24h: [{ path: '/c', views: 4 }],
  });
});

test('rota pública usa o cache de ranking em vez de consultar duas vezes por artigo', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, 'index.ts'), 'utf8');

  assert.match(source, /getCachedPublicRankings/);
  assert.match(source, /rankingsForArticle/);
  assert.doesNotMatch(source, /topPublicPostsByViews\(env\.DB, 48, 12, pathname\)/);
  assert.doesNotMatch(source, /topPublicPostsByViews\(env\.DB, 24, 4, pathname\)/);
});
