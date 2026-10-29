-- #1230: refresh_tokens keeps the SHA-256 of each token, in hex, never the token itself, so a read
-- of the table hands out no live session. Existing rows are hashed in place, so members stay
-- signed in: the app hashes the token from their cookie and finds the same row.

-- DropIndex
DROP INDEX "refresh_tokens_token_key";

-- AlterTable
ALTER TABLE "refresh_tokens" RENAME COLUMN "token" TO "token_hash";
UPDATE "refresh_tokens" SET "token_hash" = encode(sha256(convert_to("token_hash", 'UTF8')), 'hex');
ALTER TABLE "refresh_tokens" ALTER COLUMN "token_hash" SET DATA TYPE CHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
