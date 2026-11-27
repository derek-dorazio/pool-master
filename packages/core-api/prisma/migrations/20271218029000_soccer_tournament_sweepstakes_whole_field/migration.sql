-- #2241: a soccer tournament's sweepstake is drawn from its whole field before the group stage
-- (Derek 2026-11-26), so the FIFA World Cup's, FIFA Women's World Cup's, UEFA European
-- Championship's and Copa América's random draw templates cover every slot of the tournament's
-- competition: its group matchdays as well as the knockout slots they already list. Knockout round
-- points score the knockout rounds only (`playsKnockoutRounds`), so each template's round values,
-- one per knockout round, are unchanged. Data only.
--
-- The leagues are found by URL segment and the templates by selection type, never by name.

INSERT INTO "contest_config_template_slots" ("sport_league_id", "template_id", "sport_league_competition_slot_id")
SELECT t."sport_league_id", t."id", d."id"
FROM "sport_leagues" l
JOIN "contest_config_templates" t ON t."sport_league_id" = l."id" AND t."selection_type" = 'RANDOM_DRAW'
JOIN "sport_league_competition_slots" d ON d."sport_league_id" = l."id" AND d."slot_kind" = 'WEEK'
WHERE l."url_segment" IN ('world-cup', 'womens-world-cup', 'euro', 'copa-america');
