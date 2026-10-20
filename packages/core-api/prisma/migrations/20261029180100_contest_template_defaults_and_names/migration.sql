-- #802: every sport league starts each format on one default contest template, with a name and a
-- description written for Create contest. Names follow "<Format>: <how you pick>, <how it scores>",
-- the format named as Create contest names it; descriptions are one or two plain sentences.
--
-- 1. A match sport's templates say which kind of event they are for: the existing ones and the new
--    brackets and squares are for a KNOCKOUT, pick'em and survivor for a WEEK of a season's games.
-- 2. Every template is renamed and redescribed to the convention. Template keys stay, so a contest
--    made from one keeps its link.
-- 3. Budget and Random draw get a default of their own in every league (Tiered had the only one,
--    Budget in Formula 1). The default sorts ahead of its variations.
-- 4. New templates: brackets (full, full with the upset bonus, and second chance) for every knockout
--    league, NFL pick'em (straight up, confidence, against the spread) and survivor for its weeks,
--    College Football Playoff squares, and an LPGA Tour majors pool on the LPGA Tour, seeded here
--    as reference data like every other league.

-- 1. Kinds of event.
UPDATE "contest_config_templates"
SET "event_type" = 'KNOCKOUT', "updated_at" = NOW()
WHERE "sport" IN ('BASKETBALL', 'AMERICAN_FOOTBALL') AND "event_type" IS NULL;

-- 2. Names and descriptions.
UPDATE "contest_config_templates" t
SET "name" = v."name", "description" = v."description", "updated_at" = NOW()
FROM (VALUES
  ('golf-tiered-pick-6', 'Tiered: 1 golfer per tier, best 4 count', 'Pick one golfer from each tier of the field. Your best four golfers'' scores count.'),
  ('golf-tiered-pick-12', 'Tiered: 2 golfers per tier, best 8 count', 'Pick two golfers from each tier of the field. Your best eight golfers'' scores count.'),
  ('golf-budget-pick-6-best-4', 'Budget: 6 golfers under the cap, best 4 count', 'Every golfer has a price: pick six whose prices fit under the salary cap. Your best four golfers'' scores count.'),
  ('golf-budget-pick-6-all-count', 'Budget: 6 golfers under the cap, all count', 'Every golfer has a price: pick six whose prices fit under the salary cap. All six golfers'' scores count.'),
  ('golf-random-draw-1', 'Random draw: 1 golfer each', 'The classic sweepstake: nobody picks, and the draw deals each entry one golfer at random. Your golfer''s score is your score.'),
  ('golf-random-draw-3-best-2', 'Random draw: 3 golfers each, best 2 count', 'The draw deals each entry three golfers at random. Your best two golfers'' scores count.'),
  ('pga-tour-majors-tiered', 'Tiered majors pool: 1 golfer per tier, best 4 count', 'One contest across the Masters, the PGA Championship, the U.S. Open and The Open, picking one golfer from each tier at each. Your best four count; a missed major scores 80 a round.'),
  ('horse-racing-tiered-win-place-show', 'Tiered: 1 horse per tier, Win / Place / Show', 'Pick one horse from each tier of the field. Each horse scores Win / Place / Show points: 5 for first, 3 for second, 1 for third.'),
  ('horse-racing-budget-win-place-show', 'Budget: 3 horses under the cap, Win / Place / Show', 'Every horse has a price: pick three whose prices fit under the salary cap. Each scores 5 for first, 3 for second, 1 for third.'),
  ('horse-racing-random-draw-win-place-show', 'Random draw: 1 horse each, Win / Place / Show', 'The race sweep: the draw deals each entry one horse at random. It scores 5 for first, 3 for second, 1 for third.'),
  ('formula-1-tiered-points', 'Tiered: 1 driver per tier, F1 points', 'Pick one driver from each of the four tiers of the field. Each driver scores Formula 1 points, 25 for the win down to 1 for tenth.'),
  ('formula-1-budget-points', 'Budget: 5 drivers under the cap, F1 points', 'Every driver has a price: pick five whose prices fit under the salary cap. Each scores Formula 1 points, 25 for the win down to 1 for tenth.'),
  ('formula-1-random-draw-points', 'Random draw: 1 driver each, F1 points', 'The race sweep: the draw deals each entry one driver at random. It scores Formula 1 points, 25 for the win down to 1 for tenth.'),
  ('indycar-tiered-points', 'Tiered: 1 driver per tier, IndyCar points', 'Pick one driver from each of the five tiers of the field. Each driver scores IndyCar points, 50 for the win down to 5 for 25th and below.'),
  ('indycar-budget-points', 'Budget: 5 drivers under the cap, IndyCar points', 'Every driver has a price: pick five whose prices fit under the salary cap. Each scores IndyCar points, 50 for the win down to 5 for 25th and below.'),
  ('indycar-random-draw-points', 'Random draw: 1 driver each, IndyCar points', 'The race sweep: the draw deals each entry one driver at random. It scores IndyCar points, 50 for the win down to 5 for 25th and below.'),
  ('nascar-cup-tiered-points', 'Tiered: 1 driver per tier, NASCAR points', 'Pick one driver from each of the five tiers of the field. Each driver scores NASCAR Cup Series points, 40 for the win, 35 for second, then one fewer a place.'),
  ('nascar-cup-budget-points', 'Budget: 5 drivers under the cap, NASCAR points', 'Every driver has a price: pick five whose prices fit under the salary cap. Each scores NASCAR Cup Series points, 40 for the win, 35 for second, then one fewer a place.'),
  ('nascar-cup-random-draw-points', 'Random draw: 1 driver each, NASCAR points', 'The race sweep: the draw deals each entry one driver at random. It scores NASCAR Cup Series points, 40 for the win, 35 for second, then one fewer a place.'),
  ('uci-worldtour-tiered-top-10', 'Tiered: 1 rider per tier, Top 10 points', 'Pick one rider from each of the five tiers of the field. Each rider scores Top 10 points on the final overall classification, 10 for the winner down to 1 for tenth.'),
  ('uci-worldtour-budget-top-10', 'Budget: 5 riders under the cap, Top 10 points', 'Every rider has a price: pick five whose prices fit under the salary cap. Each scores Top 10 points on the final overall classification, 10 for the winner down to 1 for tenth.'),
  ('uci-worldtour-random-draw-top-10', 'Random draw: 1 rider each, Top 10 points', 'The race sweep: the draw deals each entry one rider at random. It scores Top 10 points on the final overall classification, 10 for the winner down to 1 for tenth.'),
  ('uci-womens-worldtour-tiered-top-10', 'Tiered: 1 rider per tier, Top 10 points', 'Pick one rider from each of the five tiers of the field. Each rider scores Top 10 points on the final overall classification, 10 for the winner down to 1 for tenth.'),
  ('uci-womens-worldtour-budget-top-10', 'Budget: 5 riders under the cap, Top 10 points', 'Every rider has a price: pick five whose prices fit under the salary cap. Each scores Top 10 points on the final overall classification, 10 for the winner down to 1 for tenth.'),
  ('uci-womens-worldtour-random-draw-top-10', 'Random draw: 1 rider each, Top 10 points', 'The race sweep: the draw deals each entry one rider at random. It scores Top 10 points on the final overall classification, 10 for the winner down to 1 for tenth.'),
  ('wmm-men-tiered-top-10', 'Tiered: 1 runner per tier, Top 10 points', 'Pick one runner from each of the four tiers of the field. Each runner scores Top 10 points on the official finishing order, 10 for the winner down to 1 for tenth.'),
  ('wmm-men-budget-top-10', 'Budget: 4 runners under the cap, Top 10 points', 'Every runner has a price: pick four whose prices fit under the salary cap. Each scores Top 10 points on the official finishing order, 10 for the winner down to 1 for tenth.'),
  ('wmm-men-random-draw-top-10', 'Random draw: 1 runner each, Top 10 points', 'The race sweep: the draw deals each entry one runner at random. It scores Top 10 points on the official finishing order, 10 for the winner down to 1 for tenth.'),
  ('wmm-women-tiered-top-10', 'Tiered: 1 runner per tier, Top 10 points', 'Pick one runner from each of the four tiers of the field. Each runner scores Top 10 points on the official finishing order, 10 for the winner down to 1 for tenth.'),
  ('wmm-women-budget-top-10', 'Budget: 4 runners under the cap, Top 10 points', 'Every runner has a price: pick four whose prices fit under the salary cap. Each scores Top 10 points on the official finishing order, 10 for the winner down to 1 for tenth.'),
  ('wmm-women-random-draw-top-10', 'Random draw: 1 runner each, Top 10 points', 'The race sweep: the draw deals each entry one runner at random. It scores Top 10 points on the official finishing order, 10 for the winner down to 1 for tenth.'),
  ('ncaa-men-tiered-doubling', 'Tiered: 1 team per tier, doubling points', 'Pick one team from each of the four tiers. A win scores 1 point in the First Round, doubling each round to 32 for the title game.'),
  ('ncaa-men-budget-doubling', 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap. A win scores 1 point in the First Round, doubling each round to 32 for the title game.'),
  ('ncaa-men-random-draw-doubling', 'Random draw: 1 team each, doubling points', 'The playoff sweep: the draw deals each entry one team at random. A win scores 1 point in the First Round, doubling each round to 32 for the title game.'),
  ('ncaa-men-tiered-doubling-upset-bonus', 'Tiered: 1 team per tier, doubling + upset bonus', 'Pick one team from each of the four tiers. A win scores 1 point in the First Round, doubling each round to 32 for the title game, plus the seed difference for an upset.'),
  ('ncaa-men-budget-doubling-upset-bonus', 'Budget: 4 teams under the cap, doubling + upset bonus', 'Every team has a price: pick four whose prices fit under the salary cap. A win scores 1 point in the First Round, doubling each round to 32 for the title game, plus the seed difference for an upset.'),
  ('ncaa-men-random-draw-doubling-upset-bonus', 'Random draw: 1 team each, doubling + upset bonus', 'The playoff sweep: the draw deals each entry one team at random. A win scores 1 point in the First Round, doubling each round to 32 for the title game, plus the seed difference for an upset.'),
  ('ncaa-women-tiered-doubling', 'Tiered: 1 team per tier, doubling points', 'Pick one team from each of the four tiers. A win scores 1 point in the First Round, doubling each round to 32 for the title game.'),
  ('ncaa-women-budget-doubling', 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap. A win scores 1 point in the First Round, doubling each round to 32 for the title game.'),
  ('ncaa-women-random-draw-doubling', 'Random draw: 1 team each, doubling points', 'The playoff sweep: the draw deals each entry one team at random. A win scores 1 point in the First Round, doubling each round to 32 for the title game.'),
  ('ncaa-women-tiered-doubling-upset-bonus', 'Tiered: 1 team per tier, doubling + upset bonus', 'Pick one team from each of the four tiers. A win scores 1 point in the First Round, doubling each round to 32 for the title game, plus the seed difference for an upset.'),
  ('ncaa-women-budget-doubling-upset-bonus', 'Budget: 4 teams under the cap, doubling + upset bonus', 'Every team has a price: pick four whose prices fit under the salary cap. A win scores 1 point in the First Round, doubling each round to 32 for the title game, plus the seed difference for an upset.'),
  ('ncaa-women-random-draw-doubling-upset-bonus', 'Random draw: 1 team each, doubling + upset bonus', 'The playoff sweep: the draw deals each entry one team at random. A win scores 1 point in the First Round, doubling each round to 32 for the title game, plus the seed difference for an upset.'),
  ('nba-tiered-doubling', 'Tiered: 1 team per tier, doubling points', 'Pick one team from each of the four tiers. A series win scores 1 point in the First Round, doubling each round to 8 in the NBA Finals.'),
  ('nba-budget-doubling', 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap. A series win scores 1 point in the First Round, doubling each round to 8 in the NBA Finals.'),
  ('nba-random-draw-doubling', 'Random draw: 1 team each, doubling points', 'The playoff sweep: the draw deals each entry one team at random. A series win scores 1 point in the First Round, doubling each round to 8 in the NBA Finals.'),
  ('nba-tiered-doubling-upset-bonus', 'Tiered: 1 team per tier, doubling + upset bonus', 'Pick one team from each of the four tiers. A series win scores 1 point in the First Round, doubling each round to 8 in the NBA Finals, plus the seed difference for an upset.'),
  ('nba-budget-doubling-upset-bonus', 'Budget: 4 teams under the cap, doubling + upset bonus', 'Every team has a price: pick four whose prices fit under the salary cap. A series win scores 1 point in the First Round, doubling each round to 8 in the NBA Finals, plus the seed difference for an upset.'),
  ('nba-random-draw-doubling-upset-bonus', 'Random draw: 1 team each, doubling + upset bonus', 'The playoff sweep: the draw deals each entry one team at random. A series win scores 1 point in the First Round, doubling each round to 8 in the NBA Finals, plus the seed difference for an upset.'),
  ('wnba-tiered-doubling', 'Tiered: 1 team per tier, doubling points', 'Pick one team from each of the four tiers. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals.'),
  ('wnba-budget-doubling', 'Budget: 3 teams under the cap, doubling points', 'Every team has a price: pick three whose prices fit under the salary cap. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals.'),
  ('wnba-random-draw-doubling', 'Random draw: 1 team each, doubling points', 'The playoff sweep: the draw deals each entry one team at random. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals.'),
  ('wnba-tiered-doubling-upset-bonus', 'Tiered: 1 team per tier, doubling + upset bonus', 'Pick one team from each of the four tiers. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals, plus the seed difference for an upset.'),
  ('wnba-budget-doubling-upset-bonus', 'Budget: 3 teams under the cap, doubling + upset bonus', 'Every team has a price: pick three whose prices fit under the salary cap. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals, plus the seed difference for an upset.'),
  ('wnba-random-draw-doubling-upset-bonus', 'Random draw: 1 team each, doubling + upset bonus', 'The playoff sweep: the draw deals each entry one team at random. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals, plus the seed difference for an upset.'),
  ('nfl-tiered-doubling', 'Tiered: 1 team per tier, doubling points', 'Pick one team from each of the seven tiers. A win scores 1 point on Wild Card weekend, doubling each round to 8 for the Super Bowl.'),
  ('nfl-budget-doubling', 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap. A win scores 1 point on Wild Card weekend, doubling each round to 8 for the Super Bowl.'),
  ('nfl-random-draw-doubling', 'Random draw: 1 team each, doubling points', 'The playoff sweep: the draw deals each entry one team at random. A win scores 1 point on Wild Card weekend, doubling each round to 8 for the Super Bowl.'),
  ('nfl-tiered-doubling-upset-bonus', 'Tiered: 1 team per tier, doubling + upset bonus', 'Pick one team from each of the seven tiers. A win scores 1 point on Wild Card weekend, doubling each round to 8 for the Super Bowl, plus the seed difference for an upset.'),
  ('nfl-budget-doubling-upset-bonus', 'Budget: 4 teams under the cap, doubling + upset bonus', 'Every team has a price: pick four whose prices fit under the salary cap. A win scores 1 point on Wild Card weekend, doubling each round to 8 for the Super Bowl, plus the seed difference for an upset.'),
  ('nfl-random-draw-doubling-upset-bonus', 'Random draw: 1 team each, doubling + upset bonus', 'The playoff sweep: the draw deals each entry one team at random. A win scores 1 point on Wild Card weekend, doubling each round to 8 for the Super Bowl, plus the seed difference for an upset.'),
  ('cfp-tiered-doubling', 'Tiered: 1 team per tier, doubling points', 'Pick one team from each of the six tiers. A win scores 1 point in the First Round, doubling each round to 8 for the National Championship.'),
  ('cfp-budget-doubling', 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap. A win scores 1 point in the First Round, doubling each round to 8 for the National Championship.'),
  ('cfp-random-draw-doubling', 'Random draw: 1 team each, doubling points', 'The playoff sweep: the draw deals each entry one team at random. A win scores 1 point in the First Round, doubling each round to 8 for the National Championship.'),
  ('cfp-tiered-doubling-upset-bonus', 'Tiered: 1 team per tier, doubling + upset bonus', 'Pick one team from each of the six tiers. A win scores 1 point in the First Round, doubling each round to 8 for the National Championship, plus the seed difference for an upset.'),
  ('cfp-budget-doubling-upset-bonus', 'Budget: 4 teams under the cap, doubling + upset bonus', 'Every team has a price: pick four whose prices fit under the salary cap. A win scores 1 point in the First Round, doubling each round to 8 for the National Championship, plus the seed difference for an upset.'),
  ('cfp-random-draw-doubling-upset-bonus', 'Random draw: 1 team each, doubling + upset bonus', 'The playoff sweep: the draw deals each entry one team at random. A win scores 1 point in the First Round, doubling each round to 8 for the National Championship, plus the seed difference for an upset.'),
  ('nfl-squares', 'Squares: 10 boxes each, every quarter', 'A 10x10 grid on one game: claim up to 10 boxes, then the digits are drawn. The box matching each team''s last digit wins each quarter and the final score.')
) AS v("template_key", "name", "description")
WHERE t."template_key" = v."template_key";

-- 3. A default for every format, ahead of its variations. Golf's budget default, best four of six,
-- moves ahead of all six counting.
UPDATE "contest_config_templates"
SET "is_default" = TRUE, "updated_at" = NOW()
WHERE "template_key" IN (
  'golf-budget-pick-6-best-4',
  'golf-random-draw-1',
  'horse-racing-budget-win-place-show',
  'horse-racing-random-draw-win-place-show',
  'formula-1-tiered-points',
  'formula-1-random-draw-points',
  'indycar-budget-points',
  'indycar-random-draw-points',
  'nascar-cup-budget-points',
  'nascar-cup-random-draw-points',
  'uci-worldtour-budget-top-10',
  'uci-worldtour-random-draw-top-10',
  'uci-womens-worldtour-budget-top-10',
  'uci-womens-worldtour-random-draw-top-10',
  'wmm-men-budget-top-10',
  'wmm-men-random-draw-top-10',
  'wmm-women-budget-top-10',
  'wmm-women-random-draw-top-10',
  'ncaa-men-budget-doubling',
  'ncaa-men-random-draw-doubling',
  'ncaa-women-budget-doubling',
  'ncaa-women-random-draw-doubling',
  'nba-budget-doubling',
  'nba-random-draw-doubling',
  'wnba-budget-doubling',
  'wnba-random-draw-doubling',
  'nfl-budget-doubling',
  'nfl-random-draw-doubling',
  'cfp-budget-doubling',
  'cfp-random-draw-doubling'
);

UPDATE "contest_config_templates" SET "sort_order" = 3, "updated_at" = NOW() WHERE "template_key" = 'golf-budget-pick-6-best-4';
UPDATE "contest_config_templates" SET "sort_order" = 4, "updated_at" = NOW() WHERE "template_key" = 'golf-budget-pick-6-all-count';

-- 4a. Brackets for every knockout league, scored by the round values (and upset bonus) of the
-- league's matching tiered template. A second-chance bracket starts at a later round and is offered
-- once the event is under way.
INSERT INTO "contest_config_templates" (
  "id", "sport", "sport_league_id", "event_type", "contest_type", "selection_type", "template_key",
  "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at"
)
SELECT
  gen_random_uuid(), t."sport", t."sport_league_id", 'KNOCKOUT', 'PREDICTION', 'BRACKET', v."template_key",
  v."name", v."description", v."sort_order", v."is_default", TRUE,
  jsonb_build_object('selectionType', 'BRACKET', 'startsAtRound', v."starts_at_round", 'maxEntriesPerSquad', 1, 'scoring', t."config_json" -> 'scoring'),
  1, NOW()
FROM (VALUES
  ('ncaa-men-tiered-doubling', 'ncaa-men-bracket-doubling', 'Bracket: full bracket, doubling points', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point in the First Round, doubling each round to 32 for the title game.', 1, 7, TRUE),
  ('ncaa-men-tiered-doubling-upset-bonus', 'ncaa-men-bracket-doubling-upset-bonus', 'Bracket: full bracket, doubling + upset bonus', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point in the First Round, doubling each round to 32 for the title game, plus the seed difference for an upset.', 1, 8, FALSE),
  ('ncaa-men-tiered-doubling', 'ncaa-men-bracket-second-chance-doubling', 'Bracket: second chance, doubling points', 'A fresh bracket once the first games are played: pick every game from the Sweet 16 on. A right pick scores its round''s points, doubling each round.', 3, 9, FALSE),
  ('ncaa-women-tiered-doubling', 'ncaa-women-bracket-doubling', 'Bracket: full bracket, doubling points', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point in the First Round, doubling each round to 32 for the title game.', 1, 7, TRUE),
  ('ncaa-women-tiered-doubling-upset-bonus', 'ncaa-women-bracket-doubling-upset-bonus', 'Bracket: full bracket, doubling + upset bonus', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point in the First Round, doubling each round to 32 for the title game, plus the seed difference for an upset.', 1, 8, FALSE),
  ('ncaa-women-tiered-doubling', 'ncaa-women-bracket-second-chance-doubling', 'Bracket: second chance, doubling points', 'A fresh bracket once the first games are played: pick every game from the Sweet 16 on. A right pick scores its round''s points, doubling each round.', 3, 9, FALSE),
  ('nba-tiered-doubling', 'nba-bracket-doubling', 'Bracket: full bracket, doubling points', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point in the First Round, doubling each round to 8 in the NBA Finals.', 1, 7, TRUE),
  ('nba-tiered-doubling-upset-bonus', 'nba-bracket-doubling-upset-bonus', 'Bracket: full bracket, doubling + upset bonus', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point in the First Round, doubling each round to 8 in the NBA Finals, plus the seed difference for an upset.', 1, 8, FALSE),
  ('nba-tiered-doubling', 'nba-bracket-second-chance-doubling', 'Bracket: second chance, doubling points', 'A fresh bracket once the first games are played: pick every game from the Conference Semifinals on. A right pick scores its round''s points, doubling each round.', 2, 9, FALSE),
  ('wnba-tiered-doubling', 'wnba-bracket-doubling', 'Bracket: full bracket, doubling points', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals.', 1, 7, TRUE),
  ('wnba-tiered-doubling-upset-bonus', 'wnba-bracket-doubling-upset-bonus', 'Bracket: full bracket, doubling + upset bonus', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals, plus the seed difference for an upset.', 1, 8, FALSE),
  ('wnba-tiered-doubling', 'wnba-bracket-second-chance-doubling', 'Bracket: second chance, doubling points', 'A fresh bracket once the first games are played: pick every game from the Semifinals on. A right pick scores its round''s points, doubling each round.', 2, 9, FALSE),
  ('nfl-tiered-doubling', 'nfl-bracket-doubling', 'Bracket: full bracket, doubling points', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point on Wild Card weekend, doubling each round to 8 for the Super Bowl.', 1, 7, TRUE),
  ('nfl-tiered-doubling-upset-bonus', 'nfl-bracket-doubling-upset-bonus', 'Bracket: full bracket, doubling + upset bonus', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point on Wild Card weekend, doubling each round to 8 for the Super Bowl, plus the seed difference for an upset.', 1, 8, FALSE),
  ('nfl-tiered-doubling', 'nfl-bracket-second-chance-doubling', 'Bracket: second chance, doubling points', 'A fresh bracket once the first games are played: pick every game from the Divisional round on. A right pick scores its round''s points, doubling each round.', 2, 9, FALSE),
  ('cfp-tiered-doubling', 'cfp-bracket-doubling', 'Bracket: full bracket, doubling points', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point in the First Round, doubling each round to 8 for the National Championship.', 1, 7, TRUE),
  ('cfp-tiered-doubling-upset-bonus', 'cfp-bracket-doubling-upset-bonus', 'Bracket: full bracket, doubling + upset bonus', 'Pick the winner of every game to the final before the first one starts. A right pick scores 1 point in the First Round, doubling each round to 8 for the National Championship, plus the seed difference for an upset.', 1, 8, FALSE),
  ('cfp-tiered-doubling', 'cfp-bracket-second-chance-doubling', 'Bracket: second chance, doubling points', 'A fresh bracket once the first games are played: pick every game from the Quarterfinals on. A right pick scores its round''s points, doubling each round.', 2, 9, FALSE)
) AS v("from_key", "template_key", "name", "description", "starts_at_round", "sort_order", "is_default")
JOIN "contest_config_templates" t ON t."template_key" = v."from_key"
ON CONFLICT ("sport", "event_type", "contest_type", "selection_type", "template_key") DO NOTHING;

-- 4b. Pick'em and survivor for the NFL's regular-season weeks. Both score by their own rules, so they
-- carry no scoring definition.
INSERT INTO "contest_config_templates" (
  "id", "sport", "sport_league_id", "event_type", "contest_type", "selection_type", "template_key",
  "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at"
)
SELECT
  gen_random_uuid(), 'AMERICAN_FOOTBALL', l."id", 'WEEK', 'PREDICTION', v."selection_type"::"PrismaSelectionType", v."template_key",
  v."name", v."description", v."sort_order", v."is_default", TRUE, v."config_json"::jsonb, 1, NOW()
FROM (VALUES
  ('nfl-pick-em-straight-up', 'PICK_EM', 'Pick’em: every game, straight up', 'Pick the winner of every game each week. Each right pick scores a point.', 1, TRUE, '{"selectionType": "PICK_EM", "mode": "STRAIGHT_UP", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('nfl-pick-em-confidence', 'PICK_EM', 'Pick’em: every game, confidence points', 'Pick the winner of every game, then rank your picks by confidence. A right pick scores the value you gave it.', 2, FALSE, '{"selectionType": "PICK_EM", "mode": "CONFIDENCE", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('nfl-pick-em-against-the-spread', 'PICK_EM', 'Pick’em: every game, against the spread', 'Pick the team that covers the spread in every game. A pick that covers scores a point; a push scores nothing.', 3, FALSE, '{"selectionType": "PICK_EM", "mode": "STRAIGHT_UP", "againstTheSpread": true, "maxEntriesPerSquad": 1}'),
  ('nfl-survivor', 'SURVIVOR', 'Survivor: 1 team a week, each team once', 'Pick one team to win each week, never the same team twice. A loss puts the entry out; the last ones standing win.', 4, TRUE, '{"selectionType": "SURVIVOR", "maxEntriesPerSquad": 1}')
) AS v("template_key", "selection_type", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'AMERICAN_FOOTBALL'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = 'NFL'
ON CONFLICT ("sport", "event_type", "contest_type", "selection_type", "template_key") DO NOTHING;

-- 4c. College Football Playoff squares, as the NFL's: the national championship is its last game.
INSERT INTO "contest_config_templates" (
  "id", "sport", "sport_league_id", "event_type", "contest_type", "selection_type", "template_key",
  "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at"
)
SELECT
  gen_random_uuid(), 'AMERICAN_FOOTBALL', l."id", 'KNOCKOUT', 'SQUARES', 'SQUARES', 'cfp-squares',
  'Squares: 10 boxes each, every quarter', 'A 10x10 grid on one game: claim up to 10 boxes, then the digits are drawn. The box matching each team''s last digit wins each quarter and the final score.', 10, TRUE, TRUE,
  '{ "selectionType": "SQUARES", "maxSquaresPerEntry": 10, "maxEntriesPerSquad": 1 }'::jsonb, 1, NOW()
FROM "sport_leagues" l
JOIN "sports" s ON s."id" = l."sport_id"
WHERE s."sport" = 'AMERICAN_FOOTBALL' AND l."name" = 'College Football Playoff'
ON CONFLICT ("sport", "event_type", "contest_type", "selection_type", "template_key") DO NOTHING;

-- 4d. The LPGA Tour, and its majors pool on its five majors, as the PGA TOUR's (#714). The sport data
-- loader finds the league by name, so a site that already loaded it keeps its row.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", 'LPGA Tour', TRUE, NOW(), NOW()
FROM "sports" s
WHERE s."sport" = 'GOLF'
ON CONFLICT ("sport_id", "name") DO NOTHING;

INSERT INTO "contest_config_templates" (
  "id", "sport", "sport_league_id", "event_type", "contest_type", "selection_type", "template_key",
  "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "event_series_names", "updated_at"
)
SELECT
  gen_random_uuid(), 'GOLF', l."id", NULL, 'ROSTER', 'TIERED', 'lpga-tour-majors-tiered',
  'Tiered majors pool: 1 golfer per tier, best 4 count', 'One contest across the LPGA Tour''s five majors, picking one golfer from each tier at each. Your best four count; a missed major scores 80 a round.', 10, FALSE, TRUE,
  '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1 }'::jsonb, 1,
  ARRAY['The Chevron Championship', 'U.S. Women''s Open', 'KPMG Women''s PGA Championship', 'The Amundi Evian Championship', 'AIG Women''s Open'],
  NOW()
FROM "sport_leagues" l
JOIN "sports" s ON s."id" = l."sport_id"
WHERE s."sport" = 'GOLF' AND l."name" = 'LPGA Tour'
  AND NOT EXISTS (SELECT 1 FROM "contest_config_templates" t WHERE t."template_key" = 'lpga-tour-majors-tiered');

