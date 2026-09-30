import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMixReport,
  detectFormat,
  mergeCreatives,
  MIX_PLACEMENTS,
  mixActive,
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
import { adsenseScriptSrc, renderAdSenseScript } from './adsense.ts';

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
    share: 250, maxPerPage: 99, testId: 'BAD ID', adsensePageRpm: -3,
    placements: { inContent: { on: true, format: 'gigante' } },
    creatives: [{ id: '', images: {} }, { id: 'ok', images: { '16x9': { src: 'javascript:x', href: 'https://a.b', w: 1, h: 1 } } }],
  }));
  assert.equal(cfg.share, 100);
  assert.equal(cfg.maxPerPage, 20);
  assert.equal(parseNativeConfig(JSON.stringify({ maxPerPage: 0 })).maxPerPage, 0); // 0 = sem limite
  assert.equal(cfg.testId, '');
  assert.equal(cfg.adsensePageRpm, 0);
  // formato que não faz sentido na posição volta ao padrão (âncora não aceita 16:9)
  assert.equal(parseNativeConfig(JSON.stringify({ placements: { anchor: { on: true, format: '16x9' } } })).placements.anchor.format, 'faixa');
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
  // Só posições em 320x50 ligadas e nenhum criativo tem 320x50 → não roda.
  const only320x50 = Object.fromEntries(MIX_PLACEMENTS.map((k) => [k,
    k === 'stickyFooter' || k === 'anchor' ? { on: true, format: '320x50' } : { on: false, format: '300x250' }]));
  assert.equal(nativeActive(configWith({ placements: only320x50 })), false);
  // Com o teste ligado, TODA posição do AdSense vira slot misto (grupo nativo não vê AdSense).
  assert.equal(mixActive(configWith()), true);
  assert.equal(mixActive(configWith({ enabled: false })), false);
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
  const js = renderMixRuntime(cfg, 'https://pagead2.example/adsbygoogle.js?client=ca-pub-1');
  assert.doesNotMatch(js.slice(8, -9), /<\/script>/);
  assert.doesNotThrow(() => new Function(js.replace(/^<script>/, '').replace(/<\/script>$/, '')));
  assert.match(js, /"a":"https:\/\/pagead2\.example\/adsbygoogle\.js\?client=ca-pub-1"/);
  assert.equal(renderMixRuntime(configWith({ enabled: false }), 'x'), '');
});

test('sanitizeEventBatch aceita pageview por grupo e impressão/clique de nativo', () => {
  const cfg = configWith();
  const rows = sanitizeEventBatch({
    t: 'abc123',
    e: [
      ['', 'adsense', '', '', 'pv', 1],
      ['', 'native', 'v1-nova-fase', '', 'pv', 1],
      ['', 'native', 'v1-nova-fase', '', 'pv', 1],
      ['', 'native', 'inventado', '', 'pv', 1],
      ['inContent', 'adsense', '', '', 'pv', 1],
      ['anchor', 'native', 'v1-nova-fase', '320x100', 'imp', 1],
      ['vignette', 'native', 'v1-nova-fase', '16x9', 'click', 1],
      ['inContent', 'native', 'v1-nova-fase', '16x9', 'imp', 1e9],
      ['inContent', 'adsense', '', '', 'imp', 1],
      ['sidebar', 'native', 'v1-nova-fase', '16x9', 'imp', 1],
    ],
  }, cfg);
  assert.deepEqual(rows, [
    { placement: '', source: 'adsense', creative: '', format: '', event: 'pv', count: 1 },
    { placement: '', source: 'native', creative: 'v1-nova-fase', format: '', event: 'pv', count: 2 },
    { placement: 'anchor', source: 'native', creative: 'v1-nova-fase', format: '320x100', event: 'imp', count: 1 },
    { placement: 'vignette', source: 'native', creative: 'v1-nova-fase', format: '16x9', event: 'click', count: 1 },
    { placement: 'inContent', source: 'native', creative: 'v1-nova-fase', format: '16x9', event: 'imp', count: 100 },
  ]);
  assert.deepEqual(sanitizeEventBatch({ t: 'outro', e: [['', 'adsense', '', '', 'pv', 1]] }, cfg), []);
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

test('buildMixReport compara os grupos por mil páginas e aponta vencedor', () => {
  const cfg = configWith({ adsensePageRpm: 11, valuePerClick: 0.5 });
  const rows = [
    { placement: '', source: 'adsense', creative: '', format: '', event: 'pv', count: 80000 },
    { placement: '', source: 'native', creative: 'v1-nova-fase', format: '', event: 'pv', count: 10000 },
    { placement: '', source: 'native', creative: 'v2-30-segundos', format: '', event: 'pv', count: 10000 },
    { placement: 'anchor', source: 'native', creative: 'v1-nova-fase', format: '320x100', event: 'imp', count: 9000 },
    { placement: 'anchor', source: 'native', creative: 'v1-nova-fase', format: '320x100', event: 'click', count: 300 },
    { placement: 'inContent', source: 'native', creative: 'v2-30-segundos', format: '728x90', event: 'imp', count: 20000 },
    { placement: 'inContent', source: 'native', creative: 'v2-30-segundos', format: '728x90', event: 'click', count: 100 },
  ];
  const r = buildMixReport(rows, cfg);
  assert.equal(r.adsensePv, 80000);
  assert.equal(r.nativePv, 20000);
  assert.equal(r.nativeClicks, 400);
  // 400 cliques / 20.000 páginas = 20 por mil × R$0,50 = R$10 por mil páginas vs R$11 → −9,1%
  assert.ok(Math.abs(r.clicksPerPv - 0.02) < 1e-12);
  assert.ok(Math.abs(r.economics.nativePageRpm - 10) < 1e-9);
  assert.ok(Math.abs(r.economics.lift - (10 / 11 - 1)) < 1e-9);
  // Empate: R$11 / 20 cliques por mil = R$0,55 por clique
  assert.ok(Math.abs(r.economics.breakEvenCpc - 0.55) < 1e-9);
  assert.ok(Math.abs(r.economics.adsenseRevenue - 880) < 1e-9);
  assert.equal(r.creatives[0].id, 'v1-nova-fase'); // CTR 3,3% vs 0,5%
  assert.equal(r.creatives[0].pv, 10000);
  assert.ok(Math.abs(r.creatives[0].pageRpm - 15) < 1e-9); // 300/10.000 × 0,5 × 1000
  assert.equal(r.winner?.id, 'v1-nova-fase');
  assert.deepEqual(r.byPlacement.map((p) => p.placement), ['anchor', 'inContent']);
});

test('buildMixReport sem RPM/valor por clique não inventa números', () => {
  const r = buildMixReport([], configWith());
  assert.equal(r.economics.nativePageRpm, null);
  assert.equal(r.economics.lift, null);
  assert.equal(r.winner, null);
  assert.equal(r.creatives.length, 2);
});

test('head do AdSense: com o teste desligado sai igual; ligado, sem o script mas com consent granted', () => {
  const on = renderAdSenseScript('ca-pub-123', true);
  const off = renderAdSenseScript('ca-pub-123', true, false);
  assert.match(on, /<script async src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-123" crossorigin="anonymous"><\/script>$/);
  assert.doesNotMatch(off, /adsbygoogle\.js/);
  for (const html of [on, off]) {
    assert.match(html, /'ad_storage': 'granted'/);
    assert.doesNotMatch(html, /denied/);
  }
  assert.equal(adsenseScriptSrc('123'), 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-123');
});
