CREATE TYPE "PrismaSquadOwnerInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

CREATE TABLE "squad_owner_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "league_id" UUID NOT NULL,
  "squad_id" UUID NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  "invite_code" VARCHAR(100) NOT NULL,
  "status" "PrismaSquadOwnerInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "invited_by" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ,
  "accepted_at" TIMESTAMPTZ,
  "accepted_by" UUID,
  "replacement_for_user_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "squad_owner_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "squad_owner_invitations_invite_code_key"
  ON "squad_owner_invitations"("invite_code");

CREATE INDEX "squad_owner_invitations_league_id_status_idx"
  ON "squad_owner_invitations"("league_id", "status");

CREATE INDEX "squad_owner_invitations_squad_id_status_idx"
  ON "squad_owner_invitations"("squad_id", "status");

ALTER TABLE "squad_owner_invitations"
  ADD CONSTRAINT "squad_owner_invitations_league_id_fkey"
  FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "squad_owner_invitations"
  ADD CONSTRAINT "squad_owner_invitations_squad_id_fkey"
  FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "squad_owner_invitations"
  ADD CONSTRAINT "squad_owner_invitations_invited_by_fkey"
  FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "squad_owner_invitations"
  ADD CONSTRAINT "squad_owner_invitations_accepted_by_fkey"
  FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
