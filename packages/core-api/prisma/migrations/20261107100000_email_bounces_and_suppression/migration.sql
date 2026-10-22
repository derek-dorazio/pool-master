-- #844 SES slice 4: SES delivery events. Sent emails can become DELIVERED, BOUNCED or COMPLAINED, and
-- an address that bounced for good or complained goes on email_suppressions, so the app stops
-- emailing it (SKIPPED / SUPPRESSED) and can say why.
-- CreateEnum
CREATE TYPE "PrismaEmailSuppressionReason" AS ENUM ('BOUNCE', 'COMPLAINT');

-- AlterEnum
ALTER TYPE "PrismaEmailMessageStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "PrismaEmailMessageStatus" ADD VALUE 'BOUNCED';
ALTER TYPE "PrismaEmailMessageStatus" ADD VALUE 'COMPLAINED';

-- AlterEnum
ALTER TYPE "PrismaEmailSkipReason" ADD VALUE 'SUPPRESSED';

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "suppression_reason" "PrismaEmailSuppressionReason" NOT NULL,
    "email_message_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_email_key" ON "email_suppressions"("email");

-- CreateIndex
CREATE INDEX "email_messages_provider_message_id_idx" ON "email_messages"("provider_message_id");

-- AddForeignKey
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Addresses are stored lower-cased, so the unique index is case-insensitive in practice.
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_email_lower_case"
    CHECK ("email" = lower("email"));
