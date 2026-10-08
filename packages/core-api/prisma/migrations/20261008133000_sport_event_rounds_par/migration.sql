-- #478: par for every round of an event, which contest scoring uses to turn an
-- unplayed round's fixed 80 strokes into to-par. Null on every existing event:
-- scoring then derives each round's par from the field's finished rounds.
ALTER TABLE "sport_events" ADD COLUMN "rounds_par" INTEGER;
