-- The score at the end of each period of a game but the last (#772): squares pools read it (#711).
-- The final score, overtime included, stays the match's own result.
CREATE TABLE "sport_event_match_period_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_match_id" UUID NOT NULL,
    "period_number" INTEGER NOT NULL,
    "home_score" INTEGER NOT NULL,
    "away_score" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_match_period_scores_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sport_event_match_period_scores_period_number_check" CHECK ("period_number" >= 1),
    CONSTRAINT "sport_event_match_period_scores_scores_check" CHECK ("home_score" >= 0 AND "away_score" >= 0)
);

CREATE UNIQUE INDEX "sport_event_match_period_scores_sport_event_match_id_period_key"
  ON "sport_event_match_period_scores"("sport_event_match_id", "period_number");

ALTER TABLE "sport_event_match_period_scores"
  ADD CONSTRAINT "sport_event_match_period_scores_sport_event_match_id_fkey"
  FOREIGN KEY ("sport_event_match_id") REFERENCES "sport_event_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
