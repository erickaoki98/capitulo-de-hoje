import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidGaMeasurementId,
  resolveGaIdUpdate,
  normalizeAuthorName,
  normalizeAuthorBio,
  sanitizeAvatarUrl,
  normalizeConfigTab,
  sniffImageType,
} from './configuracoes.ts';

test('GA: formato G-XXXXXXXXXX é aceito; UA- e lixo não', () => {
  assert.equal(isValidGaMeasurementId('G-ABC123XYZ9'), true);
  assert.equal(isValidGaMeasurementId('g-abc123xyz9'), true);
  assert.equal(isValidGaMeasurementId('UA-12345-1'), false);
  assert.equal(isValidGaMeasurementId('G-12'), false);
  assert.equal(isValidGaMeasurementId('G-ABC 123'), false);
  assert.equal(isValidGaMeasurementId(''), false);
});

test('GA: campo vazio ou ausente NUNCA apaga o ID salvo', () => {
  assert.deepEqual(resolveGaIdUpdate('', false, 'G-ABC123XYZ9'), { kind: 'keep' });
  assert.deepEqual(resolveGaIdUpdate('   ', false, 'G-ABC123XYZ9'), { kind: 'keep' });
  assert.deepEqual(resolveGaIdUpdate(null, false, 'G-ABC123XYZ9'), { kind: 'keep' });
});

test('GA: remover exige o checkbox explícito', () => {
  assert.deepEqual(resolveGaIdUpdate('', true, 'G-ABC123XYZ9'), { kind: 'clear' });
  assert.deepEqual(resolveGaIdUpdate('G-ABC123XYZ9', true, 'G-ABC123XYZ9'), { kind: 'clear' });
  assert.deepEqual(resolveGaIdUpdate('', true, ''), { kind: 'keep' });
});

test('GA: ID válido é normalizado em maiúsculas; igual ao atual não regrava', () => {
  assert.deepEqual(resolveGaIdUpdate(' g-new123xyz9 ', false, 'G-ABC123XYZ9'), { kind: 'set', value: 'G-NEW123XYZ9' });
  assert.deepEqual(resolveGaIdUpdate('g-abc123xyz9', false, 'G-ABC123XYZ9'), { kind: 'keep' });
});

test('GA: ID inválido é rejeitado (não sobrescreve)', () => {
  assert.deepEqual(resolveGaIdUpdate('UA-12345-1', false, 'G-ABC123XYZ9'), { kind: 'invalid', value: 'UA-12345-1' });
});

test('autor: nome e bio são aparados e limitados', () => {
  assert.equal(normalizeAuthorName('  Redação   Capítulo \n de Hoje '), 'Redação Capítulo de Hoje');
  assert.equal(normalizeAuthorName('x'.repeat(200)).length, 80);
  assert.equal(normalizeAuthorName(null), '');
  assert.equal(normalizeAuthorBio(' linha 1\r\nlinha 2 '), 'linha 1\nlinha 2');
  assert.equal(normalizeAuthorBio('y'.repeat(1000)).length, 400);
});

test('avatar: aceita vazio, /img/ do R2 e https; rejeita o resto', () => {
  assert.equal(sanitizeAvatarUrl(''), '');
  assert.equal(sanitizeAvatarUrl('/img/avatar-1700000000000-ab12cd34.jpg'), '/img/avatar-1700000000000-ab12cd34.jpg');
  assert.equal(sanitizeAvatarUrl('https://cdn.exemplo.com/foto.jpg'), 'https://cdn.exemplo.com/foto.jpg');
  assert.equal(sanitizeAvatarUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeAvatarUrl('/img/../secreto'), null);
  assert.equal(sanitizeAvatarUrl('/img/a/b.jpg'), null);
  assert.equal(sanitizeAvatarUrl('http://inseguro.com/a.jpg'), null);
});

test('upload: identifica JPG/PNG/WebP pelos bytes e rejeita o resto', () => {
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext, 'jpg');
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext, 'png');
  assert.equal(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))?.ext, 'webp');
  assert.equal(sniffImageType(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  assert.equal(sniffImageType(new Uint8Array([])), null);
});

test('aba: só letras minúsculas passam para o redirect', () => {
  assert.equal(normalizeConfigTab('tracking'), 'tracking');
  assert.equal(normalizeConfigTab('autor&x=<script>'), 'autorxscript');
  assert.equal(normalizeConfigTab(null), '');
});
