-- adiciona coluna source_url (mantém compat)
ALTER TABLE posts ADD COLUMN source_url TEXT;

-- tabela de redirects para URLs antigas
CREATE TABLE IF NOT EXISTS redirects (
  from_path TEXT PRIMARY KEY,
  to_slug TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redirects_to_slug ON redirects(to_slug);
