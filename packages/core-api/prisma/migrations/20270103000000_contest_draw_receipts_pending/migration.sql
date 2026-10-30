-- A quick pick draw's receipts are queued for the next lifecycle sweep (#1171): the draw records
-- the event it dealt, and the sweep sends that event's receipts and clears it. Draws already
-- made sent theirs, so the column starts empty.

-- AlterTable
ALTER TABLE "contest_draws" ADD COLUMN "receipts_pending_sport_event_id" UUID;

-- CreateIndex: a whole one, as every foreign key has (an event's delete finds its draws by it);
-- it also serves the sweep's read of the draws still owing receipts.
CREATE INDEX "contest_draws_receipts_pending_sport_event_id_idx" ON "contest_draws"("receipts_pending_sport_event_id");

-- AddForeignKey
ALTER TABLE "contest_draws" ADD CONSTRAINT "contest_draws_receipts_pending_sport_event_id_fkey" FOREIGN KEY ("receipts_pending_sport_event_id") REFERENCES "sport_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
