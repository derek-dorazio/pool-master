-- #709: a field row that stands for a play-in pairing ("Texas / Xavier") is marked as a play-in
-- place, and only such a row can be filled with the play-in winner. Filling clears the mark: the
-- row then names a real team. Existing rows are not play-in places.
ALTER TABLE "sport_event_participants" ADD COLUMN "is_play_in_place" BOOLEAN NOT NULL DEFAULT false;
