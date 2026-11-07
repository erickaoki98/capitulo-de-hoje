-- Additive only. Existing integration keys retain their access and no expiry.
ALTER TABLE api_keys ADD COLUMN scopes TEXT NOT NULL DEFAULT 'read,write';
ALTER TABLE api_keys ADD COLUMN expires_at INTEGER;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  credential_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_login_limits (
  id_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_login_limits_window ON admin_login_limits(window_start);
