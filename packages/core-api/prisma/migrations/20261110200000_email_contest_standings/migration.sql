-- #877 (#845 catalog slice 3): the live standings email, sent after each round or event while a
-- contest is live, and each entry's place in the last one, which the next one's movement is
-- measured from.
ALTER TYPE "PrismaEmailTemplateKey" ADD VALUE 'CONTEST_STANDINGS';

ALTER TABLE "contest_entries" ADD COLUMN "last_standings_email_position" INTEGER;
