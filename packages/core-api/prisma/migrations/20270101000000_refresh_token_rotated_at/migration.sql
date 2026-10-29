-- #1229: when a refresh replaced the token, so a rotated token that comes back ends its session.

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "rotated_at" TIMESTAMPTZ;

