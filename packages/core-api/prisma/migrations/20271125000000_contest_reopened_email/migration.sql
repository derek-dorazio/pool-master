-- "Picks are open again" (#1808): its email template and the job that queues it.
ALTER TYPE "PrismaEmailTemplateKey" ADD VALUE 'CONTEST_REOPENED';
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'CONTEST_REOPENED_EMAILS';
