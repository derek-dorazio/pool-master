-- One round value for each bracket round a knockout template lists (#2177). Data only.
--
-- A template scored by knockout round points that covers all its listed slots gives one value per
-- listed slot, the third-place play-off aside (a match beside the bracket, no round of it). Slots
-- govern rounds: the final is the FINAL slot's round, and its value is the last one.
--
-- - The FIFA World Cup's knockout now starts at the Round of 32 (48 teams), five rounds, but its
--   templates kept four values from the 32-team format, so the final scored nothing. Escalating
--   doubles to 16 in the final; Straight up scores 1 a round.
-- - MLS and the Champions League already carried five values, their descriptions starting at the
--   wild card round and the knockout phase play-offs, but listed only the four rounds after it.
--   Their events play that PLAY_IN slot as round 1, so their templates list it too.
--
-- Leagues are found by their URL segment, a unique key; templates by their key within a league.

UPDATE "contest_config_templates" t
SET "config_json" = jsonb_set(t."config_json", '{scoring,config,roundValues}', '[1, 1, 1, 1, 1]'::jsonb),
    "updated_at" = CURRENT_TIMESTAMP
FROM "sport_leagues" l
WHERE l."id" = t."sport_league_id" AND l."url_segment" = 'world-cup'
  AND t."template_key" IN ('world-cup-random-draw-straight-up', 'world-cup-bracket-straight-up');

UPDATE "contest_config_templates" t
SET "config_json" = jsonb_set(t."config_json", '{scoring,config,roundValues}', '[1, 2, 4, 8, 16]'::jsonb),
    "description" = replace(t."description", 'A win scores 1 point in the Round of 16, doubling each round to 8 in the final.', 'A win scores 1 point in the Round of 32, doubling each round to 16 in the final.'),
    "updated_at" = CURRENT_TIMESTAMP
FROM "sport_leagues" l
WHERE l."id" = t."sport_league_id" AND l."url_segment" = 'world-cup'
  AND t."template_key" IN ('world-cup-tiered-pick-4', 'world-cup-budget-pick-4', 'world-cup-random-draw-doubling');

UPDATE "contest_config_templates" t
SET "config_json" = jsonb_set(t."config_json", '{scoring,config,roundValues}', '[1, 2, 4, 8, 16]'::jsonb),
    "description" = replace(t."description", 'A right pick scores 1 point in the Round of 16, doubling each round to 8 in the final.', 'A right pick scores 1 point in the Round of 32, doubling each round to 16 in the final.'),
    "updated_at" = CURRENT_TIMESTAMP
FROM "sport_leagues" l
WHERE l."id" = t."sport_league_id" AND l."url_segment" = 'world-cup'
  AND t."template_key" = 'world-cup-bracket-doubling';

-- MLS's and the Champions League's whole-bracket templates list the play-in round they score.
INSERT INTO "contest_config_template_slots" ("sport_league_id", "template_id", "sport_league_competition_slot_id")
SELECT t."sport_league_id", t."id", d."id"
FROM "contest_config_templates" t
JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
JOIN "sport_league_competition_slots" d ON d."sport_league_id" = t."sport_league_id" AND d."slot_kind" = 'PLAY_IN'
WHERE l."url_segment" IN ('mls', 'ucl')
  AND t."coverage_mode" = 'ALL_LISTED'
  AND t."config_json" -> 'scoring' ->> 'participantScoringDefinitionId' = 'KNOCKOUT_ROUND_POINTS'
  AND d."sport_league_competition_id" IN (
    SELECT listed."sport_league_competition_id"
    FROM "contest_config_template_slots" ts
    JOIN "sport_league_competition_slots" listed ON listed."id" = ts."sport_league_competition_slot_id"
    WHERE ts."template_id" = t."id"
  )
ON CONFLICT ("template_id", "sport_league_competition_slot_id") DO NOTHING;
