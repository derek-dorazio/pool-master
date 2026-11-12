-- #1498: the job a provider's webhook queues to sync one linked event's live scores.
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'PROVIDER_EVENT_SYNC';
