-- #598: the draft-room configuration columns were never written by a live create path (tiers are
-- event-owned since #249, and only `false` was ever stored for exclusivity), and nothing reads
-- them any more. The contest's own is_exclusive flag goes with them: the selection room read
-- exclusivity only from the configuration, so the flag never changed what a player could pick.
ALTER TABLE "contest_configurations"
  DROP COLUMN "rounds",
  DROP COLUMN "time_per_pick_seconds",
  DROP COLUMN "auto_pick_policy",
  DROP COLUMN "tier_config",
  DROP COLUMN "is_exclusive",
  DROP COLUMN "picks_per_period",
  DROP COLUMN "round_values",
  DROP COLUMN "start_round";

ALTER TABLE "contests" DROP COLUMN "is_exclusive";

DROP TYPE "PrismaAutoPickPolicy";
