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
    `INSERT INTO posts (slug, title, description, content, category, tags, author, hero_image, draft, pub_date, updated_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  );
  const result = await stmt.run();
  return Number(result.meta.last_row_id);
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
