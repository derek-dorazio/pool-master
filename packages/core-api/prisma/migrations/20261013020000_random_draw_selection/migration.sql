-- #601: the random-draw (sweepstake) selection type, and the draw that deals its picks.
--
-- The new enum value is only added here, never used, so ALTER TYPE ... ADD VALUE is safe inside
-- the migration's transaction.
ALTER TYPE "PrismaSelectionType" ADD VALUE 'RANDOM_DRAW';

-- One draw per contest: the seed and the shuffled field and entry orders it dealt from, so the
-- draw can be shown and replayed.
CREATE TABLE "contest_draws" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "seed" VARCHAR(64) NOT NULL,
    "field_order" UUID[],
    "entry_order" UUID[],
    "drawn_by_user_id" UUID,
    "drawn_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_draws_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contest_draws_contest_id_key" ON "contest_draws"("contest_id");

ALTER TABLE "contest_draws"
  ADD CONSTRAINT "contest_draws_contest_id_fkey"
  FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contest_draws"
  ADD CONSTRAINT "contest_draws_drawn_by_user_id_fkey"
  FOREIGN KEY ("drawn_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
