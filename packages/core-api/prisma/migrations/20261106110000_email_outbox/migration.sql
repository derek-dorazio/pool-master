-- #844 SES slice 3: the email outbox. One row per email per recipient: queued with its rendered
-- content and sent by the sender loop, or skipped with the reason. The idempotency key makes a
-- retried action, a second sweep or a double click record the email once.
-- CreateEnum
CREATE TYPE "PrismaEmailTemplateKey" AS ENUM ('LEAGUE_MEMBER_INVITE', 'LEAGUE_JOIN_SUCCESS', 'CONTEST_ENTRY_COMPLETED', 'CONTEST_STARTED_SUMMARY', 'PASSWORD_RESET', 'PASSWORD_CHANGED');

-- CreateEnum
CREATE TYPE "PrismaEmailMessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PrismaEmailSkipReason" AS ENUM ('EMAIL_DISABLED', 'TEMPLATE_DISABLED', 'NOT_ALLOWED_IN_ENVIRONMENT');

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_key" "PrismaEmailTemplateKey" NOT NULL,
    "recipient_user_id" UUID,
    "recipient_email" VARCHAR(255) NOT NULL,
    "league_id" UUID,
    "contest_id" UUID,
    "entry_id" UUID,
    "invitation_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "from_name" VARCHAR(255) NOT NULL,
    "from_address" VARCHAR(255) NOT NULL,
    "subject" TEXT,
    "text_body" TEXT,
    "html_body" TEXT,
    "status" "PrismaEmailMessageStatus" NOT NULL,
    "skip_reason" "PrismaEmailSkipReason",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "provider_message_id" VARCHAR(255),
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_idempotency_key_key" ON "email_messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "email_messages_status_next_attempt_at_idx" ON "email_messages"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "email_messages_invitation_id_created_at_idx" ON "email_messages"("invitation_id", "created_at");

-- CreateIndex
CREATE INDEX "email_messages_created_at_idx" ON "email_messages"("created_at");

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "contest_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "league_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A skip reason exactly on the skipped rows; a queued or claimed row always has a due time.
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_skip_reason_when_skipped"
    CHECK (("status" = 'SKIPPED') = ("skip_reason" IS NOT NULL));
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_due_when_queued"
    CHECK ("status" NOT IN ('QUEUED', 'SENDING') OR "next_attempt_at" IS NOT NULL);
