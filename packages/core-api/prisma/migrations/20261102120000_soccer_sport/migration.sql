-- #787: soccer joins the sport enum. The value is only added here, never used, so ALTER TYPE
-- ... ADD VALUE is safe inside this migration's transaction; the sports row, its sport leagues
-- and their contest templates, which use it, are the next migration.
ALTER TYPE "PrismaSport" ADD VALUE 'SOCCER';
