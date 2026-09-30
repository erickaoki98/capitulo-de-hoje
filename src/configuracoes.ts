// Regras puras do formulário /admin/configuracoes (sem D1), testadas em
// configuracoes.test.mjs. As rotas GET/POST ficam em src/index.ts.

/**
 * Formato GA4 aceito (G-XXXXXXXXXX). É a MESMA regra usada por loadGaId() ao
 * injetar o script: tudo que o admin consegue salvar é efetivamente injetado.
 */
export const GA_MEASUREMENT_ID_RE = /^G-[A-Z0-9]{6,}$/i;

export function isValidGaMeasurementId(id: string): boolean {
  return GA_MEASUREMENT_ID_RE.test(id);
}

export type GaIdUpdate =
  | { kind: 'keep' }
  | { kind: 'set'; value: string }
  | { kind: 'clear' }
  | { kind: 'invalid'; value: string };

/**
 * Decide o que fazer com 'google_analytics_id' a partir do POST.
 *
 * PROTEÇÃO ANALYTICS: campo vazio ou ausente NUNCA apaga o ID salvo — um
 * formulário antigo (que renderizava o campo vazio) ou um campo limpo por engano
 * não pode desligar o GA. Remover exige marcar explicitamente o checkbox
 * 'google_analytics_id.clear'.
 */
export function resolveGaIdUpdate(submitted: unknown, clearRequested: boolean, current: string): GaIdUpdate {
  if (clearRequested) return current ? { kind: 'clear' } : { kind: 'keep' };
  if (typeof submitted !== 'string') return { kind: 'keep' };
  const value = submitted.trim().toUpperCase();
  if (!value) return { kind: 'keep' };
  if (!isValidGaMeasurementId(value)) return { kind: 'invalid', value: submitted.trim() };
  if (value === current) return { kind: 'keep' };
  return { kind: 'set', value };
}

export const AUTHOR_NAME_MAX = 80;
export const AUTHOR_BIO_MAX = 400;

export function normalizeAuthorName(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, AUTHOR_NAME_MAX);
}

export function normalizeAuthorBio(v: unknown): string {
  return String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, AUTHOR_BIO_MAX);
}

/**
 * Avatar do autor: vazio (sem foto), uma imagem do nosso R2 (/img/<chave>, como
 * devolve POST /admin/upload/avatar) ou uma URL https. Qualquer outra coisa → null.
 */
export function sanitizeAvatarUrl(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\/img\/[A-Za-z0-9._-]+$/.test(s) && !s.includes('..')) return s;
  if (/^https:\/\/[^\s"'<>]+$/.test(s) && s.length <= 500) return s;
  return null;
}

/** Identifica a imagem pelos bytes iniciais (não confia no Content-Type do upload). */
export function sniffImageType(b: Uint8Array): { ext: 'jpg' | 'png' | 'webp'; mime: string } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** Aba vinda de ?tab= ou do campo _tab; só letras minúsculas, senão ''. */
export function normalizeConfigTab(v: unknown): string {
  return String(v ?? '').replace(/[^a-z]/g, '').slice(0, 20);
}
