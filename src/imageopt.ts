/**
 * Otimização de imagens on-the-fly com Photon (WASM) para Cloudflare Workers.
 *
 * Estratégia:
 *  - Imagens no R2 são servidas cruas (PNGs de 1MB+ são comuns vindos do WP).
 *  - Na primeira vez que um browser moderno (Accept: image/webp) pede a imagem,
 *    decodificamos, redimensionamos (cap de largura) e re-encodamos para WebP/JPEG,
 *    escolhendo o menor. O resultado é salvo no R2 sob o prefixo `_opt/` e servido.
 *  - Próximas requests servem direto do R2 (sem reprocessar) → custo de CPU é uma vez por imagem.
 *  - Qualquer falha (formato não suportado, plano Free sem CPU, etc.) → fallback pra original.
 */

import { PhotonImage, resize, SamplingFilter } from '@cf-wasm/photon';

/** Largura máxima servida. Hero/conteúdo nunca passam de ~720px de display; 1280 cobre retina. */
export const OPT_MAX_WIDTH = 1280;
/** Qualidade do JPEG de fallback. */
const JPEG_QUALITY = 80;
/** Não vale a pena otimizar imagens já pequenas. */
const MIN_BYTES_TO_OPTIMIZE = 40 * 1024;
/** Formatos que NÃO devem ser re-encodados (vetorial / animado / já eficiente). */
const SKIP_EXT = /\.(svg|gif|webp|avif|ico)$/i;

/**
 * Lê o "color type" do IHDR de um PNG para decidir se ele tem canal alpha.
 * Layout PNG: assinatura (8 bytes) + chunk IHDR; o byte de color type fica no offset 25.
 * color type → 0=grayscale, 2=RGB, 3=palette, 4=gray+alpha, 6=RGBA.
 *
 * Retorna `true` SOMENTE quando é garantidamente opaco (0 ou 2). Palette (3) pode
 * carregar transparência via chunk tRNS, então é tratado como "pode ter alpha"
 * (conservador) — assim NUNCA achatamos transparência de logo pra fundo preto.
 */
function pngIsGuaranteedOpaque(bytes: Uint8Array): boolean {
  if (bytes.length < 26) return false;
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return false;
  const colorType = bytes[25];
  return colorType === 0 || colorType === 2; // grayscale / RGB → sem canal alpha
}

export interface OptimizedImage {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Decide se a imagem é candidata a otimização com base na extensão e tamanho.
 */
export function shouldOptimize(key: string, sizeBytes: number, acceptsWebp: boolean): boolean {
  if (!acceptsWebp) return false;
  if (SKIP_EXT.test(key)) return false;
  if (sizeBytes < MIN_BYTES_TO_OPTIMIZE) return false;
  return true;
}

/**
 * Re-encoda uma imagem para WebP (ou JPEG, o que for menor), com cap de largura.
 * `isPng` = fonte é PNG (pode ter transparência) → SÓ WebP, nunca JPEG (JPEG não
 * tem canal alpha e transformaria o fundo transparente em PRETO — ex.: logos).
 * Retorna null em qualquer falha — o chamador deve servir a original.
 */
export function optimizeImage(
  input: ArrayBuffer, isPng: boolean = false, maxWidth: number = OPT_MAX_WIDTH,
): OptimizedImage | null {
  let img: PhotonImage | null = null;
  let resized: PhotonImage | null = null;
  try {
    const bytes = new Uint8Array(input);
    img = PhotonImage.new_from_byteslice(bytes);
    const w = img.get_width();
    const h = img.get_height();

    let target = img;
    if (w > maxWidth) {
      const newH = Math.max(1, Math.round(h * (maxWidth / w)));
      resized = resize(img, maxWidth, newH, SamplingFilter.Lanczos3);
      target = resized;
    }

    // WebP sempre (Photon só gera WebP LOSSLESS → ótimo p/ gráficos/transparência,
    // mas pesado p/ fotos). JPEG (q80) é o caminho que comprime fotos de verdade.
    // JPEG é seguro APENAS quando não há risco de perder transparência:
    //   - fontes não-PNG (JPEG/etc, sem canal alpha), OU
    //   - PNGs comprovadamente opacos (grayscale/RGB — sem alpha).
    // PNGs com alpha (RGBA/palette) ficam SÓ em WebP → logos nunca viram fundo preto.
    // Os candidatos competem por tamanho mais abaixo (e nunca superam a original).
    const jpegSafe = !isPng || pngIsGuaranteedOpaque(bytes);
    let webp: Uint8Array | null = null;
    let jpeg: Uint8Array | null = null;
    try { webp = target.get_bytes_webp(); } catch { /* ignore */ }
    if (jpegSafe) {
      try { jpeg = target.get_bytes_jpeg(JPEG_QUALITY); } catch { /* ignore */ }
    }

    const candidates: OptimizedImage[] = [];
    if (webp && webp.length > 0) candidates.push({ bytes: webp, contentType: 'image/webp' });
    if (jpeg && jpeg.length > 0) candidates.push({ bytes: jpeg, contentType: 'image/jpeg' });
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.bytes.length - b.bytes.length);
    const best = candidates[0];

    // Se o "otimizado" não for menor que o original, não vale a pena.
    if (best.bytes.length >= input.byteLength) return null;
    return best;
  } catch {
    return null;
  } finally {
    try { img?.free(); } catch { /* ignore */ }
    try { resized?.free(); } catch { /* ignore */ }
  }
}
