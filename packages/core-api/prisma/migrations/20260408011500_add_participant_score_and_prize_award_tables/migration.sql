CREATE TABLE "contest_entry_participant_scores" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "roster_pick_id" UUID NOT NULL,
    "points_earned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_entry_participant_scores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contest_entry_participant_score_events" (
    "id" UUID NOT NULL,
    "contest_entry_participant_score_id" UUID NOT NULL,
    "participant_contest_scoring_rule_id" UUID NOT NULL,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "details_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_entry_participant_score_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contest_entry_prize_awards" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "contest_prize_definition_id" UUID NOT NULL,
    "prize_definition_id" VARCHAR(100),
    "display_name" VARCHAR(100) NOT NULL,
    "amount" DOUBLE PRECISION,
    "percentage" DOUBLE PRECISION,
    "awarded_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_entry_prize_awards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contest_entry_participant_scores_entry_id_roster_pick_id_key"
ON "contest_entry_participant_scores"("entry_id", "roster_pick_id");

CREATE INDEX "contest_entry_participant_scores_entry_id_idx"
ON "contest_entry_participant_scores"("entry_id");

CREATE INDEX "contest_entry_participant_scores_roster_pick_id_idx"
ON "contest_entry_participant_scores"("roster_pick_id");

CREATE INDEX "contest_entry_participant_score_events_contest_entry_participant_score_id_idx"
ON "contest_entry_participant_score_events"("contest_entry_participant_score_id");

CREATE INDEX "contest_entry_participant_score_events_participant_contest_scoring_rule_id_idx"
ON "contest_entry_participant_score_events"("participant_contest_scoring_rule_id");

CREATE INDEX "contest_entry_prize_awards_entry_id_idx"
ON "contest_entry_prize_awards"("entry_id");

CREATE INDEX "contest_entry_prize_awards_contest_prize_definition_id_idx"
ON "contest_entry_prize_awards"("contest_prize_definition_id");

ALTER TABLE "contest_entry_participant_scores"
ADD CONSTRAINT "contest_entry_participant_scores_entry_id_fkey"
FOREIGN KEY ("entry_id") REFERENCES "contest_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contest_entry_participant_scores"
ADD CONSTRAINT "contest_entry_participant_scores_roster_pick_id_fkey"
FOREIGN KEY ("roster_pick_id") REFERENCES "roster_picks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contest_entry_participant_score_events"
ADD CONSTRAINT "contest_entry_participant_score_events_contest_entry_participant_score_id_fkey"
FOREIGN KEY ("contest_entry_participant_score_id") REFERENCES "contest_entry_participant_scores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contest_entry_participant_score_events"
ADD CONSTRAINT "contest_entry_participant_score_events_participant_contest_scoring_rule_id_fkey"
FOREIGN KEY ("participant_contest_scoring_rule_id") REFERENCES "participant_contest_scoring_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contest_entry_prize_awards"
ADD CONSTRAINT "contest_entry_prize_awards_entry_id_fkey"
FOREIGN KEY ("entry_id") REFERENCES "contest_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contest_entry_prize_awards"
ADD CONSTRAINT "contest_entry_prize_awards_contest_prize_definition_id_fkey"
FOREIGN KEY ("contest_prize_definition_id") REFERENCES "contest_prize_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
