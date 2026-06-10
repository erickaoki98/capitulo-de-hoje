import type {
  Post, PostInput,
  CreditCard, CreditCardInput,
  Job, JobInput,
  OutboundClickKind,
} from './types';

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

/** Conta posts publicados (para sitemap index) */
export async function countPublishedPosts(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM posts WHERE draft = 0').first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Resumo de contagem de posts em UMA query (total / publicados / rascunhos).
 * Usado no dashboard — NÃO carregar a lista de posts e contar no JS (isso travava
 * o número no limite da lista, ex.: 500, quando há milhares de posts).
 */
export async function countPostsSummary(
  db: D1Database,
): Promise<{ total: number; published: number; drafts: number }> {
  const row = await db.prepare(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN draft = 0 THEN 1 ELSE 0 END) AS published FROM posts',
  ).first<{ total: number; published: number | null }>();
  const total = row?.total ?? 0;
  const published = row?.published ?? 0;
  return { total, published, drafts: total - published };
}

/** Lista posts paginados com offset (para sitemap paginado) — retorna só slug + datas */
export async function listPostsForSitemap(
  db: D1Database, limit: number, offset: number,
): Promise<Array<{ slug: string; updated_date: number; pub_date: number }>> {
  const { results } = await db.prepare(
    'SELECT slug, updated_date, pub_date FROM posts WHERE draft = 0 ORDER BY pub_date DESC LIMIT ? OFFSET ?',
  ).bind(limit, offset).all<{ slug: string; updated_date: number; pub_date: number }>();
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
 * Conta posts pendentes de migração: têm URLs externas E ainda não tentamos migrar.
 */
export async function countPostsWithExternalImages(db: D1Database): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM posts
     WHERE images_migrated_at IS NULL
       AND (hero_image LIKE 'http%'
            OR content LIKE '%<img%src="http%'
            OR content LIKE '%<img%src=''http%')`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Conta posts que têm qualquer imagem (pra denominator da progress bar).
 */
export async function countPostsWithAnyImages(db: D1Database): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM posts
     WHERE hero_image IS NOT NULL OR content LIKE '%<img%'`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Pega o próximo lote de posts pendentes de migração.
 * Ordem: pub_date DESC — os mais recentes (mais visíveis na home) vêm primeiro.
 */
export async function nextPostsToMigrate(db: D1Database, limit: number): Promise<Post[]> {
  const { results } = await db.prepare(
    `SELECT * FROM posts
     WHERE images_migrated_at IS NULL
       AND (hero_image LIKE 'http%'
            OR content LIKE '%<img%src="http%'
            OR content LIKE '%<img%src=''http%')
     ORDER BY pub_date DESC LIMIT ?`,
  ).bind(limit).all<Post>();
  return results ?? [];
}

/**
 * Marca múltiplos posts como tendo migração de imagens tentada.
 */
export async function markPostsMigrated(db: D1Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const now = Date.now();
  const stmts = ids.map((id) =>
    db.prepare('UPDATE posts SET images_migrated_at = ? WHERE id = ?').bind(now, id),
  );
  await db.batch(stmts);
}

// ============== SETTINGS (key/value) ==============

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(key, value, Date.now()).run();
}

export async function getAllSettings(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const r of results ?? []) out[r.key] = r.value;
  return out;
}

// ============== PAGE VIEWS ==============

/** Hora UTC atual no formato 'YYYY-MM-DDTHH' */
export function currentBucket(): string {
  const d = new Date();
  return d.toISOString().slice(0, 13);
}

/** Incrementa contador de pageview pro path no bucket atual */
export async function recordPageview(db: D1Database, path: string): Promise<void> {
  const bucket = currentBucket();
  await db.prepare(
    `INSERT INTO pageviews_hourly (bucket, path, count) VALUES (?, ?, 1)
     ON CONFLICT(bucket, path) DO UPDATE SET count = count + 1`,
  ).bind(bucket, path).run();
}

/** Top N paths por views nas últimas H horas (UTC) */
export async function topPostsByViews(
  db: D1Database, hours: number, limit: number, excludePath?: string,
): Promise<Array<{ path: string; views: number }>> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString().slice(0, 13);
  const exclude = excludePath ?? '__none__';
  const { results } = await db.prepare(
    `SELECT path, SUM(count) AS views
     FROM pageviews_hourly
     WHERE bucket >= ? AND path != ? AND path LIKE '/%' AND path NOT LIKE '/admin%'
       AND path NOT LIKE '/api%' AND path NOT LIKE '/img%'
       AND path NOT IN ('/', '/sitemap.xml', '/robots.txt', '/rss.xml', '/privacidade', '/favicon.svg', '/styles.css', '/doc')
     GROUP BY path
     ORDER BY views DESC LIMIT ?`,
  ).bind(since, exclude, limit).all<{ path: string; views: number }>();
  return results ?? [];
}

/** Busca posts por slug (sem todo o content — só metadados pro card) */
export async function getPostsBySlugList(db: D1Database, slugs: string[]): Promise<Post[]> {
  if (slugs.length === 0) return [];
  const placeholders = slugs.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT * FROM posts WHERE slug IN (${placeholders}) AND draft = 0`,
  ).bind(...slugs).all<Post>();
  return results ?? [];
}

/** Views de um único path nas últimas N horas. */
export async function viewsForPath(db: D1Database, path: string, hours: number): Promise<number> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString().slice(0, 13);
  const row = await db.prepare(
    'SELECT SUM(count) AS views FROM pageviews_hourly WHERE path = ? AND bucket >= ?',
  ).bind(path, since).first<{ views: number }>();
  return row?.views ?? 0;
}

/** Total de views (todas as horas) por path. Uma única query → Map path → views.
 *  Usado na lista do admin pra mostrar as views de cada artigo sem N queries. */
export async function totalViewsByPath(db: D1Database): Promise<Map<string, number>> {
  const { results } = await db.prepare(
    'SELECT path, SUM(count) AS views FROM pageviews_hourly GROUP BY path',
  ).all<{ path: string; views: number }>();
  const map = new Map<string, number>();
  for (const r of results ?? []) map.set(r.path, r.views ?? 0);
  return map;
}

/** Pageviews agregados nas últimas N horas — total e por path */
export async function pageviewsSummary(db: D1Database, hours: number): Promise<{
  total: number;
  topPaths: Array<{ path: string; views: number }>;
}> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString().slice(0, 13);
  const totalRow = await db.prepare(
    'SELECT SUM(count) AS total FROM pageviews_hourly WHERE bucket >= ?',
  ).bind(since).first<{ total: number }>();
  const { results: top } = await db.prepare(
    `SELECT path, SUM(count) AS views FROM pageviews_hourly
     WHERE bucket >= ? AND path NOT LIKE '/admin%' AND path NOT LIKE '/api%' AND path NOT LIKE '/img%'
     GROUP BY path ORDER BY views DESC LIMIT 25`,
  ).bind(since).all<{ path: string; views: number }>();
  return { total: totalRow?.total ?? 0, topPaths: top ?? [] };
}

/** Série temporal por dia (para gráfico) */
export async function pageviewsByDay(db: D1Database, days: number): Promise<Array<{ day: string; views: number }>> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 13);
  const { results } = await db.prepare(
    `SELECT substr(bucket, 1, 10) AS day, SUM(count) AS views
     FROM pageviews_hourly
     WHERE bucket >= ?
     GROUP BY day
     ORDER BY day ASC`,
  ).bind(since).all<{ day: string; views: number }>();
  return results ?? [];
}

// ============== API KEYS ==============

export interface ApiKey {
  id: number;
  key_prefix: string;
  key_hash: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
  active: number;
}

export async function listApiKeys(db: D1Database): Promise<ApiKey[]> {
  const { results } = await db.prepare(
    'SELECT * FROM api_keys ORDER BY created_at DESC',
  ).all<ApiKey>();
  return results ?? [];
}

export async function insertApiKey(
  db: D1Database, name: string, prefix: string, hash: string,
): Promise<number> {
  const r = await db.prepare(
    `INSERT INTO api_keys (key_prefix, key_hash, name, created_at, active)
     VALUES (?, ?, ?, ?, 1)`,
  ).bind(prefix, hash, name, Date.now()).run();
  return Number(r.meta.last_row_id);
}

export async function findApiKeyByHash(db: D1Database, hash: string): Promise<ApiKey | null> {
  return await db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND active = 1')
    .bind(hash).first<ApiKey>();
}

export async function touchApiKey(db: D1Database, id: number): Promise<void> {
  await db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
    .bind(Date.now(), id).run();
}

export async function deleteApiKey(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM api_keys WHERE id = ?').bind(id).run();
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

// ============== CARTÕES DE CRÉDITO ==============

export async function listCreditCards(
  db: D1Database,
  opts: { activeOnly?: boolean; category?: string } = {},
): Promise<CreditCard[]> {
  const { activeOnly = true, category } = opts;
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (activeOnly) clauses.push('active = 1');
  if (category) { clauses.push('category = ?'); binds.push(category); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { results } = await db.prepare(
    `SELECT * FROM credit_cards ${where} ORDER BY featured DESC, sort_order ASC, created_at DESC`,
  ).bind(...binds).all<CreditCard>();
  return results ?? [];
}

export async function getCreditCardById(db: D1Database, id: number): Promise<CreditCard | null> {
  return await db.prepare('SELECT * FROM credit_cards WHERE id = ? LIMIT 1').bind(id).first<CreditCard>();
}

export async function getCreditCardBySlug(db: D1Database, slug: string): Promise<CreditCard | null> {
  return await db.prepare('SELECT * FROM credit_cards WHERE slug = ? LIMIT 1').bind(slug).first<CreditCard>();
}

/** Conta cartões ativos — usado para só mostrar o bloco promo quando há o que promover. */
export async function countActiveCreditCards(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM credit_cards WHERE active = 1').first<{ n: number }>();
  return row?.n ?? 0;
}

/** Categorias distintas de cartões ativos (para os filtros do comparador). */
export async function creditCardCategories(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT DISTINCT category FROM credit_cards WHERE active = 1 AND category != '' ORDER BY category`,
  ).all<{ category: string }>();
  return (results ?? []).map((r) => r.category);
}

export async function createCreditCard(db: D1Database, input: CreditCardInput): Promise<number> {
  const now = Date.now();
  const r = await db.prepare(
    `INSERT INTO credit_cards
       (slug, name, issuer, image_url, tagline, annual_fee, benefits, badges, rating,
        affiliate_url, cta_label, category, featured, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.slug, input.name, input.issuer, input.image_url, input.tagline, input.annual_fee,
    input.benefits, input.badges, input.rating, input.affiliate_url, input.cta_label,
    input.category, input.featured, input.sort_order, input.active, now, now,
  ).run();
  return Number(r.meta.last_row_id);
}

export async function updateCreditCard(db: D1Database, id: number, input: CreditCardInput): Promise<void> {
  await db.prepare(
    `UPDATE credit_cards SET
       slug = ?, name = ?, issuer = ?, image_url = ?, tagline = ?, annual_fee = ?,
       benefits = ?, badges = ?, rating = ?, affiliate_url = ?, cta_label = ?,
       category = ?, featured = ?, sort_order = ?, active = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    input.slug, input.name, input.issuer, input.image_url, input.tagline, input.annual_fee,
    input.benefits, input.badges, input.rating, input.affiliate_url, input.cta_label,
    input.category, input.featured, input.sort_order, input.active, Date.now(), id,
  ).run();
}

export async function deleteCreditCard(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM credit_cards WHERE id = ?').bind(id).run();
}

// ============== EMPREGOS ==============

export async function listJobs(
  db: D1Database,
  opts: { activeOnly?: boolean; category?: string; limit?: number } = {},
): Promise<Job[]> {
  const { activeOnly = true, category, limit = 200 } = opts;
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (activeOnly) {
    clauses.push('active = 1');
    // Esconde vagas expiradas (expires_at no passado).
    clauses.push('(expires_at IS NULL OR expires_at > ?)');
    binds.push(Date.now());
  }
  if (category) { clauses.push('category = ?'); binds.push(category); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  binds.push(limit);
  const { results } = await db.prepare(
    `SELECT * FROM jobs ${where} ORDER BY featured DESC, posted_at DESC LIMIT ?`,
  ).bind(...binds).all<Job>();
  return results ?? [];
}

export async function getJobById(db: D1Database, id: number): Promise<Job | null> {
  return await db.prepare('SELECT * FROM jobs WHERE id = ? LIMIT 1').bind(id).first<Job>();
}

export async function getJobBySlug(db: D1Database, slug: string): Promise<Job | null> {
  return await db.prepare('SELECT * FROM jobs WHERE slug = ? LIMIT 1').bind(slug).first<Job>();
}

/** Categorias (áreas) distintas de vagas ativas — para os filtros da listagem. */
export async function jobCategories(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT DISTINCT category FROM jobs
     WHERE active = 1 AND category != '' AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY category`,
  ).bind(Date.now()).all<{ category: string }>();
  return (results ?? []).map((r) => r.category);
}

export async function createJob(db: D1Database, input: JobInput): Promise<number> {
  const now = Date.now();
  const r = await db.prepare(
    `INSERT INTO jobs
       (slug, title, company, company_logo, location, remote, salary, type, category,
        description, apply_url, featured, active, posted_at, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.slug, input.title, input.company, input.company_logo, input.location, input.remote,
    input.salary, input.type, input.category, input.description, input.apply_url,
    input.featured, input.active, input.posted_at, input.expires_at, now, now,
  ).run();
  return Number(r.meta.last_row_id);
}

export async function updateJob(db: D1Database, id: number, input: JobInput): Promise<void> {
  await db.prepare(
    `UPDATE jobs SET
       slug = ?, title = ?, company = ?, company_logo = ?, location = ?, remote = ?,
       salary = ?, type = ?, category = ?, description = ?, apply_url = ?,
       featured = ?, active = ?, posted_at = ?, expires_at = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    input.slug, input.title, input.company, input.company_logo, input.location, input.remote,
    input.salary, input.type, input.category, input.description, input.apply_url,
    input.featured, input.active, input.posted_at, input.expires_at, Date.now(), id,
  ).run();
}

export async function deleteJob(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM jobs WHERE id = ?').bind(id).run();
}

// ============== CLIQUES DE SAÍDA (afiliado / candidatura / promo) ==============

/** Dia UTC atual no formato 'YYYY-MM-DD'. */
export function currentDayBucket(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Incrementa o contador de cliques de saída para (kind, target_id) no dia atual. */
export async function recordOutboundClick(
  db: D1Database, kind: OutboundClickKind, targetId: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO outbound_clicks (bucket, kind, target_id, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(bucket, kind, target_id) DO UPDATE SET count = count + 1`,
  ).bind(currentDayBucket(), kind, targetId).run();
}

/** Cliques agregados por target nos últimos N dias, para um tipo. */
export async function outboundClicksByTarget(
  db: D1Database, kind: OutboundClickKind, days: number,
): Promise<Array<{ target_id: string; clicks: number }>> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const { results } = await db.prepare(
    `SELECT target_id, SUM(count) AS clicks FROM outbound_clicks
     WHERE kind = ? AND bucket >= ?
     GROUP BY target_id ORDER BY clicks DESC`,
  ).bind(kind, since).all<{ target_id: string; clicks: number }>();
  return results ?? [];
}

/** Total de cliques de um tipo nos últimos N dias. */
export async function outboundClicksTotal(
  db: D1Database, kind: OutboundClickKind, days: number,
): Promise<number> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const row = await db.prepare(
    `SELECT SUM(count) AS n FROM outbound_clicks WHERE kind = ? AND bucket >= ?`,
  ).bind(kind, since).first<{ n: number }>();
  return row?.n ?? 0;
}

// ============== A/B TESTS ==============

export type AbVariant = '50' | '60';
export type AbEventType = 'impression' | 'click';

/** Incrementa o contador de um evento A/B (impressão ou clique) no dia atual. */
export async function recordAbEvent(
  db: D1Database, test: string, variant: string, event: AbEventType,
): Promise<void> {
  await db.prepare(
    `INSERT INTO ab_events (bucket, test, variant, event, count) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(bucket, test, variant, event) DO UPDATE SET count = count + 1`,
  ).bind(currentDayBucket(), test, variant, event).run();
}

export interface AbVariantStats {
  variant: string;
  impressions: number;
  clicks: number;
}

/** Resultado agregado de um teste A/B nos últimos N dias, por variante. */
export async function abTestResults(
  db: D1Database, test: string, days: number,
): Promise<AbVariantStats[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const { results } = await db.prepare(
    `SELECT variant,
            SUM(CASE WHEN event = 'impression' THEN count ELSE 0 END) AS impressions,
            SUM(CASE WHEN event = 'click' THEN count ELSE 0 END) AS clicks
     FROM ab_events
     WHERE test = ? AND bucket >= ?
     GROUP BY variant
     ORDER BY variant`,
  ).bind(test, since).all<{ variant: string; impressions: number; clicks: number }>();
  return (results ?? []).map((r) => ({
    variant: r.variant,
    impressions: r.impressions ?? 0,
    clicks: r.clicks ?? 0,
  }));
}

// ============== ACTIVE VISITORS (contador ao vivo) ==============

export async function ensureActiveVisitorsTable(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS active_visitors (
       visitor_id TEXT PRIMARY KEY,
       path TEXT NOT NULL DEFAULT '/',
       last_seen INTEGER NOT NULL
     )`,
  ).run();
}

export async function recordHeartbeat(db: D1Database, visitorId: string, path: string): Promise<void> {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO active_visitors (visitor_id, path, last_seen) VALUES (?, ?, ?)
     ON CONFLICT(visitor_id) DO UPDATE SET path = excluded.path, last_seen = excluded.last_seen`,
  ).bind(visitorId, path, now).run();
}

export async function countActiveVisitors(db: D1Database, windowMs = 300_000): Promise<number> {
  const since = Date.now() - windowMs;
  const row = await db.prepare(
    'SELECT COUNT(*) AS n FROM active_visitors WHERE last_seen >= ?',
  ).bind(since).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function cleanupStaleVisitors(db: D1Database, windowMs = 300_000): Promise<void> {
  const since = Date.now() - windowMs;
  await db.prepare('DELETE FROM active_visitors WHERE last_seen < ?').bind(since).run();
}
