-- A quick pick draw's receipts are queued for the next lifecycle sweep (#1171): the draw marks
-- itself, and the sweep sends the receipts and clears the mark. Draws already made sent theirs.

-- AlterTable
ALTER TABLE "contest_draws" ADD COLUMN "receipts_pending" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "contest_draws_receipts_pending_idx" ON "contest_draws"("receipts_pending");
