-- #509: drop the snake-draft session tables. No code ever wrote them; the draft room derives its
-- state and pick history from contest entry picks. Only their own foreign keys point out of them.

-- DropForeignKey
ALTER TABLE "draft_pick_histories" DROP CONSTRAINT "draft_pick_histories_draft_session_id_fkey";

-- DropForeignKey
ALTER TABLE "draft_pick_histories" DROP CONSTRAINT "draft_pick_histories_entry_id_fkey";

-- DropForeignKey
ALTER TABLE "draft_pick_histories" DROP CONSTRAINT "draft_pick_histories_pick_id_fkey";

-- DropForeignKey
ALTER TABLE "draft_sessions" DROP CONSTRAINT "draft_sessions_contest_id_fkey";

-- DropTable
DROP TABLE "draft_pick_histories";

-- DropTable
DROP TABLE "draft_sessions";

-- DropEnum
DROP TYPE "PrismaDraftStatus";

