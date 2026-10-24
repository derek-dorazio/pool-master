-- DropForeignKey
ALTER TABLE "league_year_finishes" DROP CONSTRAINT "league_year_finishes_event_series_id_fkey";

-- AlterTable
ALTER TABLE "league_year_finishes" DROP COLUMN "event_series_id",
DROP COLUMN "selection_type";

