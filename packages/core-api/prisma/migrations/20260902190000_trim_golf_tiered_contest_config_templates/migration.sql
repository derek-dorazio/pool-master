-- plans/124-golf-admin-tournament-management.md §4.6/§4.6a/§4.6c.
--
-- The two seeded GOLF_TIERED ContestConfigTemplate presets
-- (golf-tiered-pick-6, golf-tiered-pick-12; 20260419213000) were seeded
-- before this epic's event-owns-tiers redesign. Their stored config_json
-- still carries tierSource/tierGeneration/tiers/cutRule/playoffHandling/
-- displayScoring/tiebreaker — all dropped from GolfTieredContestConfig now
-- (tiers are resolved via golf-tier-service.getEffectiveTiersForContest;
-- the other four were dead configuration with zero real reads downstream).
-- Trims both presets' stored JSON to the surviving { mode, maxEntriesPerSquad,
-- rosterSize, countedScores } shape so newly-created contests from these
-- templates don't carry stale fields forward. The third seeded preset
-- (golf-category-picks, GOLF_CATEGORY_PICKS) is untouched — deleting that
-- dead mode entirely is a separate epic story (pool-master-w3x).

UPDATE "contest_config_templates"
SET "config_json" = '{
  "mode": "GOLF_TIERED",
  "maxEntriesPerSquad": 1,
  "rosterSize": 6,
  "countedScores": 4
}'::jsonb
WHERE "template_key" = 'golf-tiered-pick-6' AND "config_mode" = 'GOLF_TIERED';

UPDATE "contest_config_templates"
SET "config_json" = '{
  "mode": "GOLF_TIERED",
  "maxEntriesPerSquad": 1,
  "rosterSize": 12,
  "countedScores": 8
}'::jsonb
WHERE "template_key" = 'golf-tiered-pick-12' AND "config_mode" = 'GOLF_TIERED';
