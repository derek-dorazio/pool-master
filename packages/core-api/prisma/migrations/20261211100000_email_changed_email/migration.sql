-- #903 A5: the email an account's old address gets when its email changes, and its one-time
-- "put my address back" link, stored only as the token's SHA-256.
-- AlterEnum
ALTER TYPE "PrismaEmailTemplateKey" ADD VALUE 'EMAIL_CHANGED';

-- CreateTable
CREATE TABLE "email_change_undo_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "old_email" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_change_undo_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_change_undo_tokens_token_hash_key" ON "email_change_undo_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_change_undo_tokens_user_id_created_at_idx" ON "email_change_undo_tokens"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "email_change_undo_tokens" ADD CONSTRAINT "email_change_undo_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

