-- Áreas novas de monetização: Cartões de Crédito (afiliado CPA) e Empregos.
-- Mais a tabela de cliques de saída (afiliado / candidatura / promo interno),
-- bucketada por dia — mesmo padrão do pageviews_hourly.

-- ============== CARTÕES DE CRÉDITO ==============
CREATE TABLE IF NOT EXISTS credit_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,                       -- "Nubank Ultravioleta"
  issuer TEXT NOT NULL DEFAULT '',          -- banco/emissor: "Nubank"
  image_url TEXT,                           -- imagem do cartão (R2 ou externa)
  tagline TEXT NOT NULL DEFAULT '',         -- chamada curta: "Cashback de até 1%"
  annual_fee TEXT NOT NULL DEFAULT '',      -- "Sem anuidade" | "R$ 49/mês"
  benefits TEXT NOT NULL DEFAULT '[]',      -- JSON array de bullets (vantagens)
  badges TEXT NOT NULL DEFAULT '[]',        -- JSON array de selos: ["Sem anuidade","Cashback"]
  rating REAL,                              -- nota 0–5 (opcional)
  affiliate_url TEXT NOT NULL DEFAULT '',   -- link de afiliado (CTA) — fica fora do HTML público
  cta_label TEXT NOT NULL DEFAULT 'Peça já',
  category TEXT NOT NULL DEFAULT '',        -- "Cashback" | "Milhas" | "Sem anuidade" | "Iniciantes"
  featured INTEGER NOT NULL DEFAULT 0,      -- destaque no topo do comparador
  sort_order INTEGER NOT NULL DEFAULT 0,    -- ordenação manual (menor = primeiro)
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
  title TEXT NOT NULL,                       -- cargo: "Auxiliar Administrativo"
  company TEXT NOT NULL DEFAULT '',
  company_logo TEXT,
  location TEXT NOT NULL DEFAULT '',         -- "São Paulo, SP"
  remote INTEGER NOT NULL DEFAULT 0,         -- 1 = remoto/home office
  salary TEXT NOT NULL DEFAULT '',           -- "R$ 2.000–2.500" | "A combinar"
  type TEXT NOT NULL DEFAULT '',             -- "CLT" | "PJ" | "Estágio" | "Temporário"
  category TEXT NOT NULL DEFAULT '',         -- área: "Administrativo" | "Vendas" | "TI"
  description TEXT NOT NULL DEFAULT '',       -- markdown/HTML
  apply_url TEXT NOT NULL DEFAULT '',        -- link de candidatura (externo/afiliado)
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  posted_at INTEGER NOT NULL,
  expires_at INTEGER,                        -- opcional: some da listagem após esta data
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(active, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_slug ON jobs(slug);
CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);

-- ============== CLIQUES DE SAÍDA ==============
-- Conta cliques em links de afiliado/candidatura e no bloco promo interno.
-- kind: 'card' | 'job' | 'promo'.
-- target_id: id do cartão/vaga (texto) ou a área ('cartoes'/'empregos') pro promo.
CREATE TABLE IF NOT EXISTS outbound_clicks (
  bucket TEXT NOT NULL,          -- 'YYYY-MM-DD' (UTC)
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_oc_kind_bucket ON outbound_clicks(kind, bucket DESC);
