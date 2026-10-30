-- #1170: when the entry reminder sweep next looks at a contest, so a sweep reads only the
-- contests whose moment has come instead of every open and live contest.
ALTER TABLE "contests" ADD COLUMN "next_reminder_at" TIMESTAMPTZ;

CREATE INDEX "contests_next_reminder_at_idx" ON "contests"("next_reminder_at");

-- Contests already taking entries or live are looked at on the first sweep, which works out
-- each one's next reminder.
UPDATE "contests" SET "next_reminder_at" = NOW() WHERE "status" IN ('OPEN', 'ACTIVE');
