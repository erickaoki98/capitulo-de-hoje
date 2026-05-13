-- Coluna pra marcar que já tentamos migrar imagens do post.
-- Posts com images_migrated_at IS NOT NULL não retornam de nextPostsToMigrate.
ALTER TABLE posts ADD COLUMN images_migrated_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_posts_images_migrated ON posts(images_migrated_at);
