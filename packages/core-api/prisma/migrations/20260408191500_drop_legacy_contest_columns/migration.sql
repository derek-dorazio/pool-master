ALTER TABLE "contests"
  DROP COLUMN IF EXISTS "season_id",
  DROP COLUMN IF EXISTS "scoring_rules",
  DROP COLUMN IF EXISTS "payout_config";
