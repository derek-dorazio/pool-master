-- League model slice 9 (#2006): every round is played in one of its own event's slots. A one-slot
-- event's rounds all sit in that slot (a golf tournament's four, a week's one); an event with
-- several slots has a round per slot, numbered in the slots' play order (phase, competition, slot).
-- A round that cannot be placed so (an event with no slot, or with more rounds than its slots) is
-- deleted with its matches and their results, picks and squares games; QA's test data is reloaded
-- by the loader, and production has none.

-- The target of a round's composite key.
CREATE UNIQUE INDEX "sport_event_slots_event_id_key" ON "sport_event_slots"("sport_event_id", "id");

ALTER TABLE "sport_event_rounds" ADD COLUMN "sport_event_slot_id" UUID;

-- An event with one slot: every round in it.
UPDATE "sport_event_rounds" r
SET "sport_event_slot_id" = es."id"
FROM "sport_event_slots" es
WHERE es."sport_event_id" = r."sport_event_id"
  AND (SELECT count(*) FROM "sport_event_slots" o WHERE o."sport_event_id" = r."sport_event_id") = 1;

-- An event with several slots: round n in its nth slot in play order.
WITH ordered AS (
  SELECT es."id", es."sport_event_id",
    row_number() OVER (
      PARTITION BY es."sport_event_id"
      ORDER BY p."phase", c."order_index", d."slot_kind", d."week_number" NULLS FIRST, d."key"
    ) AS place
  FROM "sport_event_slots" es
  JOIN "sport_league_season_competition_slots" ss ON ss."id" = es."sport_league_season_competition_slot_id"
  JOIN "sport_league_competition_slots" d ON d."id" = ss."sport_league_competition_slot_id"
  JOIN "sport_league_competitions" c ON c."id" = d."sport_league_competition_id"
  JOIN "sport_league_phases" p ON p."id" = c."sport_league_phase_id"
  WHERE (SELECT count(*) FROM "sport_event_slots" o WHERE o."sport_event_id" = es."sport_event_id") > 1
)
UPDATE "sport_event_rounds" r
SET "sport_event_slot_id" = ordered."id"
FROM ordered
WHERE ordered."sport_event_id" = r."sport_event_id" AND ordered."place" = r."round_number";

-- The rounds left unplaced go, with everything played in them.
CREATE TEMPORARY TABLE "unplaced_matches" AS
SELECT m."id" FROM "sport_event_round_matches" m
JOIN "sport_event_rounds" r ON r."id" = m."sport_event_round_id"
WHERE r."sport_event_slot_id" IS NULL;
DELETE FROM "contest_entry_match_predictions" WHERE "sport_event_round_match_id" IN (SELECT "id" FROM "unplaced_matches");
DELETE FROM "contest_squares_games" WHERE "sport_event_round_match_id" IN (SELECT "id" FROM "unplaced_matches");
UPDATE "sport_event_round_matches" SET "advances_to_match_id" = NULL, "advances_to_side" = NULL
WHERE "advances_to_match_id" IN (SELECT "id" FROM "unplaced_matches");
DELETE FROM "sport_event_round_matches" WHERE "id" IN (SELECT "id" FROM "unplaced_matches");
DELETE FROM "sport_event_participant_golf_rounds" WHERE "participant_round_id" IN (
  SELECT pr."id" FROM "sport_event_participant_rounds" pr JOIN "sport_event_rounds" r ON r."id" = pr."sport_event_round_id" WHERE r."sport_event_slot_id" IS NULL);
DELETE FROM "sport_event_participant_rounds" WHERE "sport_event_round_id" IN (SELECT "id" FROM "sport_event_rounds" WHERE "sport_event_slot_id" IS NULL);
DELETE FROM "sport_event_rounds" WHERE "sport_event_slot_id" IS NULL;
DROP TABLE "unplaced_matches";

ALTER TABLE "sport_event_rounds" ALTER COLUMN "sport_event_slot_id" SET NOT NULL;
ALTER TABLE "sport_event_rounds" ADD CONSTRAINT "sport_event_rounds_event_slot_fkey"
  FOREIGN KEY ("sport_event_id", "sport_event_slot_id") REFERENCES "sport_event_slots"("sport_event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A round's name, series length and pairing are its slot's now, so the league's lists go.
ALTER TABLE "sport_leagues" DROP COLUMN "bracket_advancement",
  DROP COLUMN "round_names",
  DROP COLUMN "round_series_lengths";
DROP TYPE "PrismaBracketAdvancement";
