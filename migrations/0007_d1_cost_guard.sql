-- Já existe em produção (conferido em 12/09/2026); persistir para ambientes novos.
-- A consulta limitada de ranking exige este índice e falha fechada se ele faltar.
CREATE INDEX IF NOT EXISTS idx_ph_bucket_path_count
  ON pageviews_hourly(bucket DESC, path, count);
CREATE TABLE IF NOT EXISTS active_visitors (
  visitor_id TEXT PRIMARY KEY,
  path TEXT NOT NULL DEFAULT '/',
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_active_visitors_last_seen
  ON active_visitors(last_seen);
