-- #845 catalog slice 2: the "New contest open" email (D1), and when each contest was opened, so
-- no entry reminder lands within 6 hours of it.
ALTER TYPE "PrismaEmailTemplateKey" ADD VALUE 'CONTEST_OPENED';

ALTER TABLE "contests" ADD COLUMN "opened_at" TIMESTAMPTZ;
