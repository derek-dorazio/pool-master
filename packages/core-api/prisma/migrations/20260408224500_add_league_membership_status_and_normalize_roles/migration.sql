ALTER TABLE "league_memberships"
ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';

UPDATE "league_memberships"
SET "role" = 'MEMBER'
WHERE "role" IN ('MANAGER', 'VIEWER');

ALTER TABLE "league_memberships"
ALTER COLUMN "role" SET DEFAULT 'MEMBER';

CREATE INDEX "league_memberships_league_id_status_idx"
ON "league_memberships"("league_id", "status");
