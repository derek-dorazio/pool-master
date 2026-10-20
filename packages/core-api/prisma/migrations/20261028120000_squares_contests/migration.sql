-- Squares pools (#711, plans/super-bowl-squares.md §3): a third contest format and selection type,
-- the contest's one game, its claimed boxes, its digits and its frozen winners.
-- AlterEnum
ALTER TYPE "PrismaContestFormat" ADD VALUE 'SQUARES';

-- AlterEnum
ALTER TYPE "PrismaSelectionType" ADD VALUE 'SQUARES';

-- CreateTable
CREATE TABLE "contest_squares_games" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "sport_event_match_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_squares_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entry_squares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "contest_entry_id" UUID NOT NULL,
    "row_index" INTEGER NOT NULL,
    "column_index" INTEGER NOT NULL,
    "claimed_by_user_id" UUID,
    "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_entry_squares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_squares_draws" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "seed" VARCHAR(64) NOT NULL,
    "row_digits" INTEGER[],
    "column_digits" INTEGER[],
    "drawn_by_user_id" UUID,
    "drawn_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_squares_draws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_squares_winners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "period_number" INTEGER NOT NULL,
    "home_score" INTEGER NOT NULL,
    "away_score" INTEGER NOT NULL,
    "row_index" INTEGER NOT NULL,
    "column_index" INTEGER NOT NULL,
    "contest_entry_id" UUID,
    "settled_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_squares_winners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contest_squares_games_contest_id_key" ON "contest_squares_games"("contest_id");

-- CreateIndex
CREATE INDEX "contest_squares_games_sport_event_match_id_idx" ON "contest_squares_games"("sport_event_match_id");

-- CreateIndex
CREATE INDEX "contest_entry_squares_contest_entry_id_idx" ON "contest_entry_squares"("contest_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entry_squares_contest_id_row_index_column_index_key" ON "contest_entry_squares"("contest_id", "row_index", "column_index");

-- CreateIndex
CREATE UNIQUE INDEX "contest_squares_draws_contest_id_key" ON "contest_squares_draws"("contest_id");

-- CreateIndex
CREATE INDEX "contest_squares_winners_contest_entry_id_idx" ON "contest_squares_winners"("contest_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_squares_winners_contest_id_period_number_key" ON "contest_squares_winners"("contest_id", "period_number");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entries_id_contest_id_key" ON "contest_entries"("id", "contest_id");

-- AddForeignKey
ALTER TABLE "contest_squares_games" ADD CONSTRAINT "contest_squares_games_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_squares_games" ADD CONSTRAINT "contest_squares_games_sport_event_match_id_fkey" FOREIGN KEY ("sport_event_match_id") REFERENCES "sport_event_matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_squares" ADD CONSTRAINT "contest_entry_squares_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_squares" ADD CONSTRAINT "contest_entry_squares_contest_entry_id_contest_id_fkey" FOREIGN KEY ("contest_entry_id", "contest_id") REFERENCES "contest_entries"("id", "contest_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_squares" ADD CONSTRAINT "contest_entry_squares_claimed_by_user_id_fkey" FOREIGN KEY ("claimed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_squares_draws" ADD CONSTRAINT "contest_squares_draws_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_squares_draws" ADD CONSTRAINT "contest_squares_draws_drawn_by_user_id_fkey" FOREIGN KEY ("drawn_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_squares_winners" ADD CONSTRAINT "contest_squares_winners_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_squares_winners" ADD CONSTRAINT "contest_squares_winners_contest_entry_id_fkey" FOREIGN KEY ("contest_entry_id") REFERENCES "contest_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A box is a grid position, 0 to 9 each way.
ALTER TABLE "contest_entry_squares"
  ADD CONSTRAINT "contest_entry_squares_position_check"
  CHECK ("row_index" BETWEEN 0 AND 9 AND "column_index" BETWEEN 0 AND 9);

-- Each side's digits are 0 to 9, once each: ten of them, all ten digits present.
ALTER TABLE "contest_squares_draws"
  ADD CONSTRAINT "contest_squares_draws_digits_check"
  CHECK (
    array_length("row_digits", 1) = 10 AND "row_digits" @> ARRAY[0,1,2,3,4,5,6,7,8,9]
    AND array_length("column_digits", 1) = 10 AND "column_digits" @> ARRAY[0,1,2,3,4,5,6,7,8,9]
  );

ALTER TABLE "contest_squares_winners"
  ADD CONSTRAINT "contest_squares_winners_values_check"
  CHECK (
    "period_number" >= 1 AND "home_score" >= 0 AND "away_score" >= 0
    AND "row_index" BETWEEN 0 AND 9 AND "column_index" BETWEEN 0 AND 9
  );
