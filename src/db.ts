import type { Post, PostInput } from './types';

export async function listPosts(
  db: D1Database,
  opts: { includeDrafts?: boolean; limit?: number } = {},
): Promise<Post[]> {
  const { includeDrafts = false, limit = 100 } = opts;
  const where = includeDrafts ? '1=1' : 'draft = 0';
  const stmt = db.prepare(
    `SELECT * FROM posts WHERE ${where} ORDER BY pub_date DESC LIMIT ?`,
  ).bind(limit);
  const { results } = await stmt.all<Post>();
  return results ?? [];
}

export async function getPostBySlug(db: D1Database, slug: string): Promise<Post | null> {
  const stmt = db.prepare('SELECT * FROM posts WHERE slug = ? LIMIT 1').bind(slug);
  return await stmt.first<Post>();
}

export async function getPostById(db: D1Database, id: number): Promise<Post | null> {
  const stmt = db.prepare('SELECT * FROM posts WHERE id = ? LIMIT 1').bind(id);
  return await stmt.first<Post>();
}

export async function createPost(db: D1Database, input: PostInput): Promise<number> {
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO posts (slug, title, description, content, category, tags, author, hero_image, draft, pub_date, updated_date, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.slug,
    input.title,
    input.description,
    input.content,
    input.category,
    input.tags,
    input.author,
    input.hero_image,
    input.draft,
    input.pub_date,
    now,
    input.source_url ?? null,
  );
  const result = await stmt.run();
  return Number(result.meta.last_row_id);
}

/**
 * Cadastra um redirect from_path → to_slug. Idempotente.
 */
export async function upsertRedirect(db: D1Database, fromPath: string, toSlug: string): Promise<void> {
  await db.prepare(
    `INSERT INTO redirects (from_path, to_slug) VALUES (?, ?)
     ON CONFLICT(from_path) DO UPDATE SET to_slug = excluded.to_slug`,
  ).bind(fromPath, toSlug).run();
}

/**
 * Insere múltiplos posts em uma única request batch para o D1.
 * Muito mais rápido que inserir um por um. Limite recomendado: 50/batch.
 * Posts com slug duplicado disparam erro; o caller deve filtrar antes.
 */
export async function createPostsBatch(db: D1Database, inputs: PostInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const now = Date.now();
  const stmts = inputs.map((input) =>
    db.prepare(
      `INSERT INTO posts (slug, title, description, content, category, tags, author, hero_image, draft, pub_date, updated_date, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.slug,
      input.title,
      input.description,
      input.content,
      input.category,
      input.tags,
      input.author,
      input.hero_image,
      input.draft,
      input.pub_date,
      now,
      input.source_url ?? null,
    ),
  );
  await db.batch(stmts);
}

/**
 * Insere múltiplos redirects em uma única request batch.
 */
export async function upsertRedirectsBatch(
  db: D1Database, pairs: Array<{ from: string; to: string }>,
): Promise<void> {
  if (pairs.length === 0) return;
  const stmts = pairs.map(({ from, to }) =>
    db.prepare(
      `INSERT INTO redirects (from_path, to_slug) VALUES (?, ?)
       ON CONFLICT(from_path) DO UPDATE SET to_slug = excluded.to_slug`,
    ).bind(from, to),
  );
  await db.batch(stmts);
}

/**
 * Retorna slugs já existentes dentre uma lista candidata.
 * Útil pra deduplicar antes de batch insert.
 * Internamente faz batches de 90 placeholders (limite D1 é ~100 binds/query).
 */
export async function existingSlugs(db: D1Database, slugs: string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const CHUNK = 90;
  const existing = new Set<string>();
  for (let i = 0; i < slugs.length; i += CHUNK) {
    const slice = slugs.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT slug FROM posts WHERE slug IN (${placeholders})`,
    ).bind(...slice).all<{ slug: string }>();
    for (const r of (results ?? [])) existing.add(r.slug);
  }
  return existing;
}

/**
 * Busca slug para um redirect dado.
 */
export async function findRedirect(db: D1Database, fromPath: string): Promise<string | null> {
  const row = await db.prepare(
    'SELECT to_slug FROM redirects WHERE from_path = ? LIMIT 1',
  ).bind(fromPath).first<{ to_slug: string }>();
  return row?.to_slug ?? null;
}

/**
 * Conta posts com URLs externas (não em /img/) no hero_image ou content.
 * Usado para a página de migração de imagens.
 */
export async function countPostsWithExternalImages(db: D1Database): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM posts
     WHERE hero_image LIKE 'http%'
        OR content LIKE '%<img%src="http%'
        OR content LIKE '%<img%src=''http%'`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Conta posts que JÁ TIVERAM imagens (hero ou content), seja externa ou local.
 * Usado pra calcular o total da progress bar.
 */
export async function countPostsWithAnyImages(db: D1Database): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM posts
     WHERE hero_image IS NOT NULL
        OR content LIKE '%<img%'`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Pega o próximo lote de posts que ainda têm imagens externas.
 */
export async function nextPostsToMigrate(db: D1Database, limit: number): Promise<Post[]> {
  const { results } = await db.prepare(
    `SELECT * FROM posts
     WHERE hero_image LIKE 'http%'
        OR content LIKE '%<img%src="http%'
        OR content LIKE '%<img%src=''http%'
     ORDER BY id ASC LIMIT ?`,
  ).bind(limit).all<Post>();
  return results ?? [];
}

/**
 * Atualiza apenas content + hero_image de um post (usado pela migração).
 */
export async function updatePostContent(
  db: D1Database, id: number, content: string, heroImage: string | null,
): Promise<void> {
  await db.prepare(
    'UPDATE posts SET content = ?, hero_image = ?, updated_date = ? WHERE id = ?',
  ).bind(content, heroImage, Date.now(), id).run();
}

export async function updatePost(db: D1Database, id: number, input: PostInput): Promise<void> {
  const now = Date.now();
  const stmt = db.prepare(
    `UPDATE posts SET slug = ?, title = ?, description = ?, content = ?, category = ?, tags = ?, author = ?, hero_image = ?, draft = ?, pub_date = ?, updated_date = ?
     WHERE id = ?`,
  ).bind(
    input.slug,
    input.title,
    input.description,
    input.content,
    input.category,
    input.tags,
    input.author,
    input.hero_image,
    input.draft,
    input.pub_date,
    now,
    id,
  );
  await stmt.run();
}

export async function deletePost(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
}
