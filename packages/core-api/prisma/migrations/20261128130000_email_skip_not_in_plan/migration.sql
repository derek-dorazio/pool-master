-- AlterEnum: an optional email the league's plan lacks is recorded as skipped (#948).
ALTER TYPE "PrismaEmailSkipReason" ADD VALUE 'NOT_IN_PLAN';
