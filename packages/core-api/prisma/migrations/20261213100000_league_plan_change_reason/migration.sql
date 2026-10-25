-- #1032: why each league plan change happened, instead of inferring it from a missing changer.
CREATE TYPE "PrismaLeaguePlanChangeReason" AS ENUM ('CHOSEN', 'PREVIEW_ENDED', 'GIFT_RESTORED');

ALTER TABLE "league_plan_changes" ADD COLUMN "change_reason" "PrismaLeaguePlanChangeReason" NOT NULL DEFAULT 'CHOSEN';

-- The sweep's moves to Free so far: made by no one, on or after the league's renewal date.
UPDATE "league_plan_changes" AS change
SET "change_reason" = 'PREVIEW_ENDED'
FROM "leagues" AS league
WHERE change."league_id" = league."id"
  AND change."changed_by_id" IS NULL
  AND change."to_plan" = 'FREE'
  AND change."changed_at" >= league."plan_renews_at";

-- Every writer states the reason from here on.
ALTER TABLE "league_plan_changes" ALTER COLUMN "change_reason" DROP DEFAULT;
