-- #787: the first round of a sport league whose matches are single games a squares pool can be
-- played on. Null takes every round. A Champions League two-legged tie, scored on aggregate, and
-- an MLS best-of-three series are each one bracket match with no half-time score.
ALTER TABLE "sport_leagues" ADD COLUMN "squares_from_round" INTEGER;
ALTER TABLE "sport_leagues" ADD CONSTRAINT "sport_leagues_squares_from_round_check"
  CHECK ("squares_from_round" IS NULL OR "squares_from_round" >= 1);

-- The Champions League's first four rounds are two-legged ties; only its final, round 5, is one
-- game. Reference data, as its round names are.
UPDATE "sport_leagues" l SET "squares_from_round" = 5
FROM "sports" s
WHERE l."sport_id" = s."id" AND s."sport" = 'SOCCER' AND l."name" = 'UEFA Champions League';

-- Its squares setup says so.
UPDATE "contest_config_templates" t
SET "description" = 'A 10x10 grid on the final: claim up to 10 boxes, then the digits are drawn. The box matching each team''s last digit wins at half time and on the final score.', "updated_at" = NOW()
WHERE t."sport" = 'SOCCER' AND t."template_key" = 'champions-league-squares';
