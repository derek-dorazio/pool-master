-- #788: hockey joins the sport enum, and its three periods join the match period layouts. Both
-- values are only added here, never used, so ALTER TYPE ... ADD VALUE is safe inside this
-- migration's transaction; the sports row, its sport leagues and their contest templates, which
-- use them, are the next migration.
ALTER TYPE "PrismaSport" ADD VALUE 'HOCKEY';
ALTER TYPE "PrismaMatchPeriodLayout" ADD VALUE 'THREE_PERIODS';
