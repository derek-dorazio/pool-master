-- Gifted Premium (#986, plans/payments.md §3): every league is on Premium as a gift until its
-- renewal date, six months after signup, or six months after this move for a league that already
-- exists. Every plan is capped, Platinum included.
--
-- The order matters. The stored PLAN_CONFIG, where there is one (QA), is set to the plan matrix
-- first, so a league moved from Platinum to Premium keeps the all-years summary and record book,
-- which now start at Premium. Then only leagues on Platinum move to Premium; a league whose
-- commissioner picked Free or Pro stays there. Each move is logged with nobody named. The DDL is
-- generated with `prisma migrate diff --from-url <migrated db> --to-schema-datamodel
-- prisma/schema.prisma --script`.

-- AlterTable
ALTER TABLE "leagues" ADD COLUMN     "plan_renews_at" TIMESTAMPTZ NOT NULL DEFAULT (now() + '6 mons'::interval),
ALTER COLUMN "plan" SET DEFAULT 'PREMIUM';

-- CreateTable
CREATE TABLE "league_plan_renewal_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "from_renews_at" TIMESTAMPTZ NOT NULL,
    "to_renews_at" TIMESTAMPTZ NOT NULL,
    "changed_by_id" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_plan_renewal_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "league_plan_renewal_changes_league_id_changed_at_idx" ON "league_plan_renewal_changes"("league_id", "changed_at" DESC);

-- AddForeignKey
ALTER TABLE "league_plan_renewal_changes" ADD CONSTRAINT "league_plan_renewal_changes_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_plan_renewal_changes" ADD CONSTRAINT "league_plan_renewal_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The plan matrix (Derek 2026-10-24), the same as PLAN_SETTINGS' code defaults, over a stored
-- PLAN_CONFIG. The change is recorded in the settings history like a save, with nobody named.
CREATE TEMP TABLE "plan_matrix" ON COMMIT DROP AS SELECT '{
  "caps": {
    "ENTRIES_PER_CONTEST": { "FREE": 20, "PRO": 50, "PREMIUM": 100, "PLATINUM": 500 },
    "SPORTS_LEAGUES_PER_YEAR": { "FREE": 5, "PRO": 15, "PREMIUM": 30, "PLATINUM": 50 }
  },
  "features": {
    "EMAIL_CONTEST_OPENED": "FREE",
    "EMAIL_CONTEST_ENTRY_COMPLETED": "FREE",
    "EMAIL_CONTEST_RESULTS": "FREE",
    "EMAIL_CONTEST_EVENT_CHANGED": "FREE",
    "EMAIL_CONTEST_STARTED_SUMMARY": "PRO",
    "EMAIL_CONTEST_ENTRY_REMINDER": "PRO",
    "EMAIL_CONTEST_STANDINGS": "PRO",
    "EMAIL_EVENT_COMING_UP": "PRO",
    "EMAIL_EVENT_READY_FOR_CONTESTS": "PRO",
    "EMAIL_CONTEST_NOT_OPEN": "PRO",
    "EMAIL_YEAR_IN_REVIEW": "PRO",
    "CUP_STANDINGS": "PRO",
    "CUP_CROWNING": "PRO",
    "CHAMPIONSHIP": "PRO",
    "TROPHY_SHELF": "PRO",
    "CUP_SETTINGS": "PRO",
    "PAST_YEARS": "PRO",
    "ALL_TIME_SUMMARY": "PREMIUM",
    "RECORD_BOOK": "PREMIUM"
  }
}'::jsonb AS "config_json";

INSERT INTO "platform_runtime_config_history" ("config_key", "previous_json", "new_json")
SELECT 'PLAN_CONFIG', "stored"."config_json", "plan_matrix"."config_json"
FROM "platform_runtime_configs" AS "stored", "plan_matrix"
WHERE "stored"."config_key" = 'PLAN_CONFIG' AND "stored"."config_json" <> "plan_matrix"."config_json";

UPDATE "platform_runtime_configs"
SET "config_json" = "plan_matrix"."config_json", "updated_by_id" = NULL, "updated_at" = CURRENT_TIMESTAMP
FROM "plan_matrix"
WHERE "platform_runtime_configs"."config_key" = 'PLAN_CONFIG'
  AND "platform_runtime_configs"."config_json" <> "plan_matrix"."config_json";

-- Then the leagues on Platinum move to Premium, logged.
INSERT INTO "league_plan_changes" ("league_id", "from_plan", "to_plan")
SELECT "id", 'PLATINUM', 'PREMIUM' FROM "leagues" WHERE "plan" = 'PLATINUM';

UPDATE "leagues" SET "plan" = 'PREMIUM' WHERE "plan" = 'PLATINUM';
