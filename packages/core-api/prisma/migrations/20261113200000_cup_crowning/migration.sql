-- #841 slice 4: crowning. A cup is OPEN until the commissioner crowns it; crowning freezes each
-- squad's place in cup_standings, hands out trophies, and keeps the points table it was scored on.
CREATE TYPE "PrismaCupStatus" AS ENUM ('OPEN', 'CROWNED');
CREATE TYPE "PrismaCupTrophy" AS ENUM ('CHAMPION', 'RUNNER_UP', 'THIRD');

ALTER TABLE "cups"
  ADD COLUMN "status" "PrismaCupStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "crowned_at" TIMESTAMPTZ,
  ADD COLUMN "crowned_points_scale" "PrismaCupPointsScale",
  ADD COLUMN "crowned_custom_points" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD CONSTRAINT "cups_crowned_check"
    CHECK (("status" = 'CROWNED') = ("crowned_at" IS NOT NULL)
      AND ("status" = 'CROWNED') = ("crowned_points_scale" IS NOT NULL)
      AND ("crowned_points_scale" IS NOT DISTINCT FROM 'CUSTOM') = (cardinality("crowned_custom_points") > 0));

CREATE TABLE "cup_standings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cup_id" UUID NOT NULL,
    "squad_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "display_position" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "podiums" INTEGER NOT NULL,
    "contests_counted" INTEGER NOT NULL,
    "trophy" "PrismaCupTrophy",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cup_standings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cup_standings_squad_id_idx" ON "cup_standings"("squad_id");
CREATE UNIQUE INDEX "cup_standings_cup_id_squad_id_key" ON "cup_standings"("cup_id", "squad_id");

-- The squad delete guard keeps a squad with results; the cascades let a league go whole.
ALTER TABLE "cup_standings" ADD CONSTRAINT "cup_standings_cup_id_fkey" FOREIGN KEY ("cup_id") REFERENCES "cups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cup_standings" ADD CONSTRAINT "cup_standings_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
