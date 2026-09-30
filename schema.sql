CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  category TEXT,
  tags TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT 'Erick Aoki',
  hero_image TEXT,
  draft INTEGER NOT NULL DEFAULT 0,
  pub_date INTEGER NOT NULL,
  updated_date INTEGER NOT NULL,
  source_url TEXT  -- URL original (WordPress) — usada para 301 redirects ao migrar de domínio
);

CREATE INDEX IF NOT EXISTS idx_posts_pub_date ON posts(pub_date DESC);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_draft ON posts(draft);

-- Categorias arquivadas continuam no histórico administrativo, mas somem do site público.
CREATE TABLE IF NOT EXISTS archived_categories (
  category_key TEXT PRIMARY KEY,
  category TEXT NOT NULL COLLATE NOCASE UNIQUE,
  archived_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO archived_categories (category_key, category, archived_at)
VALUES ('coracao acelerado', 'Coração Acelerado', unixepoch());

CREATE TRIGGER IF NOT EXISTS posts_block_archived_category
BEFORE INSERT ON posts
WHEN EXISTS (
  SELECT 1
  FROM archived_categories AS archived
  WHERE EXISTS (
    SELECT 1
    FROM (
      SELECT trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(NEW.category, ''), 'Á', 'a'), 'À', 'a'), 'Â', 'a'), 'Ã', 'a'), 'á', 'a'), 'à', 'a'), 'â', 'a'), 'ã', 'a'), 'É', 'e'), 'Ê', 'e'), 'é', 'e'), 'ê', 'e'), 'Í', 'i'), 'í', 'i'), 'Ó', 'o'), 'Ô', 'o'), 'Õ', 'o'), 'ó', 'o'), 'ô', 'o'), 'õ', 'o'), 'Ú', 'u'), 'ú', 'u'), 'Ç', 'c'), 'ç', 'c'), '̀', ''), '́', ''), '̂', ''), '̃', ''), '̈', ''), '̧', '')), '-', ' '), '_', ' '), '.', ' '), ',', ' '), '/', ' '), '\', ' '), ':', ' '), ';', ' '), '|', ' '), '+', ' '), '=', ' '), '?', ' '), '!', ' '), '@', ' '), '#', ' '), '$', ' '), '%', ' '), '&', ' '), '*', ' '), '(', ' '), ')', ' '), '[', ' '), ']', ' '), '{', ' '), '}', ' '), '"', ' '), '''', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')) AS category_value,
             archived.category_key AS archive_key,
             instr(archived.category_key, ' ') AS token_gap
    ) AS archived_match
    WHERE archived_match.category_value LIKE replace(archived_match.archive_key, ' ', '%')
      AND (
        (archived_match.token_gap = 0 AND archived_match.category_value = archived_match.archive_key)
        OR (
          archived_match.token_gap > 1
          AND instr(substr(archived_match.archive_key, archived_match.token_gap + 1), ' ') = 0
          AND substr(archived_match.category_value, 1, archived_match.token_gap - 1)
              = substr(archived_match.archive_key, 1, archived_match.token_gap - 1)
          AND substr(archived_match.category_value, -length(substr(archived_match.archive_key, archived_match.token_gap + 1))) = substr(archived_match.archive_key, archived_match.token_gap + 1)
          AND length(archived_match.category_value) - (archived_match.token_gap - 1) - length(substr(archived_match.archive_key, archived_match.token_gap + 1)) > 0
          AND substr(archived_match.category_value, archived_match.token_gap, length(archived_match.category_value) - (archived_match.token_gap - 1) - length(substr(archived_match.archive_key, archived_match.token_gap + 1))) NOT GLOB '*[a-z0-9]*'
        )
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'category is archived');
END;


-- Tabela de redirects para URLs antigas → novos slugs (caso WP use estrutura tipo /YYYY/MM/slug/)
CREATE TABLE IF NOT EXISTS redirects (
  from_path TEXT PRIMARY KEY,    -- pathname original (ex: '/2023/05/meu-post')
  to_slug TEXT NOT NULL          -- slug canônico atual
);
CREATE INDEX IF NOT EXISTS idx_redirects_to_slug ON redirects(to_slug);

-- ============== CARTÕES DE CRÉDITO (afiliado) ==============
CREATE TABLE IF NOT EXISTS credit_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  issuer TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  tagline TEXT NOT NULL DEFAULT '',
  annual_fee TEXT NOT NULL DEFAULT '',
  benefits TEXT NOT NULL DEFAULT '[]',
  badges TEXT NOT NULL DEFAULT '[]',
  rating REAL,
  affiliate_url TEXT NOT NULL DEFAULT '',
  cta_label TEXT NOT NULL DEFAULT 'Peça já',
  category TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_active ON credit_cards(active, sort_order);
CREATE INDEX IF NOT EXISTS idx_cards_slug ON credit_cards(slug);
CREATE INDEX IF NOT EXISTS idx_cards_category ON credit_cards(category);

-- ============== EMPREGOS ==============
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  company_logo TEXT,
  location TEXT NOT NULL DEFAULT '',
  remote INTEGER NOT NULL DEFAULT 0,
  salary TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  apply_url TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  posted_at INTEGER NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(active, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_slug ON jobs(slug);
CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);

-- ============== CLIQUES DE SAÍDA (afiliado/candidatura/promo) ==============
CREATE TABLE IF NOT EXISTS outbound_clicks (
  bucket TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_oc_kind_bucket ON outbound_clicks(kind, bucket DESC);

-- ============== BANNERS NATIVOS × ADSENSE (teste A/B) ==============
-- Ver migrations/0007-ad-mix-events.sql. Também é criada sob demanda pelo Worker.
CREATE TABLE IF NOT EXISTS ad_mix_events (
  test TEXT NOT NULL,
  bucket TEXT NOT NULL,
  placement TEXT NOT NULL,
  source TEXT NOT NULL,
  creative TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (test, bucket, placement, source, creative, format, event)
);
