type Span = { start: number; end: number; score: number; source: 'rule' | 'fallback' };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]!);

// ponytail: an editorial lexicon, not a semantic model. Extend rules when real titles expose weak choices.
const RULES: [string, number][] = [
  ['(?:acusação|ameaça|revelação|pedido) (?:inesperad[ao]|surpreendente|chocante|emocionante)', 20],
  ['(?:encontra|descobre|revela|confirma) (?:a |o |uma? )?(?:ligação|provas?|verdade|segredo|traição)', 20],
  ['(?:é|foi|será) (?:absolvid[ao]|pres[ao]|seguid[ao]|condenad[ao]|desmascarad[ao])|(?:está|fica) (?:grávida|doente|livre)', 18],
  ['(?:resultado|plano|disputa|provas?|segredo|fraude|morte) (?:d[aeo]|pela|contra) [\\p{L}\\p{M}]+', 16],
  ['perder (?:o |a )?(?:próprio|própria) [\\p{L}\\p{M}]+', 17],
  ['(?:levá-l[ao]|levar|manda|enviar) (?:diretamente )?(?:para|à|ao) (?:a |o )?[\\p{L}\\p{M}]+', 17],
  ['estão [\\p{L}\\p{M}]+ndo [\\p{L}\\p{M}]+', 15],
  ['escolher de que lado|(?<=entre )[\\p{L}\\p{M}]+ e (?:o |a )?[\\p{L}\\p{M}]+', 17],
  ['motivo (?:assustador|chocante|inesperado)', 7],
  ['(?:sofre|recebe|prepara|arma|revela|esconde|coloca|entrega|provoca|escolhe|invade|salva|perde|ganha|descobre) (?:o |a |um |uma )?[\\p{L}\\p{M}]+', 10],
];
const PATTERNS = RULES.map(([source, score]) => ({
  pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'giu'), score,
}));
const STOP = new Set('a o as os um uma uns umas e de da do das dos em no na nos nas por para com que se ao à entre contra pela pelo seu sua'.split(' '));

/** Literal spans only. Exactly two for titles with at least two words; red precedes black. */
export function selectTitleHighlights(title: string): Span[] {
  if (/[<>]/.test(title)) return []; // Malformed titles stay escaped and unsplit.
  const words = [...title.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[-’'][\p{L}\p{M}\p{N}]+)*/gu)];
  if (words.length < 2) return [];
  const candidates: Span[] = [];
  for (const {pattern, score} of PATTERNS) {
    for (const match of title.matchAll(pattern)) {
      const text = match[0].toLocaleLowerCase('pt-BR');
      if (/ (?:que|de|em|entre|motivo|notícia|resultado)$/.test(text)) continue;
      candidates.push({start: match.index!, end: match.index! + match[0].length, score, source: 'rule'});
    }
  }
  // Unfamiliar vocabulary still gets two short spans, without highlighting the whole headline.
  const size = words.length >= 5 ? 2 : 1;
  for (let i = 0; i + size <= words.length; i++) {
    const first = words[i], last = words[i + size - 1];
    const score = -Number(STOP.has(first[0].toLowerCase())) - Number(STOP.has(last[0].toLowerCase()));
    candidates.push({start: first.index!, end: last.index! + last[0].length, score, source: 'fallback'});
  }
  let chosen: Span[] = [], best = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const pair = [candidates[i], candidates[j]].sort((a, b) => a.start - b.start);
      const [a, b] = pair;
      if (a.end > b.start) continue;
      const count = words.filter(w => (w.index! >= a.start && w.index! < a.end) || (w.index! >= b.start && w.index! < b.end)).length;
      if (words.length >= 3 && count >= words.length) continue;
      // Prefer strong phrases; distance breaks ties in favor of distinct parts of the title.
      const score = a.score + b.score + (b.start - a.end) / Math.max(title.length, 1);
      if (score > best) { best = score; chosen = pair; }
    }
  }
  return chosen;
}

export function highlightCardTitle(title: string): string {
  let cursor = 0, html = '';
  for (const [index, span] of selectTitleHighlights(title).entries()) {
    const style = index === 0 ? 'hot' : 'dark';
    html += escape(title.slice(cursor, span.start)) + `<mark class="section-rec__highlight section-rec__highlight--${style}">${escape(title.slice(span.start, span.end))}</mark>`;
    cursor = span.end;
  }
  return html + escape(title.slice(cursor));
}
