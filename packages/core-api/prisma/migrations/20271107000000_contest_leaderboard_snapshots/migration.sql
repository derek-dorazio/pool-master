-- CreateTable
CREATE TABLE "contest_leaderboard_snapshots" (
    "contest_id" UUID NOT NULL,
    "shown_event" VARCHAR(36) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "computed_from" TIMESTAMPTZ NOT NULL,
    "contest_updated_at" TIMESTAMPTZ NOT NULL,
    "valid_until" TIMESTAMPTZ,
    "board" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_leaderboard_snapshots_pkey" PRIMARY KEY ("contest_id","shown_event")
);

-- AddForeignKey
ALTER TABLE "contest_leaderboard_snapshots" ADD CONSTRAINT "contest_leaderboard_snapshots_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

