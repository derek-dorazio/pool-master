-- #2225: a sweepstakes on NCAA Men's Football's bowl games. Knockout round points now score a slate
-- of one-off games (one round of a TOURNAMENT slot, no game leading to another), each game
-- its own final, so a dealt team's bowl win scores its one round value: 1. Not the league's
-- sweepstakes default: the College Football Playoff keeps it. Covers the bowls' one slot only, so
-- no contest crosses into the CFP. Data only.
--
-- The league is found by its URL segment and the slot by its definition key, never by name.

INSERT INTO "contest_config_templates" ("sport_league_id", "contest_type", "selection_type", "template_key", "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at", "coverage_mode")
SELECT l."id", 'ROSTER', 'RANDOM_DRAW', 'bowls-random-draw-straight-up',
  'Sweepstakes: 1 bowl team each, 1 point a win',
  'The bowl sweep: the draw deals each entry one bowl team at random. A bowl win scores 1 point.',
  17, false, true,
  '{"scoring": {"config": {"upsetBonus": {"rule": "NONE"}, "roundValues": [1]}, "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS"}, "countedScores": 1, "picksPerEntry": 1, "selectionType": "RANDOM_DRAW", "maxEntriesPerSquad": 1}',
  1, CURRENT_TIMESTAMP, 'ONE_SLOT'
FROM "sport_leagues" l
WHERE l."url_segment" = 'ncaamf';

INSERT INTO "contest_config_template_slots" ("sport_league_id", "template_id", "sport_league_competition_slot_id")
SELECT t."sport_league_id", t."id", d."id"
FROM "sport_leagues" l
JOIN "contest_config_templates" t ON t."sport_league_id" = l."id" AND t."template_key" = 'bowls-random-draw-straight-up'
JOIN "sport_league_competition_slots" d ON d."sport_league_id" = l."id" AND d."key" = 'BOWLS'
WHERE l."url_segment" = 'ncaamf';
