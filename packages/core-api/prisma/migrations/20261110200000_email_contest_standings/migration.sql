-- #877 (#845 catalog slice 3): the live standings email, sent after each round or event while a
-- contest is live; each entry's place in the last one, which the next one's movement is measured
-- from; and the index a scheduler sweep finds a contest's emails of one template by, to queue a
-- standings email once.
ALTER TYPE "PrismaEmailTemplateKey" ADD VALUE 'CONTEST_STANDINGS';

ALTER TABLE "contest_entries" ADD COLUMN "last_standings_email_position" INTEGER;

CREATE INDEX "email_messages_contest_id_template_key_idx" ON "email_messages"("contest_id", "template_key");
