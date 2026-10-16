/**
 * Remove o sufixo " | Nome da Novela" do título para exibição (H1, cards).
 * A novela é mostrada como badge/eyebrow à parte, então repeti-la no título
 * só polui. Mantém o título completo para <title>/SEO; limpa só o visível.
 */
export function cleanTitle(title: string, category?: string | null): string {
  const t = (title || '').trim();
  const cat = (category || '').trim();
  // 1) Remove " | <categoria>" exato no fim (tolerante a espaços/maiúsculas)
  if (cat) {
    const escaped = cat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\s*[|/–—-]\\s*' + escaped + '\\s*$', 'i');
    const stripped = t.replace(re, '').trim();
    if (stripped && stripped !== t) return stripped;
  }
  // 2) Genérico: remove um " | cauda curta" no fim (provável tag de novela)
  const m = t.match(/^(.*\S)\s*\|\s*([^|]{1,40})$/);
  if (m) return m[1].trim();
  return t;
}

