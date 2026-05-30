-- CreateTable
CREATE TABLE "participant_ranking_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participant_id" UUID NOT NULL,
    "provider_id" VARCHAR(100) NOT NULL,
    "ranking_type" VARCHAR(50) NOT NULL,
    "rank" INTEGER NOT NULL,
    "points" DECIMAL(12,4),
    "as_of_date" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "participant_ranking_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "participant_ranking_snapshots_provider_id_participant_id_ranki_key" ON "participant_ranking_snapshots"("provider_id", "participant_id", "ranking_type", "as_of_date");

-- CreateIndex
CREATE INDEX "participant_ranking_snapshots_provider_id_ranking_type_as_of_idx" ON "participant_ranking_snapshots"("provider_id", "ranking_type", "as_of_date");

-- CreateIndex
CREATE INDEX "participant_ranking_snapshots_participant_id_ranking_type_as_o_idx" ON "participant_ranking_snapshots"("participant_id", "ranking_type", "as_of_date");

-- AddForeignKey
ALTER TABLE "participant_ranking_snapshots" ADD CONSTRAINT "participant_ranking_snapshots_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
