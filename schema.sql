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

-- Tabela de redirects para URLs antigas → novos slugs (caso WP use estrutura tipo /YYYY/MM/slug/)
CREATE TABLE IF NOT EXISTS redirects (
  from_path TEXT PRIMARY KEY,    -- pathname original (ex: '/2023/05/meu-post')
  to_slug TEXT NOT NULL          -- slug canônico atual
);
CREATE INDEX IF NOT EXISTS idx_redirects_to_slug ON redirects(to_slug);
