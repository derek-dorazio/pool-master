ALTER TABLE "leagues"
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "join_policy" VARCHAR(30) NOT NULL DEFAULT 'COMMISSIONER_ONLY';

UPDATE "leagues"
SET
  "is_active" = COALESCE(("settings"->>'isActive')::boolean, true),
  "join_policy" = COALESCE("settings"->>'invitePolicy', 'COMMISSIONER_ONLY');

ALTER TABLE "leagues"
DROP COLUMN "settings";
