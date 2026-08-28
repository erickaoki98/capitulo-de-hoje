import assert from 'node:assert/strict';
import test from 'node:test';

import { publicCacheKeyUrl } from './publicCacheKey.ts';

test('tracking do Facebook e campanhas compartilham a URL canônica do cache', () => {
  const key = publicCacheKeyUrl(
    'https://capitulodehoje.com.br/artigo?fbclid=abc&utm_source=facebook&utm_medium=social&gclid=123',
    '7',
  );

  assert.equal(key, 'https://capitulodehoje.com.br/artigo?__cv=7');
});

test('parâmetros funcionais permanecem separados no cache', () => {
  const key = publicCacheKeyUrl(
    'https://capitulodehoje.com.br/?page=2&utm_campaign=novelas',
    '8',
  );

  assert.equal(key, 'https://capitulodehoje.com.br/?page=2&__cv=8');
});
