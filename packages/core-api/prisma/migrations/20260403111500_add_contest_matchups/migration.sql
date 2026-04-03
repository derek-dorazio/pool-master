CREATE TABLE "contest_matchups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contest_id" UUID NOT NULL,
  "event_id" UUID,
  "period" INTEGER NOT NULL,
  "matchup_index" INTEGER NOT NULL DEFAULT 1,
  "round_number" INTEGER,
  "match_number" INTEGER,
  "label" VARCHAR(255),
  "home_participant_id" UUID,
  "away_participant_id" UUID,
  "starts_at" TIMESTAMPTZ,
  "lock_at" TIMESTAMPTZ,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "contest_matchups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contest_matchups_contest_id_fkey"
    FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contest_matchups_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "sport_events"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "contest_matchups_home_participant_id_fkey"
    FOREIGN KEY ("home_participant_id") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "contest_matchups_away_participant_id_fkey"
    FOREIGN KEY ("away_participant_id") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "contest_matchups_contest_id_period_matchup_index_key"
  ON "contest_matchups"("contest_id", "period", "matchup_index");

CREATE INDEX "contest_matchups_contest_id_period_idx"
  ON "contest_matchups"("contest_id", "period");

CREATE INDEX "contest_matchups_event_id_idx"
  ON "contest_matchups"("event_id");
