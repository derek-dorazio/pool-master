-- 7b part B (#2044): every slot of an event that a contest of an active tiered or budget template
-- may start at holds a tier set of its own (chooseTierSetSlots): each slot a template covering one
-- slot (ONE_SLOT) or a slot onwards (FROM_SLOT) lists, and the first of the event's slots a template
-- covering them all (ALL_LISTED) lists. 027800 put an event's tiers on its tier-set slot, the first
-- of them; this gives each later one the same tier definitions, keys and numbers, with nobody
-- placed or priced yet. The next field sync, or an admin, fills them from the field still in when
-- the slot starts. A slot that already has tiers is left as it is. Data only; the schema does not
-- change.
--
-- Slots are in play order as compareSeasonSlots orders them, as 027800 does. The tiers copied are
-- those of the event's tier-set slot: the first starting slot with tiers.
WITH "ordered" AS (
  SELECT es."id", es."sport_event_id", s."sport_league_competition_slot_id" AS "definition_id",
    ROW_NUMBER() OVER (
      PARTITION BY es."sport_event_id"
      ORDER BY CASE WHEN d."slot_kind" = 'TOURNAMENT' THEN s."starts_at" END ASC NULLS LAST,
        d."slot_kind", COALESCE(d."week_number", 0), s."is_test_data", d."key", COALESCE(s."label", '')
    ) AS "play_order"
  FROM "sport_event_slots" es
  JOIN "sport_league_season_competition_slots" s ON s."id" = es."sport_league_season_competition_slot_id"
  JOIN "sport_league_competition_slots" d ON d."id" = s."sport_league_competition_slot_id"
),
"listings" AS (
  SELECT o."id", o."sport_event_id", o."play_order", t."id" AS "template_id", t."coverage_mode",
    MIN(o."play_order") OVER (PARTITION BY o."sport_event_id", t."id") AS "first_listed"
  FROM "ordered" o
  JOIN "contest_config_template_slots" ts ON ts."sport_league_competition_slot_id" = o."definition_id"
  JOIN "contest_config_templates" t ON t."id" = ts."template_id"
  WHERE t."active" AND t."selection_type" IN ('TIERED', 'BUDGET_PICK')
),
"starting" AS (
  SELECT DISTINCT l."id", l."sport_event_id", l."play_order"
  FROM "listings" l
  WHERE l."coverage_mode" <> 'ALL_LISTED' OR l."play_order" = l."first_listed"
),
"tier_set" AS (
  SELECT DISTINCT ON (st."sport_event_id") st."sport_event_id", st."id"
  FROM "starting" st
  WHERE EXISTS (SELECT 1 FROM "sport_event_slot_tiers" own WHERE own."sport_event_slot_id" = st."id")
  ORDER BY st."sport_event_id", st."play_order"
)
INSERT INTO "sport_event_slot_tiers" ("sport_event_slot_id", "tier_key", "tier_number", "updated_at")
SELECT later."id", source."tier_key", source."tier_number", CURRENT_TIMESTAMP
FROM "starting" later
JOIN "tier_set" ON "tier_set"."sport_event_id" = later."sport_event_id"
JOIN "sport_event_slot_tiers" source ON source."sport_event_slot_id" = "tier_set"."id"
WHERE NOT EXISTS (SELECT 1 FROM "sport_event_slot_tiers" own WHERE own."sport_event_slot_id" = later."id");
