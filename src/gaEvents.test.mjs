import assert from 'node:assert/strict';
import test from 'node:test';

import { gaConfigParams, gaContentGroup, renderGaEventsScript } from './gaEvents.ts';
import { parseNativeConfig, renderMixRuntime } from './nativeAds.ts';

const scriptBody = (html) => html.replace(/^<script>/, '').replace(/<\/script>$/, '');

test('gaContentGroup: novela no artigo, Home na home, Institucional no resto', () => {
  assert.equal(gaContentGroup({ type: 'article', category: 'A Nobreza do Amor', path: '/x' }), 'A Nobreza do Amor');
  assert.equal(gaContentGroup({ type: 'article', category: 'Sem categoria', path: '/x' }), 'Sem novela');
  assert.equal(gaContentGroup({ type: 'article', category: '', path: '/x' }), 'Sem novela');
  assert.equal(gaContentGroup({ type: 'website', path: '/' }), 'Home');
  assert.equal(gaContentGroup({ type: 'website', path: '/privacidade' }), 'Institucional');
});

test('gaConfigParams gera JSON seguro dentro de <script>', () => {
  const js = gaConfigParams('Novela </script><b>');
  assert.doesNotMatch(js, /<\/script>/);
  assert.deepEqual(JSON.parse(js), { content_group: 'Novela </script><b>' });
});

test('script de eventos é JavaScript válido, ES5 e sem </script> no meio', () => {
  const html = renderGaEventsScript();
  const body = scriptBody(html);
  assert.doesNotThrow(() => new Function(body));
  assert.doesNotMatch(body, /<\/script>/i);
  assert.doesNotMatch(body, /=>|\bconst\b|\blet\b|`/);
  for (const name of ['ad_unit_click', 'read_progress', 'select_content', 'share', 'adblock_detected']) {
    assert.match(body, new RegExp(`'${name}'`));
  }
  // Nomes reservados do GA4 não podem ser usados como evento.
  assert.doesNotMatch(body, /ev\('ad_(click|impression)'/);
});

test('runtime dos banners nativos também é JavaScript válido e marca o criativo no link', () => {
  const cfg = parseNativeConfig(JSON.stringify({
    enabled: true, share: 30, testId: 'abc',
    creatives: [{ id: 'v1', label: 'V1', alt: 'a', images: { '16x9': { src: '/img/nv-a.jpg', href: 'https://a.example/', w: 1200, h: 675 } } }],
  }));
  const body = scriptBody(renderMixRuntime(cfg, 'https://x.example/adsbygoogle.js').trim());
  assert.doesNotThrow(() => new Function(body));
  assert.match(body, /setAttribute\('data-cr',c\.i\)/);
});
