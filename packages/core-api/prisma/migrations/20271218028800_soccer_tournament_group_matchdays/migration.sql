-- #2167 part A: a soccer tournament is one competition holding its group matchdays and its
-- knockout rounds (Derek 2026-11-26), so no contest on it crosses competitions. The FIFA World
-- Cup, FIFA Women's World Cup, UEFA European Championship and Copa América each get three group
-- matchday slots (WEEK 1 to 3) in their tournament competition, played before its knockout
-- slots. Their matchday pick'em templates, which covered no slot, cover the matchdays one at a
-- time. Bracket, tiered, budget and survivor templates stay on the knockout slots, and so, for
-- now, do the sweepstakes: knockout round points number a contest's covered rounds, so a
-- sweepstake over the matchdays too needs that scoring to count knockout rounds only first. That,
-- and placing group games on their matchdays (provider mappings, Season slots, windows), follow
-- with the adapter's group-stage reads. Data only.
--
-- The leagues are found by URL segment, the competition by code and the templates by selection
-- type (each tournament's only pick'em is its two matchday templates), never by
-- name. A matchday is a match day like any other week of games: played head to head, a draw
-- allowed, in halves, as the Champions League's league-phase weeks are.

INSERT INTO "sport_league_competition_slots" ("sport_league_id", "sport_league_competition_id", "key", "slot_kind", "week_number", "name", "awards_trophy", "squares_eligible", "series_format", "series_games", "pairing", "match_format", "can_end_tied", "period_unit", "period_count", "updated_at")
SELECT l."id", c."id", 'MATCHDAY_' || m.week, 'WEEK', m.week, NULL, false, true, 'SINGLE_GAME', 1, 'FIXED', 'HEAD_TO_HEAD', true, 'HALF', 2, CURRENT_TIMESTAMP
FROM "sport_leagues" l
JOIN "sport_league_competitions" c ON c."sport_league_id" = l."id" AND c."code" = 'POSTSEASON'
CROSS JOIN (VALUES (1), (2), (3)) AS m(week)
WHERE l."url_segment" IN ('world-cup', 'womens-world-cup', 'euro', 'copa-america');

-- The matchday pick'em templates cover each matchday, one contest a matchday.
INSERT INTO "contest_config_template_slots" ("sport_league_id", "template_id", "sport_league_competition_slot_id")
SELECT t."sport_league_id", t."id", d."id"
FROM "sport_leagues" l
JOIN "contest_config_templates" t ON t."sport_league_id" = l."id" AND t."selection_type" = 'PICK_EM'
JOIN "sport_league_competition_slots" d ON d."sport_league_id" = l."id" AND d."slot_kind" = 'WEEK'
WHERE l."url_segment" IN ('world-cup', 'womens-world-cup', 'euro', 'copa-america');
