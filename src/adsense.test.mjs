import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAdConfig, parseInContentExtraForm } from './adsense.ts';

function formWith(fields) {
  const form = new FormData();
  for (const [k, v] of fields) form.append(k, v);
  return form;
}

test('extras: lê todas as linhas, inclusive com índices com buraco', () => {
  const form = formWith([
    ['enabled.inContent', '1'],
    ['extra.enabled.0', '1'], ['extra.slot.0', ' 111 '], ['extra.after.0', '2'], ['extra.format.0', 'in-article'],
    // linha 1 foi removida no admin
    ['extra.slot.2', '222'], ['extra.after.2', '7'], ['extra.format.2', 'rectangle'],
    ['extra.enabled.10', '1'], ['extra.slot.10', '333'], ['extra.after.10', '12'], ['extra.format.10', 'auto'],
  ]);
  assert.deepEqual(parseInContentExtraForm(form), [
    { enabled: true, slotId: '111', afterParagraph: 2, format: 'in-article' },
    { enabled: false, slotId: '222', afterParagraph: 7, format: 'rectangle' },
    { enabled: true, slotId: '333', afterParagraph: 12, format: 'auto' },
  ]);
});

test('extras: linhas sem Slot ID são descartadas', () => {
  const form = formWith([
    ['extra.enabled.0', '1'], ['extra.slot.0', ''], ['extra.after.0', '3'],
    ['extra.enabled.1', '1'], ['extra.slot.1', '   '], ['extra.after.1', '4'],
    ['extra.enabled.2', '1'], ['extra.slot.2', '999'], ['extra.after.2', '5'],
  ]);
  const slots = parseInContentExtraForm(form);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].slotId, '999');
});

test('extras: afterParagraph fica entre 1 e 100; vazio/inválido vira 3', () => {
  const after = (v) => parseInContentExtraForm(formWith([['extra.slot.0', '1'], ['extra.after.0', v]]))[0].afterParagraph;
  assert.equal(after('0'), 1);
  assert.equal(after('-5'), 1);
  assert.equal(after('250'), 100);
  assert.equal(after('4.6'), 5);
  assert.equal(after(''), 3);
  assert.equal(after('abc'), 3);
  assert.equal(parseInContentExtraForm(formWith([['extra.slot.0', '1']]))[0].afterParagraph, 3);
});

test('extras: formato desconhecido cai em in-article', () => {
  const form = formWith([['extra.slot.0', '1'], ['extra.format.0', '<script>']]);
  assert.equal(parseInContentExtraForm(form)[0].format, 'in-article');
});

test('extras: form sem nenhuma linha salva lista vazia (limpa extras antigos)', () => {
  assert.deepEqual(parseInContentExtraForm(formWith([['enabled.inContent', '1']])), []);
});

test('extras: sobrevivem ao round-trip JSON → parseAdConfig', () => {
  const extras = parseInContentExtraForm(formWith([
    ['extra.enabled.0', '1'], ['extra.slot.0', '111'], ['extra.after.0', '3'], ['extra.format.0', 'in-article'],
  ]));
  const cfg = parseAdConfig(JSON.stringify({ inContentExtra: extras }));
  assert.deepEqual(cfg.inContentExtra, extras);
  assert.equal(cfg.inContent.enabled, true); // defaults continuam lá
});
