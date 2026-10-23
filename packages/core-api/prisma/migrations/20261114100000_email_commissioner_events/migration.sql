-- #845 catalog slice 5: an event coming up, an event ready for contests, a contest not open yet (C1, C2, C4).
ALTER TYPE "PrismaEmailTemplateKey" ADD VALUE 'EVENT_COMING_UP';
ALTER TYPE "PrismaEmailTemplateKey" ADD VALUE 'EVENT_READY_FOR_CONTESTS';
ALTER TYPE "PrismaEmailTemplateKey" ADD VALUE 'CONTEST_NOT_OPEN';
