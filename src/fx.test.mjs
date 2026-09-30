import assert from 'node:assert/strict';
import test from 'node:test';

import { parseUsdBrl } from './fx.ts';

test('cotação USD→BRL: aceita a resposta da AwesomeAPI e rejeita valores implausíveis', () => {
  assert.deepEqual(parseUsdBrl({ USDBRL: { bid: '5.2031' } }, 1), { rate: 5.2031, at: 1 });
  assert.equal(parseUsdBrl({ USDBRL: { bid: '0' } }), null);
  assert.equal(parseUsdBrl({ USDBRL: { bid: 'abc' } }), null);
  assert.equal(parseUsdBrl({ erro: true }), null);
  assert.equal(parseUsdBrl(null), null);
});
