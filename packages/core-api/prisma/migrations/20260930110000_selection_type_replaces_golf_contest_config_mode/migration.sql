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

-- 3. The template's own mode column now holds the SelectionType it seeds. Only GOLF_TIERED rows
--    exist (GOLF_CATEGORY_PICKS was deleted by 20260902200000), and they differ by
--    template_key, so the unique key stays unique. #248 renames the column.
UPDATE "contest_config_templates"
SET "config_mode" = 'TIERED'
WHERE "config_mode" = 'GOLF_TIERED';
