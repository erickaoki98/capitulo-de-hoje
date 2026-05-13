import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
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
