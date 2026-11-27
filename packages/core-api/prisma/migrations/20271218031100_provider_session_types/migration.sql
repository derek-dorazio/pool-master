-- #2045: a league's provider session types (inclusion only), and the NONE webhook event set for a
-- provider league that publishes no notifications. The Formula 1 rows follow in 030710, since a new
-- enum value cannot be used in the transaction that adds it.

-- AlterEnum
ALTER TYPE "PrismaProviderWebhookEventSet" ADD VALUE 'NONE';

-- CreateTable
CREATE TABLE "sport_league_provider_session_type_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "sport_league_provider_mapping_id" UUID NOT NULL,
    "provider_session_type" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_provider_session_type_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_session_type_mappings_provider_mapping_idx" ON "sport_league_provider_session_type_mappings"("sport_league_id", "sport_league_provider_mapping_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_session_type_mappings_value_key" ON "sport_league_provider_session_type_mappings"("sport_league_provider_mapping_id", "provider_session_type");

-- AddForeignKey
ALTER TABLE "sport_league_provider_session_type_mappings" ADD CONSTRAINT "provider_session_type_mappings_provider_mapping_fkey" FOREIGN KEY ("sport_league_id", "sport_league_provider_mapping_id") REFERENCES "sport_league_provider_mappings"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

