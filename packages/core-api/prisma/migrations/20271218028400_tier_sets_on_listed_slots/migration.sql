-- 7b part B (#2044): every slot of an event that an active tiered or budget template lists holds a
-- tier set of its own, since such a template covers one slot the commissioner picks from those it
-- lists. 027800 put an event's tiers on its tier-set slot, the first of them; this gives each later
-- one the same tier definitions, keys and numbers, with nobody placed or priced yet. The next field
-- sync, or an admin, fills them from the field still in when the slot starts. A slot that already
-- has tiers is left as it is. Data only; the schema does not change.
--
-- The tiers copied are those of the event's tier-set slot: of its slots with tiers, the first a
-- tiered or budget template lists, in play order (compareSeasonSlots', as 027800 orders them).
INSERT INTO "sport_event_slot_tiers" ("sport_event_slot_id", "tier_key", "tier_number", "updated_at")
SELECT later."id", source."tier_key", source."tier_number", CURRENT_TIMESTAMP
FROM "sport_event_slots" later
JOIN "sport_league_season_competition_slots" ss ON ss."id" = later."sport_league_season_competition_slot_id"
JOIN (
  SELECT DISTINCT ON (es."sport_event_id") es."sport_event_id", es."id"
  FROM "sport_event_slots" es
  JOIN "sport_league_season_competition_slots" s ON s."id" = es."sport_league_season_competition_slot_id"
  JOIN "sport_league_competition_slots" d ON d."id" = s."sport_league_competition_slot_id"
  WHERE EXISTS (SELECT 1 FROM "sport_event_slot_tiers" own WHERE own."sport_event_slot_id" = es."id")
  ORDER BY es."sport_event_id",
    NOT EXISTS (
      SELECT 1 FROM "contest_config_template_slots" ts
      JOIN "contest_config_templates" t ON t."id" = ts."template_id"
      WHERE ts."sport_league_competition_slot_id" = d."id" AND t."active" AND t."selection_type" IN ('TIERED', 'BUDGET_PICK')
    ),
    CASE WHEN d."slot_kind" = 'TOURNAMENT' THEN s."starts_at" END ASC NULLS LAST,
    d."slot_kind", COALESCE(d."week_number", 0), s."is_test_data", d."key", COALESCE(s."label", '')
) tier_set ON tier_set."sport_event_id" = later."sport_event_id"
JOIN "sport_event_slot_tiers" source ON source."sport_event_slot_id" = tier_set."id"
WHERE EXISTS (
    SELECT 1 FROM "contest_config_template_slots" ts
    JOIN "contest_config_templates" t ON t."id" = ts."template_id"
    WHERE ts."sport_league_competition_slot_id" = ss."sport_league_competition_slot_id"
      AND t."active" AND t."selection_type" IN ('TIERED', 'BUDGET_PICK')
  )
  AND NOT EXISTS (SELECT 1 FROM "sport_event_slot_tiers" own WHERE own."sport_event_slot_id" = later."id");
