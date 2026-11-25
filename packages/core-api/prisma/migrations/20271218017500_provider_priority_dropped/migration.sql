-- League model 7c (#2073): a sport league syncs from the provider its selected provider mapping
-- names, so no provider serves a sport ahead of another. The priority, its unique index and its
-- range check go.
ALTER TABLE "providers" DROP CONSTRAINT "providers_priority_range";
DROP INDEX "providers_priority_key";
ALTER TABLE "providers" DROP COLUMN "priority";
