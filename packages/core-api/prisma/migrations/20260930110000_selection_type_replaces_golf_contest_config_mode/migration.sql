-- plans/145 slice 3, #244 (decision Q4). SelectionType says how an entry picks, and always did.
-- GolfContestConfigMode had one value, GOLF_TIERED, carried in three places; all three go.
-- One transaction (Prisma runs the file as one).

-- 1. A redundant second copy of selection_type on the same row.
ALTER TABLE "contest_configurations" DROP COLUMN "config_mode";

-- 2. The same value as the discriminant inside the stored configuration, on contests and on
--    the templates that seed them. No other key in either document changes.
UPDATE "contest_configurations"
SET "config_json" = "config_json" - 'mode'
WHERE "config_json" ? 'mode';

UPDATE "contest_config_templates"
SET "config_json" = "config_json" - 'mode'
WHERE "config_json" ? 'mode';

-- 3. The template's own mode column becomes the SelectionType it seeds, under that name. Only
--    GOLF_TIERED rows exist (GOLF_CATEGORY_PICKS was deleted by 20260902200000), and they differ
--    by template_key, so the unique key stays unique.
UPDATE "contest_config_templates"
SET "config_mode" = 'TIERED'
WHERE "config_mode" = 'GOLF_TIERED';

-- A rename, not the drop-and-add `prisma migrate diff` emits, so the seeded rows keep their values.
ALTER TABLE "contest_config_templates" RENAME COLUMN "config_mode" TO "selection_type";

-- Postgres carries the unique index across the column rename but keeps its old name, which
-- Prisma derives from the column names (63-byte truncated). Rename it to the name Prisma
-- expects, read off `prisma migrate diff`; the same move as 20260506211309 made for this index.
ALTER INDEX "contest_config_templates_sport_event_type_contest_type_conf_key"
  RENAME TO "contest_config_templates_sport_event_type_contest_type_sele_key";
