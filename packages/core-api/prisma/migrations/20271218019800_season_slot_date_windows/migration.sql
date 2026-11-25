-- League model slice 13 (#2012): a feed that names no round for its games (BALLDONTLIE's college
-- football) has them placed by a date window on each Season slot, held as data. The window is the
-- schedule's own dates for that Season, kept apart from the slot's `starts_at`/`ends_at`, which the
-- sync derives from the games it places there. A window is TENTATIVE while its dates are a best
-- guess (the shape is known, the games are not) and CONFIRMED once they are published.
CREATE TYPE "PrismaSlotWindowStatus" AS ENUM ('TENTATIVE', 'CONFIRMED');

ALTER TABLE "sport_league_season_phase_slots"
  ADD COLUMN "window_starts_at" TIMESTAMPTZ,
  ADD COLUMN "window_ends_at" TIMESTAMPTZ,
  ADD COLUMN "window_status" "PrismaSlotWindowStatus",
  ADD CONSTRAINT "sport_league_season_phase_slots_window" CHECK (
    ("window_starts_at" IS NULL) = ("window_ends_at" IS NULL)
    AND ("window_starts_at" IS NULL) = ("window_status" IS NULL)
    AND ("window_starts_at" IS NULL OR "window_ends_at" > "window_starts_at")
  );

-- A DATE_WINDOW mapping names no provider value either: the Season slot's window is what it matches.
ALTER TABLE "sport_league_phase_slot_provider_mappings"
  DROP CONSTRAINT "sport_league_phase_slot_provider_mappings_value",
  ADD CONSTRAINT "sport_league_phase_slot_provider_mappings_value"
    CHECK (("match_type" IN ('CALENDAR_WEEK', 'DATE_WINDOW')) = ("provider_value" IS NULL));

-- The College Football Playoff's four rounds are matched by date window on BALLDONTLIE.
INSERT INTO "sport_league_phase_slot_provider_mappings" ("sport_league_id", "sport_league_phase_slot_id", "sport_league_provider_mapping_id", "match_type", "provider_value", "updated_at")
SELECT sl."sport_league_id", sl."id", m."id", 'DATE_WINDOW', NULL, now()
FROM (VALUES ('ROUND_OF_16'), ('QUARTERFINAL'), ('SEMIFINAL'), ('FINAL')) AS v(slot_key)
JOIN "sport_league_phase_slots" sl ON sl."sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10' AND sl."key" = v.slot_key
JOIN "provider_leagues" pl ON pl."code" = 'ncaaf' AND pl."provider_id" = '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11'
JOIN "sport_league_provider_mappings" m ON m."sport_league_id" = sl."sport_league_id" AND m."provider_league_id" = pl."id";

-- Each round's dates (Derek, 2026-11-25), as US calendar days: from 10:00 UTC on the first day to
-- 12:00 UTC after the last, so every US kickoff on those days, Hawaii's included, is inside.
-- 2026-27: quarterfinals Dec 30 and Jan 1, semifinals Jan 14-15 and the final Jan 25 are
-- published; the on-campus first round, Dec 18-19, is a best guess. 2027-28: quarterfinals Dec 31
-- and Jan 1 and semifinals Jan 13-14 are published; its first round and final are not announced,
-- so those slots wait for their dates.
UPDATE "sport_league_season_phase_slots" AS s
SET "window_starts_at" = v.starts_at::timestamptz, "window_ends_at" = v.ends_at::timestamptz,
  "window_status" = v.status::"PrismaSlotWindowStatus", "updated_at" = now()
FROM (VALUES
  (2026, 'ROUND_OF_16', '2026-12-18T10:00:00Z', '2026-12-20T12:00:00Z', 'TENTATIVE'),
  (2026, 'QUARTERFINAL', '2026-12-30T10:00:00Z', '2027-01-02T12:00:00Z', 'CONFIRMED'),
  (2026, 'SEMIFINAL', '2027-01-14T10:00:00Z', '2027-01-16T12:00:00Z', 'CONFIRMED'),
  (2026, 'FINAL', '2027-01-25T10:00:00Z', '2027-01-26T12:00:00Z', 'CONFIRMED'),
  (2027, 'QUARTERFINAL', '2027-12-31T10:00:00Z', '2028-01-02T12:00:00Z', 'CONFIRMED'),
  (2027, 'SEMIFINAL', '2028-01-13T10:00:00Z', '2028-01-15T12:00:00Z', 'CONFIRMED')
) AS v(championship_year, slot_key, starts_at, ends_at, status),
  "sport_league_seasons" AS season,
  "sport_league_phase_slots" AS definition
WHERE season."sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10'
  AND season."championship_year" = v.championship_year
  AND definition."sport_league_id" = season."sport_league_id"
  AND definition."key" = v.slot_key
  AND s."sport_league_season_id" = season."id"
  AND s."sport_league_phase_slot_id" = definition."id"
  AND s."is_test_data" = false;
