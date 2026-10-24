-- #872 slice 4: the year in review email, and the record that a league's commissioner sent it.
-- AlterEnum
ALTER TYPE "PrismaEmailTemplateKey" ADD VALUE 'YEAR_IN_REVIEW';

-- CreateTable
CREATE TABLE "league_year_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "sent_by_user_id" UUID,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_year_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "league_year_reviews_league_id_year_key" ON "league_year_reviews"("league_id", "year");

-- AddForeignKey
ALTER TABLE "league_year_reviews" ADD CONSTRAINT "league_year_reviews_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_year_reviews" ADD CONSTRAINT "league_year_reviews_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

