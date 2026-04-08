CREATE TABLE "squads" (
  "id" UUID NOT NULL,
  "league_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "icon_url" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "squads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "squad_memberships" (
  "id" UUID NOT NULL,
  "squad_id" UUID NOT NULL,
  "league_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "squad_memberships_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "squads_league_id_status_idx" ON "squads"("league_id", "status");
CREATE INDEX "squad_memberships_squad_id_status_idx" ON "squad_memberships"("squad_id", "status");

CREATE UNIQUE INDEX "squad_memberships_squad_id_user_id_key"
  ON "squad_memberships"("squad_id", "user_id");
CREATE UNIQUE INDEX "squad_memberships_league_id_user_id_key"
  ON "squad_memberships"("league_id", "user_id");

ALTER TABLE "squads"
  ADD CONSTRAINT "squads_league_id_fkey"
  FOREIGN KEY ("league_id") REFERENCES "leagues"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "squads"
  ADD CONSTRAINT "squads_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "squad_memberships"
  ADD CONSTRAINT "squad_memberships_squad_id_fkey"
  FOREIGN KEY ("squad_id") REFERENCES "squads"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "squad_memberships"
  ADD CONSTRAINT "squad_memberships_league_id_fkey"
  FOREIGN KEY ("league_id") REFERENCES "leagues"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "squad_memberships"
  ADD CONSTRAINT "squad_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
