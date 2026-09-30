import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMixReport,
  detectFormat,
  mergeCreatives,
  mixPlacementOn,
  nativeActive,
  parseBannerSnippets,
  parseNativeConfig,
  probabilityBest,
  renderMixRuntime,
  renderMixSlot,
  runtimeConfig,
  sanitizeEventBatch,
  wilson,
} from './nativeAds.ts';

// Página no mesmo formato da de banners: <h2> por variação + códigos escapados em <textarea>.
const snippet = (id, fmt, w, h, alt) =>
  `<textarea readonly>&lt;a href=&quot;https://loja.example/?utm_source=cdh&amp;utm_content=${id}-${fmt}&quot; target=&quot;_blank&quot; rel=&quot;sponsored noopener&quot;&gt;&lt;img src=&quot;https://loja.example/banners/${id}-${fmt}.jpg&quot; width=&quot;${w}&quot; height=&quot;${h}&quot; alt=&quot;${alt}&quot;&gt;&lt;/a&gt;</textarea>`;

const PAGE = `<main>
<h2>V1 · Nova fase</h2>
${snippet('v1-nova-fase', '300x250', 300, 250, 'Publicidade: Nova fase depois dos 40?')}
${snippet('v1-nova-fase', '320x100', 320, 100, 'Publicidade: Nova fase depois dos 40?')}
${snippet('v1-nova-fase', 'nativo-16x9', 1200, 675, 'Publicidade: Nova fase depois dos 40?')}
<h2>V2 · 30 segundos</h2>
${snippet('v2-30-segundos', '728x90', 728, 90, 'O cuidado de 30 segundos')}
${snippet('v2-30-segundos', '160x600', 160, 600, 'formato não suportado')}
</main>`;

function configWith(overrides = {}) {
  return parseNativeConfig(JSON.stringify({
    enabled: true,
    share: 30,
    testId: 'abc123',
    creatives: [
      {
        id: 'v1-nova-fase', label: 'V1', alt: 'Nova fase', active: true,
        images: {
          '16x9': { src: '/img/nv-a.jpg', href: 'https://loja.example/?a=1', w: 1200, h: 675 },
          '320x100': { src: '/img/nv-b.jpg', href: 'https://loja.example/?a=2', w: 320, h: 100 },
        },
      },
      {
        id: 'v2-30-segundos', label: 'V2', alt: '30s', active: true,
        images: { '728x90': { src: '/img/nv-c.jpg', href: 'https://loja.example/?a=3', w: 728, h: 90 } },
      },
    ],
    ...overrides,
  }));
}

test('parseBannerSnippets agrupa por criativo, detecta formato e rótulo', () => {
  const { banners, skipped } = parseBannerSnippets(PAGE, 'https://loja.example/banners');
  assert.equal(skipped, 1); // 160x600
  assert.deepEqual(
    banners.map((b) => [b.id, b.format, b.label]),
    [
      ['v1-nova-fase', '300x250', 'V1 · Nova fase'],
      ['v1-nova-fase', '320x100', 'V1 · Nova fase'],
      ['v1-nova-fase', '16x9', 'V1 · Nova fase'],
      ['v2-30-segundos', '728x90', 'V2 · 30 segundos'],
    ],
  );
  assert.equal(banners[0].href, 'https://loja.example/?utm_source=cdh&utm_content=v1-nova-fase-300x250');
  assert.equal(banners[2].src, 'https://loja.example/banners/v1-nova-fase-nativo-16x9.jpg');
});

test('parseBannerSnippets aceita códigos colados sem <textarea> e ignora href perigoso', () => {
  const pasted = '<a href="https://x.example/?u=1"><img src="/b/foo-300x250.jpg" width="300" height="250" alt="Foo"></a>'
    + '<a href="javascript:alert(1)"><img src="/b/bar-300x250.jpg" width="300" height="250"></a>';
  const { banners, skipped } = parseBannerSnippets(pasted, 'https://x.example/');
  assert.equal(banners.length, 1);
  assert.equal(banners[0].id, 'foo');
  assert.equal(banners[0].src, 'https://x.example/b/foo-300x250.jpg');
  assert.equal(skipped, 1);
});

test('detectFormat reconhece tamanhos IAB, 16:9 e nome de arquivo', () => {
  assert.equal(detectFormat(300, 250), '300x250');
  assert.equal(detectFormat(1920, 1080), '16x9');
  assert.equal(detectFormat(0, 0, 'x-320x50.png'), '320x50');
  assert.equal(detectFormat(0, 0, 'x-nativo-16x9.jpg'), '16x9');
  assert.equal(detectFormat(336, 280), null);
});

test('mergeCreatives atualiza sem apagar e mantém pausados', () => {
  const existing = [{ id: 'v1-nova-fase', label: 'Antigo', alt: '', active: false, images: {} }];
  const { banners } = parseBannerSnippets(PAGE, 'https://loja.example/banners');
  const srcMap = new Map([['https://loja.example/banners/v1-nova-fase-300x250.jpg', '/img/nv-1.jpg']]);
  const { creatives, added, updated } = mergeCreatives(existing, banners, srcMap);
  assert.equal(added, 1);
  assert.equal(updated, 1);
  const v1 = creatives.find((c) => c.id === 'v1-nova-fase');
  assert.equal(v1.active, false);
  assert.equal(v1.label, 'V1 · Nova fase');
  assert.equal(v1.images['300x250'].src, '/img/nv-1.jpg');
  assert.ok(v1.images['16x9']);
});

test('parseNativeConfig limita valores e descarta lixo', () => {
  const cfg = parseNativeConfig(JSON.stringify({
    share: 250, maxPerPage: 0, testId: 'BAD ID', adsenseRpm: -3,
    placements: { inContent: { on: true, format: 'gigante' } },
    creatives: [{ id: '', images: {} }, { id: 'ok', images: { '16x9': { src: 'javascript:x', href: 'https://a.b', w: 1, h: 1 } } }],
  }));
  assert.equal(cfg.share, 100);
  assert.equal(cfg.maxPerPage, 1);
  assert.equal(cfg.testId, '');
  assert.equal(cfg.adsenseRpm, 0);
  assert.equal(cfg.placements.inContent.format, '16x9');
  assert.equal(cfg.creatives.length, 1);
  assert.deepEqual(cfg.creatives[0].images, {});
  assert.equal(parseNativeConfig('{quebrado').enabled, false);
});

test('nativeActive exige teste ligado, share > 0, testId e criativo com formato em uso', () => {
  assert.equal(nativeActive(configWith()), true);
  assert.equal(nativeActive(configWith({ share: 0 })), false);
  assert.equal(nativeActive(configWith({ enabled: false })), false);
  assert.equal(nativeActive(configWith({ testId: '' })), false);
  // Só stickyFooter ligado (320x50) e nenhum criativo tem 320x50 → não roda.
  const onlySticky = Object.fromEntries(
    ['beforePost', 'topOfContent', 'inContent', 'afterContent', 'bottomOfPage', 'betweenCards', 'stickyFooter']
      .map((k) => [k, { on: k === 'stickyFooter', format: '320x50' }]),
  );
  assert.equal(nativeActive(configWith({ placements: onlySticky })), false);
  assert.equal(mixPlacementOn(configWith(), 'inContent'), true);
  assert.equal(mixPlacementOn(configWith(), 'stickyFooter'), false);
});

test('renderMixSlot embrulha o AdSense num <template> inerte', () => {
  const html = renderMixSlot('inContent', '<div class="ad-inarticle"><ins class="adsbygoogle"></ins></div>');
  assert.match(html, /^<div class="cdh-mix cdh-mix--inContent" data-pl="inContent"><template><div class="ad-inarticle">/);
  assert.match(html, /<\/template><\/div><script>window\.cdhMix&&cdhMix\(document\.currentScript\)<\/script>$/);
  assert.doesNotMatch(html, /push\(\{\}\)/);
});

test('runtime embute só criativos/tamanhos em uso e escapa </script>', () => {
  const cfg = configWith({ creatives: [...configWith().creatives, { id: 'x', label: 'x', alt: '</script><b>', active: true, images: { '16x9': { src: '/img/nv-z.jpg', href: 'https://a.b/', w: 1200, h: 675 } } }] });
  const rc = runtimeConfig(cfg);
  assert.deepEqual(rc.c.map((c) => c.i), ['v1-nova-fase', 'v2-30-segundos', 'x']);
  assert.deepEqual(Object.keys(rc.c[0].f).sort(), ['16x9', '320x100']);
  const js = renderMixRuntime(cfg);
  assert.doesNotMatch(js.slice(8, -9), /<\/script>/);
  assert.equal(renderMixRuntime(configWith({ enabled: false })), '');
});

test('sanitizeEventBatch valida teste, criativo, formato e agrega', () => {
  const cfg = configWith();
  const rows = sanitizeEventBatch({
    t: 'abc123',
    e: [
      ['inContent', 'native', 'v1-nova-fase', '16x9', 'imp', 1],
      ['inContent', 'native', 'v1-nova-fase', '16x9', 'imp', 2],
      ['inContent', 'native', 'v1-nova-fase', '16x9', 'click', 1],
      ['inContent', 'native', 'inventado', '16x9', 'imp', 1],
      ['inContent', 'adsense', '', '', 'imp', 1],
      ['inContent', 'adsense', '', '', 'click', 1],
      ['sidebar', 'native', 'v1-nova-fase', '16x9', 'imp', 1],
      ['inContent', 'native', 'v1-nova-fase', '16x9', 'imp', 1e9],
    ],
  }, cfg);
  assert.deepEqual(rows, [
    { placement: 'inContent', source: 'native', creative: 'v1-nova-fase', format: '16x9', event: 'imp', count: 100 },
    { placement: 'inContent', source: 'native', creative: 'v1-nova-fase', format: '16x9', event: 'click', count: 1 },
    { placement: 'inContent', source: 'adsense', creative: '', format: '', event: 'imp', count: 1 },
  ]);
  assert.deepEqual(sanitizeEventBatch({ t: 'outro', e: [['inContent', 'adsense', '', '', 'imp', 1]] }, cfg), []);
});

test('wilson e probabilityBest se comportam como esperado', () => {
  const ci = wilson(50, 10000);
  assert.ok(ci.low < 0.005 && ci.high > 0.005);
  assert.deepEqual(wilson(0, 0), { low: 0, high: 0 });
  const p = probabilityBest([{ clicks: 100, imps: 10000 }, { clicks: 50, imps: 10000 }]);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(p[0] > 0.95);
  // Banner quase sem dados (10 impressões, 0 cliques) não pode "ganhar" por sorte do prior.
  const sparse = probabilityBest([{ clicks: 100, imps: 10000 }, { clicks: 50, imps: 10000 }, { clicks: 0, imps: 10 }]);
  assert.ok(sparse[0] > sparse[2]);
  assert.deepEqual(probabilityBest([{ clicks: 1, imps: 10 }]), [1]);
});

test('buildMixReport deixa fora do ranking criativo com poucas impressões', () => {
  const cfg = configWith();
  const r = buildMixReport([
    { placement: 'inContent', source: 'native', creative: 'v1-nova-fase', format: '16x9', event: 'imp', count: 5000 },
    { placement: 'inContent', source: 'native', creative: 'v1-nova-fase', format: '16x9', event: 'click', count: 10 },
    { placement: 'inContent', source: 'native', creative: 'v2-30-segundos', format: '728x90', event: 'imp', count: 20 },
  ], cfg);
  assert.equal(r.creatives.find((c) => c.id === 'v2-30-segundos').pBest, 0);
  assert.equal(r.enoughData, false);
  assert.equal(r.winner, null);
});

test('buildMixReport compara nativo x AdSense e aponta vencedor', () => {
  const cfg = configWith({ adsenseRpm: 4, valuePerClick: 1.5 });
  const rows = [
    { placement: 'inContent', source: 'adsense', creative: '', format: '', event: 'imp', count: 50000 },
    { placement: 'inContent', source: 'native', creative: 'v1-nova-fase', format: '16x9', event: 'imp', count: 20000 },
    { placement: 'inContent', source: 'native', creative: 'v1-nova-fase', format: '16x9', event: 'click', count: 100 },
    { placement: 'topOfContent', source: 'native', creative: 'v2-30-segundos', format: '728x90', event: 'imp', count: 20000 },
    { placement: 'topOfContent', source: 'native', creative: 'v2-30-segundos', format: '728x90', event: 'click', count: 40 },
  ];
  const r = buildMixReport(rows, cfg);
  assert.equal(r.adsenseImps, 50000);
  assert.equal(r.nativeImps, 40000);
  assert.equal(r.nativeClicks, 140);
  // CTR 0,35% × R$1,50 × 1000 = R$5,25 de RPM vs R$4 do AdSense → +31,25%
  assert.ok(Math.abs(r.economics.nativeRpm - 5.25) < 1e-9);
  assert.ok(Math.abs(r.economics.lift - 0.3125) < 1e-9);
  // Empate: 4 / (0,0035 × 1000) ≈ R$1,14 por clique
  assert.ok(Math.abs(r.economics.breakEvenCpc - 4 / 3.5) < 1e-9);
  assert.equal(r.creatives[0].id, 'v1-nova-fase');
  assert.equal(r.enoughData, true);
  assert.equal(r.winner?.id, 'v1-nova-fase');
  assert.deepEqual(r.byPlacement.map((p) => p.placement), ['topOfContent', 'inContent']);
});

test('buildMixReport sem RPM/valor por clique não inventa números', () => {
  const r = buildMixReport([], configWith());
  assert.equal(r.economics.nativeRpm, null);
  assert.equal(r.economics.lift, null);
  assert.equal(r.winner, null);
  assert.equal(r.creatives.length, 2);
});
