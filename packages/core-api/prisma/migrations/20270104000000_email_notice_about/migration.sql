-- The "already told?" checks match an email's notice subject exactly (#1169) instead of a prefix
-- of its idempotency key, which no index served: Postgres walked every row of the template.
-- Emails recorded before this have no subject; a check that misses one goes on to send, and the
-- idempotency key still records it once.

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN "notice_about" VARCHAR(200);

-- DropIndex: only the prefix checks read by template and league.
DROP INDEX "email_messages_template_key_league_id_idx";

-- CreateIndex
CREATE INDEX "email_messages_template_key_notice_about_league_id_idx" ON "email_messages"("template_key", "notice_about", "league_id");
