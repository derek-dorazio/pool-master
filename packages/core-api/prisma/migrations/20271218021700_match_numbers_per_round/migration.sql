-- League model slice 9b (#2161): a match is numbered within its round, not across its event. Every
-- existing match is renumbered 1, 2, 3… within its round in the order its event-wide number gave,
-- so a bracket keeps its draw order and a week its kickoff order. Links between matches are ids,
-- so no link changes.

DROP INDEX "sport_event_round_matches_sport_event_id_match_number_key";
DROP INDEX "sport_event_round_matches_sport_event_round_id_idx";

WITH renumbered AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "sport_event_round_id"
    ORDER BY "match_number"
  ) AS "number"
  FROM "sport_event_round_matches"
)
UPDATE "sport_event_round_matches" m
SET "match_number" = renumbered."number"
FROM renumbered
WHERE renumbered."id" = m."id";

CREATE UNIQUE INDEX "sport_event_round_matches_sport_event_round_id_match_number_key"
  ON "sport_event_round_matches"("sport_event_round_id", "match_number");
