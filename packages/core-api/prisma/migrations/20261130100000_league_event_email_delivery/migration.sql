-- #851 part 3: how a league's commissioners hear about upcoming events, one email per event or a
-- weekly digest, and the digest's email.
CREATE TYPE "PrismaEventEmailDelivery" AS ENUM ('PER_EVENT', 'WEEKLY_DIGEST');
ALTER TABLE "leagues" ADD COLUMN "event_email_delivery" "PrismaEventEmailDelivery" NOT NULL DEFAULT 'PER_EVENT';
ALTER TYPE "PrismaEmailTemplateKey" ADD VALUE 'EVENT_WEEKLY_DIGEST';
