CREATE TYPE "PrismaLeagueJoinPolicy" AS ENUM (
  'COMMISSIONER_ONLY',
  'LINK_INVITE',
  'OPEN'
);

CREATE TYPE "PrismaLeagueRole" AS ENUM (
  'COMMISSIONER',
  'MEMBER'
);

CREATE TYPE "PrismaLeagueMembershipStatus" AS ENUM (
  'ACTIVE',
  'INACTIVE'
);

CREATE TYPE "PrismaSquadStatus" AS ENUM (
  'ACTIVE',
  'INACTIVE'
);

CREATE TYPE "PrismaSquadMembershipStatus" AS ENUM (
  'ACTIVE',
  'INACTIVE'
);

CREATE TYPE "PrismaLeagueInviteType" AS ENUM (
  'EMAIL',
  'LINK'
);

CREATE TYPE "PrismaLeagueInvitationStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED'
);

-- Normalize legacy string values before casting into the new enum-backed columns.
UPDATE "leagues"
SET "join_policy" = CASE
  WHEN LOWER("join_policy") = 'invite-only' THEN 'COMMISSIONER_ONLY'
  ELSE UPPER("join_policy")
END
WHERE "join_policy" IS NOT NULL
  AND (
    LOWER("join_policy") = 'invite-only'
    OR "join_policy" <> UPPER("join_policy")
  );

UPDATE "league_memberships"
SET "role" = CASE
  WHEN UPPER("role") = 'OWNER' THEN 'COMMISSIONER'
  ELSE UPPER("role")
END
WHERE "role" IS NOT NULL
  AND (
    UPPER("role") = 'OWNER'
    OR "role" <> UPPER("role")
  );

UPDATE "league_memberships"
SET "status" = UPPER("status")
WHERE "status" IS NOT NULL
  AND "status" <> UPPER("status");

UPDATE "squads"
SET "status" = UPPER("status")
WHERE "status" IS NOT NULL
  AND "status" <> UPPER("status");

UPDATE "squad_memberships"
SET "status" = UPPER("status")
WHERE "status" IS NOT NULL
  AND "status" <> UPPER("status");

UPDATE "league_invitations"
SET "invite_type" = UPPER("invite_type")
WHERE "invite_type" IS NOT NULL
  AND "invite_type" <> UPPER("invite_type");

UPDATE "league_invitations"
SET "status" = UPPER("status")
WHERE "status" IS NOT NULL
  AND "status" <> UPPER("status");

ALTER TABLE "leagues"
  ALTER COLUMN "join_policy" DROP DEFAULT,
  ALTER COLUMN "join_policy" TYPE "PrismaLeagueJoinPolicy"
    USING "join_policy"::"PrismaLeagueJoinPolicy",
  ALTER COLUMN "join_policy" SET DEFAULT 'COMMISSIONER_ONLY';

ALTER TABLE "league_memberships"
  ALTER COLUMN "role" DROP DEFAULT,
  ALTER COLUMN "role" TYPE "PrismaLeagueRole"
    USING "role"::"PrismaLeagueRole",
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PrismaLeagueMembershipStatus"
    USING "status"::"PrismaLeagueMembershipStatus",
  ALTER COLUMN "role" SET DEFAULT 'MEMBER',
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "squads"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PrismaSquadStatus"
    USING "status"::"PrismaSquadStatus",
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "squad_memberships"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PrismaSquadMembershipStatus"
    USING "status"::"PrismaSquadMembershipStatus",
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "league_invitations"
  ALTER COLUMN "invite_type" DROP DEFAULT,
  ALTER COLUMN "invite_type" TYPE "PrismaLeagueInviteType"
    USING "invite_type"::"PrismaLeagueInviteType",
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PrismaLeagueInvitationStatus"
    USING "status"::"PrismaLeagueInvitationStatus",
  ALTER COLUMN "invite_type" SET DEFAULT 'EMAIL',
  ALTER COLUMN "status" SET DEFAULT 'PENDING';
