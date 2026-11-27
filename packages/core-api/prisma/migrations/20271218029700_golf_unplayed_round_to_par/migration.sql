-- #2008 (10b part 4c): an unplayed golf round scores a contest setting, `unplayedRoundToPar`,
-- in strokes over par, no longer 80 strokes against a par read off the course. Every stroke-play
-- league's templates now preset it (+8, the usual rule: an 80 on a par 72), the same value the
-- server gives a golf contest whose template has none, and every stored golf scoring rule is
-- given it. The
-- rule's config held no other live key (the retired cutRule/playoffHandling keys never changed a
-- score), so it is written whole. Data only.
--
-- Templates are found by their league's scoring family, never by name.

UPDATE "contest_config_templates" t
SET "config_json" = jsonb_set(
  t."config_json"::jsonb,
  '{scoring}',
  '{"participantScoringDefinitionId": "GOLF_RELATIVE_TO_PAR_TOTAL", "config": {"unplayedRoundToPar": 8}}'::jsonb
)
FROM "sport_leagues" l
WHERE l."id" = t."sport_league_id"
  AND l."scoring_family" = 'STROKE_PLAY'
  AND NOT (t."config_json"::jsonb ? 'scoring');

UPDATE "participant_contest_scoring_rules"
SET "config" = '{"unplayedRoundToPar": 8}'::jsonb
WHERE "participant_scoring_definition_id" = 'GOLF_RELATIVE_TO_PAR_TOTAL';
