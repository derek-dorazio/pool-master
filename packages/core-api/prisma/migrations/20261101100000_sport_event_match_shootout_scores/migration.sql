-- A knockout match level after extra time is settled by a shoot-out (#791): both sides' kicks
-- scored, or neither. The match score stays the score after extra time (IFAB Law 10).
ALTER TABLE "sport_event_matches" ADD COLUMN "home_shootout_score" INTEGER;
ALTER TABLE "sport_event_matches" ADD COLUMN "away_shootout_score" INTEGER;

ALTER TABLE "sport_event_matches"
  ADD CONSTRAINT "sport_event_matches_shootout_scores_check"
  CHECK (
    ("home_shootout_score" IS NULL AND "away_shootout_score" IS NULL)
    OR ("home_shootout_score" IS NOT NULL AND "away_shootout_score" IS NOT NULL
      AND "home_shootout_score" >= 0 AND "away_shootout_score" >= 0)
  );
