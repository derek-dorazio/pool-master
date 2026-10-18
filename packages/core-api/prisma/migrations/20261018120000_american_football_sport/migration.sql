-- #702: American football joins the sport enum. The value is only added here, never used, so
-- ALTER TYPE ... ADD VALUE is safe inside this migration's transaction; the sports row, the NFL
-- sport league and its contest templates, which use it, are the next migration.
ALTER TYPE "PrismaSport" ADD VALUE 'AMERICAN_FOOTBALL';
