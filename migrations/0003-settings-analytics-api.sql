-- Settings (key/value) — usado por AdSense, opções globais, etc.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Pageviews por hora — bucketed para velocidade nas queries de "top 48h"
CREATE TABLE IF NOT EXISTS pageviews_hourly (
  bucket TEXT NOT NULL,         -- 'YYYY-MM-DDTHH' (UTC)
  path TEXT NOT NULL,           -- '/slug-do-post'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, path)
);
CREATE INDEX IF NOT EXISTS idx_ph_bucket ON pageviews_hourly(bucket DESC);
CREATE INDEX IF NOT EXISTS idx_ph_path_bucket ON pageviews_hourly(path, bucket DESC);

-- API keys para postagem externa
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_prefix TEXT NOT NULL,     -- primeiros 8 chars (exibidos no admin)
  key_hash TEXT UNIQUE NOT NULL,-- SHA-256 do token completo
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active, key_hash);
