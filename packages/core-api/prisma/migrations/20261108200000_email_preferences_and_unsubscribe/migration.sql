-- #844 SES slice 5: email preferences and unsubscribe. A member turns a category of email off on
-- their account or from an email's "Stop these emails" link (a row in email_opt_outs; no row
-- means on), and the app records any email in it as SKIPPED / OPTED_OUT. Emails a member can turn
-- off carry their one-click unsubscribe URL for the List-Unsubscribe header.
-- CreateEnum
CREATE TYPE "PrismaOptionalEmailCategory" AS ENUM ('COMMISSIONER_UPDATES', 'CONTEST_UPDATES', 'LIVE_STANDINGS', 'RESULTS', 'RECEIPTS');

-- AlterEnum
ALTER TYPE "PrismaEmailSkipReason" ADD VALUE 'OPTED_OUT';

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "list_unsubscribe_url" TEXT;

-- CreateTable
CREATE TABLE "email_opt_outs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "category" "PrismaOptionalEmailCategory" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_opt_outs_user_id_category_key" ON "email_opt_outs"("user_id", "category");

-- AddForeignKey
ALTER TABLE "email_opt_outs" ADD CONSTRAINT "email_opt_outs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

