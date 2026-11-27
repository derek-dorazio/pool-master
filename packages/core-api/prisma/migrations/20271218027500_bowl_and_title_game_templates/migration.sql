-- League model slice 13b (#2154), part 3: contest templates on NCAA Men's Football's bowl games
-- and conference title games, each covering its own competition's one slot, so no contest crosses
-- into the College Football Playoff. Data only.
--
-- - Bowls: pick'em straight up and against the spread, squares on any one bowl game, and a
--   sweepstakes where a bowl win scores 1 point. No tiered or budget: those are for playoffs of 12
--   or more teams, and bowl teams have no seeds to tier or price by (Clutch Card's bowl cards,
--   #2030, wait on an odds or spread source).
-- - Conference title games: pick'em straight up and against the spread, and squares. Too few
--   teams for roster contests.
-- - The league's first pick'em, the bowls' straight up, is its pick'em default. The CFP keeps its
--   squares and sweepstakes defaults.
--
-- The league is found by its URL segment and the slots by their definition keys, never by name.

CREATE TEMP TABLE "_new_templates" (
  "slot_key" TEXT NOT NULL,
  "contest_type" "PrismaContestFormat" NOT NULL,
  "selection_type" "PrismaSelectionType" NOT NULL,
  "template_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "is_default" BOOLEAN NOT NULL,
  "coverage_mode" "PrismaTemplateCoverageMode" NOT NULL,
  "config_json" JSONB NOT NULL
);

INSERT INTO "_new_templates" VALUES
  ('BOWLS', 'PREDICTION', 'PICK_EM', 'bowls-pick-em-straight-up',
    'Pick’em: every bowl game, straight up',
    'Pick the winner of every bowl game. Each right pick scores a point.',
    11, true, 'ONE_SLOT',
    '{"mode": "STRAIGHT_UP", "selectionType": "PICK_EM", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('BOWLS', 'PREDICTION', 'PICK_EM', 'bowls-pick-em-against-the-spread',
    'Pick’em: every bowl game, against the spread',
    'Pick the team that covers the spread in every bowl game. A pick that covers scores a point; a push scores nothing.',
    12, false, 'ONE_SLOT',
    '{"mode": "STRAIGHT_UP", "selectionType": "PICK_EM", "againstTheSpread": true, "maxEntriesPerSquad": 1}'),
  ('BOWLS', 'SQUARES', 'SQUARES', 'bowls-squares',
    'Squares: 10 boxes each, every quarter',
    'A 10x10 grid on one bowl game: claim up to 10 boxes, then the digits are drawn. The box matching each team''s last digit wins each quarter and the final score.',
    13, false, 'ONE_SLOT',
    '{"selectionType": "SQUARES", "maxEntriesPerSquad": 1, "maxSquaresPerEntry": 10}'),
  ('BOWLS', 'ROSTER', 'RANDOM_DRAW', 'bowls-random-draw-straight-up',
    'Sweepstakes: 1 bowl team each, 1 point a win',
    'The bowl sweep: the draw deals each entry one bowl team at random. A bowl win scores 1 point.',
    14, false, 'ALL_LISTED',
    '{"scoring": {"config": {"upsetBonus": {"rule": "NONE"}, "roundValues": [1]}, "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS"}, "countedScores": 1, "picksPerEntry": 1, "selectionType": "RANDOM_DRAW", "maxEntriesPerSquad": 1}'),
  ('CONFERENCE_CHAMPIONSHIPS', 'PREDICTION', 'PICK_EM', 'conference-championships-pick-em-straight-up',
    'Pick’em: every title game, straight up',
    'Pick the winner of every conference title game. Each right pick scores a point.',
    15, false, 'ONE_SLOT',
    '{"mode": "STRAIGHT_UP", "selectionType": "PICK_EM", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('CONFERENCE_CHAMPIONSHIPS', 'PREDICTION', 'PICK_EM', 'conference-championships-pick-em-against-the-spread',
    'Pick’em: every title game, against the spread',
    'Pick the team that covers the spread in every conference title game. A pick that covers scores a point; a push scores nothing.',
    16, false, 'ONE_SLOT',
    '{"mode": "STRAIGHT_UP", "selectionType": "PICK_EM", "againstTheSpread": true, "maxEntriesPerSquad": 1}'),
  ('CONFERENCE_CHAMPIONSHIPS', 'SQUARES', 'SQUARES', 'conference-championships-squares',
    'Squares: 10 boxes each, every quarter',
    'A 10x10 grid on one conference title game: claim up to 10 boxes, then the digits are drawn. The box matching each team''s last digit wins each quarter and the final score.',
    17, false, 'ONE_SLOT',
    '{"selectionType": "SQUARES", "maxEntriesPerSquad": 1, "maxSquaresPerEntry": 10}');

INSERT INTO "contest_config_templates" ("sport_league_id", "contest_type", "selection_type", "template_key", "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at", "coverage_mode")
SELECT l."id", n."contest_type", n."selection_type", n."template_key", n."name", n."description", n."sort_order", n."is_default", true, n."config_json", 1, CURRENT_TIMESTAMP, n."coverage_mode"
FROM "_new_templates" n
JOIN "sport_leagues" l ON l."url_segment" = 'ncaamf';

INSERT INTO "contest_config_template_slots" ("sport_league_id", "template_id", "sport_league_competition_slot_id")
SELECT t."sport_league_id", t."id", d."id"
FROM "_new_templates" n
JOIN "sport_leagues" l ON l."url_segment" = 'ncaamf'
JOIN "contest_config_templates" t ON t."sport_league_id" = l."id" AND t."template_key" = n."template_key"
JOIN "sport_league_competition_slots" d ON d."sport_league_id" = l."id" AND d."key" = n."slot_key";

DROP TABLE "_new_templates";
