import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bannerHref,
  buildMixReport,
  detectFormat,
  mergeCreatives,
  MIX_PLACEMENTS,
  mixActive,
  effectiveAdsenseRpm,
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
      ['', 'native', '', '', 'pv', 1],
      ['', 'native', '', '', 'pv', 1],
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
    { placement: '', source: 'native', creative: '', format: '', event: 'pv', count: 2 },
    { placement: '', source: 'native', creative: 'v1-nova-fase', format: '', event: 'pv', count: 1 },
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
    { placement: '', source: 'native', creative: '', format: '', event: 'pv', count: 20000 },
    // Os dois banners passam pelas duas posições (ordem sorteada por página); V1 é melhor em ambas.
    { placement: 'anchor', source: 'native', creative: 'v1-nova-fase', format: '320x100', event: 'imp', count: 5000 },
    { placement: 'anchor', source: 'native', creative: 'v1-nova-fase', format: '320x100', event: 'click', count: 200 },
    { placement: 'anchor', source: 'native', creative: 'v2-30-segundos', format: '320x100', event: 'imp', count: 5000 },
    { placement: 'anchor', source: 'native', creative: 'v2-30-segundos', format: '320x100', event: 'click', count: 100 },
    { placement: 'inContent', source: 'native', creative: 'v1-nova-fase', format: '16x9', event: 'imp', count: 10000 },
    { placement: 'inContent', source: 'native', creative: 'v1-nova-fase', format: '16x9', event: 'click', count: 60 },
    { placement: 'inContent', source: 'native', creative: 'v2-30-segundos', format: '16x9', event: 'imp', count: 10000 },
    { placement: 'inContent', source: 'native', creative: 'v2-30-segundos', format: '16x9', event: 'click', count: 40 },
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
  assert.equal(r.creatives[0].id, 'v1-nova-fase');
  assert.equal(r.winner?.id, 'v1-nova-fase');
  // Esperado do V1 = 5.000 × 3% (âncora) + 10.000 × 0,5% (texto) = 200 cliques; teve 260 → índice 1,3.
  assert.ok(Math.abs(r.creatives[0].index - 1.3) < 1e-9);
  // "Se só ele rodasse": R$10 por mil páginas × 1,3 = R$13.
  assert.ok(Math.abs(r.economics.bestPageRpm - 13) < 1e-9);
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

test('ranking ajusta pela posição: quem caiu mais no texto não perde por isso (paradoxo de Simpson)', () => {
  const cfg = configWith();
  const ev = (placement, format, creative, event, count) => ({ placement, source: 'native', creative, format, event, count });
  // Em CADA posição o V2 tem CTR maior que o V1. Mas o V1 caiu quase sempre na âncora (CTR alto por
  // natureza) e o V2 quase sempre no meio do texto — no CTR bruto o V1 "ganharia".
  const rows = [
    ev('anchor', '320x100', 'v1-nova-fase', 'imp', 9000), ev('anchor', '320x100', 'v1-nova-fase', 'click', 360),     // 4,0%
    ev('anchor', '320x100', 'v2-30-segundos', 'imp', 1000), ev('anchor', '320x100', 'v2-30-segundos', 'click', 60),   // 6,0%
    ev('inContent', '16x9', 'v1-nova-fase', 'imp', 1000), ev('inContent', '16x9', 'v1-nova-fase', 'click', 3),         // 0,3%
    ev('inContent', '16x9', 'v2-30-segundos', 'imp', 9000), ev('inContent', '16x9', 'v2-30-segundos', 'click', 45),    // 0,5%
  ];
  const r = buildMixReport(rows, cfg);
  const v1 = r.creatives.find((c) => c.id === 'v1-nova-fase');
  const v2 = r.creatives.find((c) => c.id === 'v2-30-segundos');
  assert.ok(v1.ctr > v2.ctr, 'no bruto o V1 parece melhor');
  assert.ok(v2.adjCtr > v1.adjCtr, 'ajustado à posição, o V2 é melhor');
  assert.ok(v2.index > 1 && v1.index < 1);
  assert.equal(r.creatives[0].id, 'v2-30-segundos');
  assert.ok(v2.pBest > 0.95);
});

test('RPM do grupo AdSense: API convertida, cotação manual, fallback manual e nenhum', () => {
  const auto = { rpm: 2, currency: 'USD', start: '2026-09-30', end: '2026-10-01', days: 2, sinceTest: true, generatedAt: 0 };
  const base = parseNativeConfig('{}');
  assert.equal(base.rpmAuto, true); // padrão: automático
  let r = effectiveAdsenseRpm(base, auto, 5.2);
  assert.equal(r.source, 'auto'); assert.ok(Math.abs(r.value - 10.4) < 1e-9); assert.equal(r.rateSource, 'auto');
  r = effectiveAdsenseRpm({ ...base, usdBrl: 5 }, auto, 5.2);
  assert.equal(r.value, 10); assert.equal(r.rateSource, 'manual');
  r = effectiveAdsenseRpm({ ...base, adsensePageRpm: 11 }, auto, null); // sem cotação → manual
  assert.equal(r.source, 'manual'); assert.equal(r.value, 11);
  r = effectiveAdsenseRpm({ ...base, rpmAuto: false, adsensePageRpm: 9 }, auto, 5.2);
  assert.equal(r.source, 'manual'); assert.equal(r.value, 9);
  assert.equal(effectiveAdsenseRpm(base, { ...auto, currency: 'BRL' }, null).value, 2);
  assert.equal(effectiveAdsenseRpm(base, null, 5.2).source, 'none');
  assert.equal(parseNativeConfig(JSON.stringify({ rpmAuto: false, usdBrl: 999 })).usdBrl, 100);
});

// ---------- ID único do banner nas UTMs ----------

// Galeria nova da Toda Fase: utm_content = ID do banner, utm_term = formato.
const tfSnippet = (id, fmt, term, w, h) =>
  `<textarea readonly>&lt;a href=&quot;https://todafase.com/?utm_source=capitulodehoje&amp;utm_medium=banner&amp;utm_campaign=virada40&amp;utm_content=${id}&amp;utm_term=${term}&quot;&gt;&lt;img src=&quot;https://todafase.com/banners/${id}-${fmt}.jpg&quot; width=&quot;${w}&quot; height=&quot;${h}&quot; alt=&quot;Publicidade Toda Fase: Nova fase&quot;&gt;&lt;/a&gt;</textarea>`;
const TF_PAGE = `<h2>TF01 · Nova fase</h2>${tfSnippet('tf01-nova-fase', '300x250', '300x250', 300, 250)}${tfSnippet('tf01-nova-fase', 'nativo-16x9', '16x9', 1200, 675)}`;

test('parseBannerSnippets usa o utm_content do link como ID do banner', () => {
  const { banners } = parseBannerSnippets(TF_PAGE, 'https://todafase.com/banners');
  assert.deepEqual(banners.map((b) => [b.id, b.format, b.label]), [
    ['tf01-nova-fase', '300x250', 'TF01 · Nova fase'],
    ['tf01-nova-fase', '16x9', 'TF01 · Nova fase'],
  ]);
  // O ID é o da UTM mesmo quando o arquivo tem outro nome.
  const other = '<a href="https://x.example/?utm_content=tf07-menopausa-30&utm_term=300x250"><img src="/b/qualquer-300x250.jpg" width="300" height="250"></a>';
  assert.equal(parseBannerSnippets(other, 'https://x.example/').banners[0].id, 'tf07-menopausa-30');
});

test('todo link de banner sai com utm_content = ID e utm_term = formato', () => {
  assert.equal(
    bannerHref('https://todafase.com/?utm_source=capitulodehoje&utm_medium=banner&utm_campaign=virada40&utm_content=v1-nova-fase-300x250', 'tf01-nova-fase', '300x250'),
    'https://todafase.com/?utm_source=capitulodehoje&utm_medium=banner&utm_campaign=virada40&utm_content=tf01-nova-fase&utm_term=300x250',
  );
  // Sem UTM nenhuma: ganha origem e meio padrão do blog.
  assert.equal(bannerHref('https://loja.example/p', 'x', '16x9'),
    'https://loja.example/p?utm_source=capitulodehoje&utm_medium=banner&utm_content=x&utm_term=16x9');
  // Vale para a config salva e para o que vai para a página.
  const cfg = configWith();
  assert.equal(cfg.creatives[0].images['16x9'].href,
    'https://loja.example/?a=1&utm_source=capitulodehoje&utm_medium=banner&utm_content=v1-nova-fase&utm_term=16x9');
  assert.match(runtimeConfig(cfg).c[1].f['728x90'][1], /utm_content=v2-30-segundos&utm_term=728x90$/);
});

test('mergeCreatives renomeia o banner que voltou com ID novo e a mesma imagem, sem duplicar', () => {
  const existing = parseNativeConfig(JSON.stringify({ creatives: [
    { id: 'v1-nova-fase', label: 'V1 · Nova fase', alt: 'x', active: false, images: {
      '300x250': { src: '/img/nv-1.jpg', href: 'https://todafase.com/?utm_content=v1-nova-fase-300x250', w: 300, h: 250 } } },
    { id: 'v2-30-segundos', label: 'V2', alt: '', active: true, images: {
      '300x250': { src: '/img/nv-2.jpg', href: 'https://todafase.com/', w: 300, h: 250 } } },
  ] })).creatives;
  const { banners } = parseBannerSnippets(TF_PAGE, 'https://todafase.com/banners');
  // Mesmo conteúdo = mesmo arquivo no R2 (nome pelo hash).
  const srcMap = new Map([
    ['https://todafase.com/banners/tf01-nova-fase-300x250.jpg', '/img/nv-1.jpg'],
    ['https://todafase.com/banners/tf01-nova-fase-nativo-16x9.jpg', '/img/nv-9.jpg'],
  ]);
  const r = mergeCreatives(existing, banners, srcMap);
  assert.deepEqual([r.added, r.updated, r.renamed], [0, 0, 1]);
  assert.deepEqual(r.creatives.map((c) => c.id), ['tf01-nova-fase', 'v2-30-segundos']);
  const tf01 = r.creatives[0];
  assert.equal(tf01.active, false);            // continua pausado
  assert.equal(tf01.label, 'TF01 · Nova fase');
  assert.deepEqual(tf01.aliases, ['v1-nova-fase']);
  assert.deepEqual(Object.keys(tf01.images).sort(), ['16x9', '300x250']);
  // Salvo e relido, o link já leva o ID novo.
  const saved = parseNativeConfig(JSON.stringify({ creatives: r.creatives }));
  assert.match(saved.creatives[0].images['300x250'].href, /utm_content=tf01-nova-fase&utm_term=300x250$/);
  // Reimportar a mesma galeria não muda nada.
  const again = mergeCreatives(saved.creatives, banners, srcMap);
  assert.deepEqual([again.added, again.renamed, again.creatives.length], [0, 0, 2]);
});

test('eventos com o ID antigo do banner contam para o ID atual', () => {
  const cfg = configWith({ creatives: [
    { id: 'tf01-nova-fase', label: 'TF01', alt: '', active: true, aliases: ['v1-nova-fase'],
      images: { '16x9': { src: '/img/nv-a.jpg', href: 'https://loja.example/', w: 1200, h: 675 } } },
    { id: 'tf02-30-segundos', label: 'TF02', alt: '', active: true,
      images: { '16x9': { src: '/img/nv-c.jpg', href: 'https://loja.example/', w: 1200, h: 675 } } },
  ] });
  // Página ainda em cache manda o ID antigo.
  assert.deepEqual(sanitizeEventBatch({ t: 'abc123', e: [['inContent', 'native', 'v1-nova-fase', '16x9', 'click', 1]] }, cfg),
    [{ placement: 'inContent', source: 'native', creative: 'tf01-nova-fase', format: '16x9', event: 'click', count: 1 }]);
  const ev = (creative, event, count) => ({ placement: 'inContent', source: 'native', creative, format: '16x9', event, count });
  const r = buildMixReport([ev('v1-nova-fase', 'imp', 300), ev('tf01-nova-fase', 'imp', 200), ev('v1-nova-fase', 'click', 5)], cfg);
  const tf01 = r.creatives.find((c) => c.id === 'tf01-nova-fase');
  assert.deepEqual([tf01.imps, tf01.clicks], [500, 5]);
  assert.equal(r.creatives.some((c) => c.id === 'v1-nova-fase'), false);
});

test('ID antigo não pode ser o ID atual de outro banner nem estar em dois', () => {
  const cfg = parseNativeConfig(JSON.stringify({ creatives: [
    { id: 'a', aliases: ['b', 'velho', 'a'], images: {} },
    { id: 'b', aliases: ['velho', 'outro'], images: {} },
  ] }));
  assert.deepEqual(cfg.creatives[0].aliases, ['velho']);
  assert.deepEqual(cfg.creatives[1].aliases, ['outro']);
});
