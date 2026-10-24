-- League plans (#944): every league, new and existing, is on Platinum, which has everything,
-- until a commissioner picks a lower plan. Each change is logged in league_plan_changes.

-- CreateEnum
CREATE TYPE "PrismaLeaguePlan" AS ENUM ('FREE', 'PRO', 'PREMIUM', 'PLATINUM');

-- AlterTable
ALTER TABLE "leagues" ADD COLUMN     "plan" "PrismaLeaguePlan" NOT NULL DEFAULT 'PLATINUM';

-- CreateTable
CREATE TABLE "league_plan_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "from_plan" "PrismaLeaguePlan" NOT NULL,
    "to_plan" "PrismaLeaguePlan" NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_plan_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "league_plan_changes_league_id_changed_at_idx" ON "league_plan_changes"("league_id", "changed_at" DESC);

-- AddForeignKey
ALTER TABLE "league_plan_changes" ADD CONSTRAINT "league_plan_changes_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_plan_changes" ADD CONSTRAINT "league_plan_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

