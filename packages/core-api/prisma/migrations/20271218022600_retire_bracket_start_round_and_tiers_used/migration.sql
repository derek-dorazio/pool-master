-- Retire a bracket's starting round and a tiered contest's first-tiers-only rule (#2172).
--
-- Every bracket is a full bracket, picked from the first round before the event starts, and
-- every tiered entry picks from all of the event's tiers. #2164 removed the last templates that
-- set either (second-chance brackets; golf's top 4 tiers and tennis's seeds only). A late-start
-- bracket comes back on slot coverage (#2171), not on these settings.
--
-- - The `startsAtRound` and `tiersUsed` keys go from every stored rule: templates and contest
--   configurations. Their schemas no longer name them, so a sent key is dropped like any
--   unknown key and never stored.
-- - The one event page offer of a bracket from a later round (the NFL bracket from the
--   conference round on Championship Weekend) goes with its column; the page's squares offer
--   heads it instead.

UPDATE "contest_config_templates"
SET "config_json" = "config_json" - 'startsAtRound' - 'tiersUsed', "updated_at" = CURRENT_TIMESTAMP
WHERE "config_json" ?| ARRAY['startsAtRound', 'tiersUsed'];

UPDATE "contest_configurations"
SET "config_json" = "config_json" - 'startsAtRound' - 'tiersUsed', "updated_at" = CURRENT_TIMESTAMP
WHERE "config_json" ?| ARRAY['startsAtRound', 'tiersUsed'];

-- The pages that lose their primary offer, before it goes.
CREATE TEMP TABLE "late_start_pages" ON COMMIT DROP AS
SELECT DISTINCT "event_page_id" FROM "event_page_offers" WHERE "bracket_start_round" IS NOT NULL AND "is_primary";

DELETE FROM "event_page_offers" WHERE "bracket_start_round" IS NOT NULL;

-- Each such page's first remaining offer heads it.
UPDATE "event_page_offers" o
SET "is_primary" = true, "updated_at" = CURRENT_TIMESTAMP
WHERE o."id" IN (
  SELECT DISTINCT ON (r."event_page_id") r."id"
  FROM "event_page_offers" r
  JOIN "late_start_pages" p ON p."event_page_id" = r."event_page_id"
  ORDER BY r."event_page_id", r."sort_order", r."id"
);

ALTER TABLE "event_page_offers" DROP CONSTRAINT IF EXISTS "event_page_offers_bracket_start_round_check";
ALTER TABLE "event_page_offers" DROP COLUMN "bracket_start_round";
