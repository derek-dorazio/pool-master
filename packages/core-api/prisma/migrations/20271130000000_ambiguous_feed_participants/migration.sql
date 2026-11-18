-- #1824: a feed participant the sync cannot link on its own (its name matches two or more of the
-- site's participants) waits as "needs linking": one row per provider feed id, open until a root
-- admin links it or creates a new participant, and one sighting per event whose field sent it.
-- No data: rows are written by the sync from its next field load.

-- CreateTable
CREATE TABLE "ambiguous_feed_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "provider_id" VARCHAR(100) NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "feed_name" VARCHAR(255) NOT NULL,
    "candidate_participant_ids" UUID[],
    "resolved_at" TIMESTAMPTZ,
    "resolved_participant_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ambiguous_feed_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ambiguous_feed_participant_sightings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ambiguous_feed_participant_id" UUID NOT NULL,
    "sport_event_id" UUID NOT NULL,
    "feed_participant" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ambiguous_feed_participant_sightings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ambiguous_feed_participants_sport_league_id_resolved_at_idx" ON "ambiguous_feed_participants"("sport_league_id", "resolved_at");

-- CreateIndex
CREATE INDEX "ambiguous_feed_participants_resolved_participant_id_idx" ON "ambiguous_feed_participants"("resolved_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ambiguous_feed_participants_provider_id_external_id_key" ON "ambiguous_feed_participants"("provider_id", "external_id");

-- CreateIndex
CREATE INDEX "ambiguous_feed_participant_sightings_sport_event_id_idx" ON "ambiguous_feed_participant_sightings"("sport_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ambiguous_feed_participant_sightings_ambiguous_feed_partici_key" ON "ambiguous_feed_participant_sightings"("ambiguous_feed_participant_id", "sport_event_id");

-- AddForeignKey
ALTER TABLE "ambiguous_feed_participants" ADD CONSTRAINT "ambiguous_feed_participants_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ambiguous_feed_participants" ADD CONSTRAINT "ambiguous_feed_participants_resolved_participant_id_fkey" FOREIGN KEY ("resolved_participant_id") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ambiguous_feed_participant_sightings" ADD CONSTRAINT "ambiguous_feed_participant_sightings_ambiguous_feed_partic_fkey" FOREIGN KEY ("ambiguous_feed_participant_id") REFERENCES "ambiguous_feed_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ambiguous_feed_participant_sightings" ADD CONSTRAINT "ambiguous_feed_participant_sightings_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

