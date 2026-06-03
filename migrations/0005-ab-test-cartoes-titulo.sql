-- Teste A/B do título da página /cartoes (50+ vs 60+).
-- Mede CTR = cliques em cartão (afiliado) ÷ visitas à /cartoes, por variante.
CREATE TABLE IF NOT EXISTS ab_events (
  bucket TEXT NOT NULL,          -- 'YYYY-MM-DD' (UTC)
  test TEXT NOT NULL,            -- ex: 'cartoes_titulo'
  variant TEXT NOT NULL,         -- '50' | '60'
  event TEXT NOT NULL,           -- 'impression' | 'click'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, test, variant, event)
);
CREATE INDEX IF NOT EXISTS idx_ab_test ON ab_events(test, bucket DESC);
