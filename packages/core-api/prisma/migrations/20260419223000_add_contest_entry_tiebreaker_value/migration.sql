ALTER TABLE "contest_entries"
ADD COLUMN IF NOT EXISTS "tiebreaker_value" INTEGER;
