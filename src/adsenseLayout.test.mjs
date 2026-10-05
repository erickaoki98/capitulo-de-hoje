import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { DEFAULT_AD_CONFIG } from './adsense.ts';

const built = await build({ entryPoints: ['src/render.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'] });
const { renderPost, renderHome } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const env = { SITE_TITLE: 'Teste', SITE_DESCRIPTION: 'Teste', CANONICAL_URL: 'https://example.com' };
const request = new Request('https://example.com/artigo');
const config = Object.fromEntries(Object.entries(DEFAULT_AD_CONFIG).map(([key, value]) => [key, { ...value, enabled: true, slotId: key }]));
config.inContent.everyNParagraphs = 2;
config.inContentExtra = [{ enabled: true, slotId: 'extra', afterParagraph: 3 }];
const ads = { publisherId: 'ca-pub-1234567890123456', autoAds: true, config, native: { enabled: false } };
const post = { id: 1, slug: 'artigo', title: 'Artigo de teste', description: 'Teste', content: '', category: '', tags: '[]', author: 'Autor', hero_image: '/img/test.jpg', draft: 0, pub_date: 1, updated_date: 1 };
const paragraphs = n => Array.from({ length: n }, (_, i) => `<p>Parágrafo ${i + 1}</p>`).join('\n');

// Fingerprint da ordem dos parágrafos, títulos, imagem, compartilhamento,
// unidades completas e pushes. Esperado capturado de 38882a7 (antes de 29/09).
export function fingerprint(html) {
  return [...html.matchAll(/<\/p>|<h[12]\b[^>]*>|<img\b[^>]*class="post__hero"[^>]*>|<div class="(?:share-bar|prose)"[^>]*>|<ins class="adsbygoogle"[\s\S]*?<\/ins>|<script>\(adsbygoogle = window.adsbygoogle \|\| \[\]\)\.push\(\{\}\);<\/script>|<script async src="https:\/\/pagead2[^>]*><\/script>/g)]
    .map(m => m[0].replace(/\s+/g, ' ').trim());
}
export const scenarios = [
  ...[3, 4, 8, 24].map(n => [`artigo-${n}`, paragraphs(n)]),
  ['subtitulos', paragraphs(4) + '\n<h2>Seção</h2>\n' + paragraphs(8)],
  ['citacao', paragraphs(2) + '\n<blockquote><p>Citação</p></blockquote>\n' + paragraphs(10)],
];
export const results = scenarios.map(([name, content]) => [name, fingerprint(renderPost(env, request, { ...post, content }, [], ads))]);
results.push(['home', fingerprint(renderHome(env, request, Array.from({ length: 18 }, (_, i) => ({ ...post, id: i + 1, slug: `artigo-${i}`, content: '' })), ads))]);

const expected = JSON.parse(await readFile(new URL('./adsenseLayout.baseline.json', import.meta.url), 'utf8'));
test('AdSense com teste desligado: mesma quantidade, ordem, posições, formatos e pushes de antes de 29/09', () => {
  assert.deepEqual(results, expected.layouts);
  for (const [, content] of scenarios) {
    const html = renderPost(env, request, { ...post, content }, [], ads);
    assert.doesNotMatch(html, /class="cdh-mix|window\.cdhMix|var C=/);
    assert.equal((html.match(/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/g) || []).length, 1);
  }
});
test('CSS histórico preservado, exceto pela correção de largura dos cards', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const section = css.slice(css.indexOf('/* ==========================================================\n   45. Ad slots'), css.indexOf('/* ==========================================================\n   45a. Banners'));
  const widthFix = '/* O ins vazio encolhe no card flex: largura zero impede o AdSense de carregar. */\n.post-card--ad > ins.adsbygoogle { width: 100%; }\n';
  assert.equal(section.split(widthFix).length, 2, 'Correção de largura deve aparecer exatamente uma vez');
  assert.equal(createHash('sha256').update(section.replace(widthFix, '')).digest('hex'), expected.cssSha256);
});
