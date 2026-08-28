CREATE TABLE IF NOT EXISTS archived_categories (
  category_key TEXT PRIMARY KEY,
  category TEXT NOT NULL COLLATE NOCASE UNIQUE,
  archived_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO archived_categories (category_key, category, archived_at)
VALUES ('coracao acelerado', 'Coração Acelerado', unixepoch());

CREATE TRIGGER IF NOT EXISTS posts_block_archived_category
BEFORE INSERT ON posts
WHEN EXISTS (
  SELECT 1
  FROM archived_categories AS archived
  WHERE EXISTS (
    SELECT 1
    FROM (
      SELECT trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(NEW.category, ''), 'Á', 'a'), 'À', 'a'), 'Â', 'a'), 'Ã', 'a'), 'á', 'a'), 'à', 'a'), 'â', 'a'), 'ã', 'a'), 'É', 'e'), 'Ê', 'e'), 'é', 'e'), 'ê', 'e'), 'Í', 'i'), 'í', 'i'), 'Ó', 'o'), 'Ô', 'o'), 'Õ', 'o'), 'ó', 'o'), 'ô', 'o'), 'õ', 'o'), 'Ú', 'u'), 'ú', 'u'), 'Ç', 'c'), 'ç', 'c'), '̀', ''), '́', ''), '̂', ''), '̃', ''), '̈', ''), '̧', '')), '-', ' '), '_', ' '), '.', ' '), ',', ' '), '/', ' '), '\', ' '), ':', ' '), ';', ' '), '|', ' '), '+', ' '), '=', ' '), '?', ' '), '!', ' '), '@', ' '), '#', ' '), '$', ' '), '%', ' '), '&', ' '), '*', ' '), '(', ' '), ')', ' '), '[', ' '), ']', ' '), '{', ' '), '}', ' '), '"', ' '), '''', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')) AS category_value,
             archived.category_key AS archive_key,
             instr(archived.category_key, ' ') AS token_gap
    ) AS archived_match
    WHERE archived_match.category_value LIKE replace(archived_match.archive_key, ' ', '%')
      AND (
        (archived_match.token_gap = 0 AND archived_match.category_value = archived_match.archive_key)
        OR (
          archived_match.token_gap > 1
          AND instr(substr(archived_match.archive_key, archived_match.token_gap + 1), ' ') = 0
          AND substr(archived_match.category_value, 1, archived_match.token_gap - 1)
              = substr(archived_match.archive_key, 1, archived_match.token_gap - 1)
          AND substr(archived_match.category_value, -length(substr(archived_match.archive_key, archived_match.token_gap + 1))) = substr(archived_match.archive_key, archived_match.token_gap + 1)
          AND length(archived_match.category_value) - (archived_match.token_gap - 1) - length(substr(archived_match.archive_key, archived_match.token_gap + 1)) > 0
          AND substr(archived_match.category_value, archived_match.token_gap, length(archived_match.category_value) - (archived_match.token_gap - 1) - length(substr(archived_match.archive_key, archived_match.token_gap + 1))) NOT GLOB '*[a-z0-9]*'
        )
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'category is archived');
END;
