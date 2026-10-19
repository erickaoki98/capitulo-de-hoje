-- Additive, small covering index: avoid reading large content pages for rankings.
CREATE INDEX IF NOT EXISTS idx_posts_ranking_metadata ON posts(id, slug, category, draft);
