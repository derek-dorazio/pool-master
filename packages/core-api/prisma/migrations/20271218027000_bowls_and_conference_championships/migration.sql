-- League model slice 13b (#2154): NCAA Men's Football's bowl games and conference title games.
-- POSTSEASON gains a BOWLS competition before the CFP, and a new POSTSEASON_CONFERENCE phase holds
-- one CONFERENCE_CHAMPIONSHIPS competition (no conference: every conference's title game). Each
-- has one TOURNAMENT slot of single games, matched on BALLDONTLIE by REST_OF_PHASE: every game in
-- its Season window that no other slot places. Rows are found by league id, phase, competition
-- code and slot key, never by name.

-- A REST_OF_PHASE mapping names no provider value either: the Season slot's window is what it matches.
ALTER TABLE "sport_league_competition_slot_provider_mappings"
  DROP CONSTRAINT "competition_slot_provider_mappings_value",
  ADD CONSTRAINT "competition_slot_provider_mappings_value"
    CHECK (("match_type" IN ('CALENDAR_WEEK', 'DATE_WINDOW', 'REST_OF_PHASE')) = ("provider_value" IS NULL));

-- The phase, synced.
INSERT INTO "sport_league_phases" ("sport_league_id", "phase", "is_synced", "updated_at")
VALUES ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'POSTSEASON_CONFERENCE', true, now());

-- The bowls come before the CFP in the postseason's order.
UPDATE "sport_league_competitions" SET "order_index" = 2, "updated_at" = now()
WHERE "sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10' AND "code" = 'CFP';

INSERT INTO "sport_league_competitions" ("sport_league_id", "sport_league_phase_id", "code", "order_index", "updated_at")
SELECT p."sport_league_id", p."id", v.code, 1, now()
FROM (VALUES ('POSTSEASON', 'BOWLS'), ('POSTSEASON_CONFERENCE', 'CONFERENCE_CHAMPIONSHIPS')) AS v(phase, code)
JOIN "sport_league_phases" p ON p."sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10' AND p."phase" = v.phase::"PrismaLeaguePhase";

-- One slot each: single games with quarter scores, so squares can be played on any one of them.
INSERT INTO "sport_league_competition_slots" (
  "sport_league_id", "sport_league_competition_id", "key", "slot_kind", "week_number", "name", "awards_trophy",
  "squares_eligible", "series_format", "series_games", "pairing", "match_format", "can_end_tied", "period_unit", "period_count", "updated_at"
)
SELECT c."sport_league_id", c."id", v.slot_key, 'TOURNAMENT', NULL, v.name, false,
  true, 'SINGLE_GAME', 1, 'FIXED', 'HEAD_TO_HEAD', false, 'QUARTER', 4, now()
FROM (VALUES ('BOWLS', 'BOWLS', 'Bowl Games'), ('CONFERENCE_CHAMPIONSHIPS', 'CONFERENCE_CHAMPIONSHIPS', 'Conference Championships')) AS v(code, slot_key, name)
JOIN "sport_league_competitions" c ON c."sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10' AND c."code" = v.code;

-- Matched on BALLDONTLIE by the games of their windows no other slot places.
INSERT INTO "sport_league_competition_slot_provider_mappings" ("sport_league_id", "sport_league_competition_slot_id", "sport_league_provider_mapping_id", "match_type", "provider_value", "updated_at")
SELECT sl."sport_league_id", sl."id", m."id", 'REST_OF_PHASE', NULL, now()
FROM "sport_league_competition_slots" sl
JOIN "provider_leagues" pl ON pl."code" = 'ncaaf' AND pl."provider_id" = '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11'
JOIN "sport_league_provider_mappings" m ON m."sport_league_id" = sl."sport_league_id" AND m."provider_league_id" = pl."id"
WHERE sl."sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10' AND sl."key" IN ('BOWLS', 'CONFERENCE_CHAMPIONSHIPS');

-- Every Season has the new phase and both competitions, as every Season has every phase and competition (#2153).
INSERT INTO "sport_league_season_phases" ("sport_league_id", "sport_league_season_id", "sport_league_phase_id", "updated_at")
SELECT s."sport_league_id", s."id", p."id", now()
FROM "sport_league_seasons" s
JOIN "sport_league_phases" p ON p."sport_league_id" = s."sport_league_id" AND p."phase" = 'POSTSEASON_CONFERENCE'
WHERE s."sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10';

INSERT INTO "sport_league_season_competitions" ("sport_league_id", "sport_league_season_id", "sport_league_phase_id", "sport_league_competition_id", "updated_at")
SELECT sp."sport_league_id", sp."sport_league_season_id", sp."sport_league_phase_id", c."id", now()
FROM "sport_league_season_phases" sp
JOIN "sport_league_competitions" c ON c."sport_league_phase_id" = sp."sport_league_phase_id"
WHERE sp."sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10' AND c."code" IN ('BOWLS', 'CONFERENCE_CHAMPIONSHIPS');

-- Each Season's slot of each, copying its definition's series format.
INSERT INTO "sport_league_season_competition_slots" (
  "sport_league_id", "sport_league_season_id", "sport_league_season_competition_id", "sport_league_competition_slot_id",
  "series_format", "series_games", "pairing", "updated_at"
)
SELECT sc."sport_league_id", sc."sport_league_season_id", sc."id", d."id", d."series_format", d."series_games", d."pairing", now()
FROM "sport_league_season_competitions" sc
JOIN "sport_league_competitions" c ON c."id" = sc."sport_league_competition_id"
JOIN "sport_league_competition_slots" d ON d."sport_league_competition_id" = c."id"
WHERE sc."sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10' AND c."code" IN ('BOWLS', 'CONFERENCE_CHAMPIONSHIPS');

-- 2026-27's windows, best guesses until the feed places a game in them, as US calendar days from
-- 10:00 UTC on the first day to 12:00 UTC after the last (as the CFP's, #2012). The title games are
-- Friday December 4 and Saturday December 5. The bowls' window is the postseason's span, from the
-- Sunday after Army-Navy (a regular-season game on December 12) to the day after the CFP final:
-- the CFP's own slots place its games first, so the bowls take only the rest.
UPDATE "sport_league_season_competition_slots" AS s
SET "window_starts_at" = v.starts_at::timestamptz, "window_ends_at" = v.ends_at::timestamptz,
  "window_status" = 'TENTATIVE', "updated_at" = now()
FROM (VALUES
  ('CONFERENCE_CHAMPIONSHIPS', '2026-12-04T10:00:00Z', '2026-12-06T12:00:00Z'),
  ('BOWLS', '2026-12-13T10:00:00Z', '2027-01-26T12:00:00Z')
) AS v(slot_key, starts_at, ends_at),
  "sport_league_seasons" AS season,
  "sport_league_competition_slots" AS definition
WHERE season."sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10'
  AND season."championship_year" = 2026
  AND definition."sport_league_id" = season."sport_league_id"
  AND definition."key" = v.slot_key
  AND s."sport_league_season_id" = season."id"
  AND s."sport_league_competition_slot_id" = definition."id"
  AND s."is_test_data" = false;
