const PORTUGUESE_DIACRITIC_FOLD: ReadonlyArray<readonly [string, string]> = [
  ['Á', 'a'], ['À', 'a'], ['Â', 'a'], ['Ã', 'a'],
  ['á', 'a'], ['à', 'a'], ['â', 'a'], ['ã', 'a'],
  ['É', 'e'], ['Ê', 'e'], ['é', 'e'], ['ê', 'e'],
  ['Í', 'i'], ['í', 'i'],
  ['Ó', 'o'], ['Ô', 'o'], ['Õ', 'o'],
  ['ó', 'o'], ['ô', 'o'], ['õ', 'o'],
  ['Ú', 'u'], ['ú', 'u'],
  ['Ç', 'c'], ['ç', 'c'],
  // Formas NFD mais comuns em português (acento separado do caractere-base).
  ['\u0300', ''], ['\u0301', ''], ['\u0302', ''], ['\u0303', ''],
  ['\u0308', ''], ['\u0327', ''],
];

const CATEGORY_PUNCTUATION = [
  '-', '_', '.', ',', '/', '\\', ':', ';', '|', '+', '=', '?', '!',
  '@', '#', '$', '%', '&', '*', '(', ')', '[', ']', '{', '}', '"', "'",
] as const;

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Chave editorial única usada no Worker antes de consultar o D1. */
export function normalizeCategoryKey(category: string | null | undefined): string {
  return (category ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function isArchivedCategoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('category is archived');
}

/**
 * Equivalente SQLite determinístico para categorias já gravadas no D1.
 * SQLite não oferece unaccent e o COLLATE NOCASE nativo cobre apenas ASCII.
 */
export function sqlCategoryKey(column: string): string {
  let expression = `coalesce(${column}, '')`;
  for (const [from, to] of PORTUGUESE_DIACRITIC_FOLD) {
    expression = `replace(${expression}, ${sqlLiteral(from)}, ${sqlLiteral(to)})`;
  }
  expression = `lower(${expression})`;
  for (const punctuation of CATEGORY_PUNCTUATION) {
    expression = `replace(${expression}, ${sqlLiteral(punctuation)}, ' ')`;
  }
  // Categorias são curtas; seis passes reduzem até 64 separadores consecutivos.
  for (let pass = 0; pass < 6; pass += 1) {
    expression = `replace(${expression}, '  ', ' ')`;
  }
  return `trim(${expression})`;
}

/**
 * Faz o match por tokens canônicos. O `%` entre palavras aceita qualquer
 * separador Unicode já armazenado (NBSP, travessão, emoji etc.) sem enumerá-lo.
 */
export function sqlArchivedCategoryMatch(
  categoryColumn: string,
  archivedKeyColumn = 'archived.category_key',
): string {
  const alias = 'archived_match';
  const lastToken = `substr(${alias}.archive_key, ${alias}.token_gap + 1)`;
  const betweenLength = `length(${alias}.category_value) - (${alias}.token_gap - 1) - length(${lastToken})`;
  const betweenTokens = `substr(${alias}.category_value, ${alias}.token_gap, ${betweenLength})`;
  return `EXISTS (
    SELECT 1
    FROM (
      SELECT ${sqlCategoryKey(categoryColumn)} AS category_value,
             ${archivedKeyColumn} AS archive_key,
             instr(${archivedKeyColumn}, ' ') AS token_gap
    ) AS ${alias}
    WHERE ${alias}.category_value LIKE replace(${alias}.archive_key, ' ', '%')
      AND (
        (${alias}.token_gap = 0 AND ${alias}.category_value = ${alias}.archive_key)
        OR (
          ${alias}.token_gap > 1
          AND instr(${lastToken}, ' ') = 0
          AND substr(${alias}.category_value, 1, ${alias}.token_gap - 1)
              = substr(${alias}.archive_key, 1, ${alias}.token_gap - 1)
          AND substr(${alias}.category_value, -length(${lastToken})) = ${lastToken}
          AND ${betweenLength} > 0
          AND ${betweenTokens} NOT GLOB '*[a-z0-9]*'
        )
      )
  )`;
}

export function publicPostVisibilitySql(alias = 'p'): string {
  return `${alias}.draft = 0
  AND NOT EXISTS (
    SELECT 1 FROM archived_categories AS archived
    WHERE ${sqlArchivedCategoryMatch(`${alias}.category`, 'archived.category_key')}
  )`;
}
