-- Teste banners nativos × AdSense (Admin → Monetização → Nativos e teste A/B).
-- Impressões/cliques agregados por dia. `test` muda ao "zerar contagem", então o
-- resultado de um teste novo não se mistura com o anterior (nada é apagado).
-- Obs.: o Worker também cria esta tabela sozinho na 1ª gravação (recordAdMixEvents).
CREATE TABLE IF NOT EXISTS ad_mix_events (
  test TEXT NOT NULL,              -- id do teste (base36 do início)
  bucket TEXT NOT NULL,            -- 'YYYY-MM-DD' (UTC)
  placement TEXT NOT NULL,         -- 'topOfContent' | 'inContent' | ...
  source TEXT NOT NULL,            -- 'native' | 'adsense'
  creative TEXT NOT NULL DEFAULT '', -- id do banner ('' no AdSense)
  format TEXT NOT NULL DEFAULT '',   -- '16x9' | '300x250' | '320x100' | '728x90' | '320x50' | ''
  event TEXT NOT NULL,             -- 'imp' | 'click'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (test, bucket, placement, source, creative, format, event)
);
