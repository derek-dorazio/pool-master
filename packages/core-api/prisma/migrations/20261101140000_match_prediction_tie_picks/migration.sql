-- #792: a pick'em pick may say a game ends level (soccer's draw). A pick now says what it
-- predicts: TEAM names the team picked to win, TIE names no team. Every pick made so far named a
-- team, so the new column fills TEAM.

-- CreateEnum
CREATE TYPE "PrismaPredictedResult" AS ENUM ('TEAM', 'TIE');

-- AlterTable
ALTER TABLE "contest_entry_match_predictions"
  ADD COLUMN "predicted_result" "PrismaPredictedResult" NOT NULL DEFAULT 'TEAM',
  ALTER COLUMN "sport_event_participant_id" DROP NOT NULL;

-- A team pick names its team; a tie pick names none.
ALTER TABLE "contest_entry_match_predictions"
  ADD CONSTRAINT "contest_entry_match_predictions_team_with_team_result"
  CHECK (("predicted_result" = 'TEAM') = ("sport_event_participant_id" IS NOT NULL));
