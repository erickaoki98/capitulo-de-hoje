import { marked } from 'marked';
import { fromHtml } from 'hast-util-from-html';
import { sanitize, defaultSchema } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';

/** Parse real HTML, apply the established GitHub-style allowlist, then serialize.
 * No script, inline handler, iframe, form, SVG or CSS from article content executes.
 */
export function sanitizeArticleHtml(html: string): string {
  // Repair malformed WordPress quotes before the HTML parser auto-closes them.
  // Once parsed, an unclosed quote would appear balanced around the whole article.
  const repaired = stripOrphanBlockquoteCloses(fixUnclosedBlockquotes(html));
  return toHtml(sanitize(fromHtml(repaired, { fragment: true }), {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), 'figure', 'figcaption', 'picture', 'source', 'video'],
    attributes: {
      ...defaultSchema.attributes,
      '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'title', 'lang', 'dir'],
      a: [...(defaultSchema.attributes?.a ?? []), 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
      source: ['src', 'type', 'media'],
      video: ['src', 'poster', 'controls', 'width', 'height', 'preload'],
    },
    protocols: { ...defaultSchema.protocols, src: ['http', 'https'], poster: ['http', 'https'], href: ['http', 'https', 'mailto', 'tel'] },
  }));
}

/**
 * Corrige blockquotes não-fechados no HTML.
 * Padrão comum do WP export: `<blockquote>TEXTO</p>` em vez de `<blockquote>TEXTO</blockquote>`.
 * Sem correção, tudo após o blockquote aberto é engolido — o conteúdo some visualmente.
 *
 * Estratégia: rastreia profundidade de blockquotes tag a tag.
 * Quando estamos dentro de um blockquote aberto e encontramos `</p>` seguido por
 * um elemento block-level (h2, figure, div, etc.), esse `</p>` deveria ser `</blockquote>`.
 */
function fixUnclosedBlockquotes(html: string): string {
  const opens = (html.match(/<blockquote[\s>]/gi) || []).length;
  const closes = (html.match(/<\/blockquote>/gi) || []).length;
  if (opens <= closes) return html;

  let needed = opens - closes;

  // Tokeniza tag por tag, rastreando profundidade
  const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
  const BLOCK_NEXT = /^[\s\n]*<(h[1-6]|figure|div|section|blockquote|table|ul|ol|nav|aside|hr|article|header|footer)\b/i;
  let depth = 0;
  let lastIndex = 0;
  const parts: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = TAG_RE.exec(html)) !== null) {
    const tag = match[0];
    const lower = tag.toLowerCase();

    if (/^<blockquote[\s>]/i.test(tag)) {
      depth++;
    } else if (lower === '</blockquote>') {
      depth = Math.max(0, depth - 1);
    } else if (lower === '</p>' && depth > 0 && needed > 0) {
      // Olha o que vem DEPOIS desse </p>
      const after = html.slice(match.index + tag.length);
      if (BLOCK_NEXT.test(after) || after.trim().length === 0) {
        // Este </p> deveria ser </blockquote>
        parts.push(html.slice(lastIndex, match.index));
        parts.push('</blockquote>');
        lastIndex = match.index + tag.length;
        depth--;
        needed--;
        continue;
      }
    }
  }

  if (parts.length === 0) return html; // nenhuma correção feita
  parts.push(html.slice(lastIndex));
  return parts.join('');
}

/**
 * Remove tags </blockquote> órfãs (sem <blockquote> correspondente).
 * Comum em conteúdo importado do WP. Browsers ignoram, mas poluem o HTML.
 */
function stripOrphanBlockquoteCloses(html: string): string {
  const opens = (html.match(/<blockquote[\s>]/gi) || []).length;
  const closes = (html.match(/<\/blockquote>/gi) || []).length;
  if (closes <= opens) return html;

  let excess = closes - opens;
  // Remove os primeiros </blockquote> que aparecem sem ter aberto
  let depth = 0;
  return html.replace(/<\/?blockquote[^>]*>/gi, (tag) => {
    if (/^<blockquote/i.test(tag)) {
      depth++;
      return tag;
    }
    // É </blockquote>
    if (depth > 0) {
      depth--;
      return tag;
    }
    // Órfão
    if (excess > 0) {
      excess--;
      return '';
    }
    return tag;
  });
}

/** JSON embedded in an HTML script element must not contain a closing tag. */
export function scriptJson(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * Renderiza conteúdo para HTML.
 * Se o input já for HTML puro (contém tags block-level como <p>, <figure>, <div>),
 * retorna diretamente sem passar pelo marked — evita escaping de tags.
 * Se for um documento HTML completo (<!DOCTYPE>, <html>, <body>),
 * extrai apenas o conteúdo do <body>.
 */
export function renderMarkdown(md: string): string {
  const trimmed = md.trim();

  // Detecta documento HTML completo — extrai só o body
  if (/^(<!\s*--)|(<!DOCTYPE\s)/i.test(trimmed) && /<body[\s>]/i.test(trimmed)) {
    const bodyMatch = trimmed.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1].trim() : trimmed;
    return sanitizeArticleHtml(stripSceneMarkers(body));
  }

  // Se o conteúdo já é HTML (tem tags block-level), retorna direto
  if (/^(<!\s*--[\s\S]*?-->\s*)?<(h[1-6]|p|div|figure|article|section|ul|ol|table|blockquote)\b/i.test(trimmed)) {
    return sanitizeArticleHtml(stripSceneMarkers(trimmed));
  }

  // Caso contrário é Markdown — converte via marked
  return sanitizeArticleHtml(stripSceneMarkers(marked.parse(md, { async: false }) as string));
}

/**
 * Remove marcadores SCENE_N (placeholders de geração de imagem) do HTML.
 * Formato: "SCENE_1: descrição | legenda -->" dentro de <p> ou solto.
 */
function stripSceneMarkers(html: string): string {
  return html
    .replace(/<p[^>]*>\s*SCENE_\d+:[\s\S]*?<\/p>/gi, '')
    .replace(/^SCENE_\d+:.*(?:-->)?\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

/** Remove <figure> tags com imagens de domínios mortos (Supabase antigo) */
export function stripBrokenImageFigures(html: string): string {
  // Remove <figure> inteiros que referenciam o projeto Supabase antigo (desativado)
  return html.replace(
    /<figure[^>]*>[\s\S]*?<img[^>]*src="https?:\/\/njclovklgqrsuwagxcck\.supabase\.co[^"]*"[^>]*>[\s\S]*?<\/figure>/gi,
    ''
  );
}

export function excerpt(input: string, maxChars = 160): string {
  // Limpa HTML + Markdown produzindo texto puro pra preview/description.
  const text = input
    // HTML entities (ordem importa: amp por último)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    // HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // <script>, <style>
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    // tags HTML bem formadas
    .replace(/<[^>]*>/g, ' ')
    // Markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[#>*_~\-\s]+/gm, '')
    // whitespace final
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
}

/**
 * Sanitiza description do WP — se começa com '<' provavelmente é HTML mal-formado
 * (ex: "<! wp:paragraph <pTexto"). Nesse caso retorna vazio para forçar fallback
 * ao content. Senão limpa via excerpt e retorna.
 */
export function sanitizeDescription(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';
  // Lixo claro: começa com `<! wp:`, `<! META:`, ou apenas `<p` no início
  if (/^<!\s*wp:|^<!\s*META:|^<!--|^<[a-z]/i.test(trimmed)) return '';
  const clean = excerpt(trimmed, 280);
  return clean.length < 20 ? '' : clean;
}

export function readingTime(md: string): string {
  const words = md.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${minutes} min de leitura`;
}
