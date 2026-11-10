-- A match's link to its provider game (#1496), on its event's own provider; null until linked.
ALTER TABLE "sport_event_matches" ADD COLUMN "external_game_id" VARCHAR(255);

-- One game links to at most one match of an event.
CREATE UNIQUE INDEX "sport_event_matches_sport_event_id_external_game_id_key" ON "sport_event_matches"("sport_event_id", "external_game_id");
