-- The event name search is a substring match (ILIKE '%term%'), which a btree index cannot serve;
-- a trigram GIN index can (#1301). pg_trgm was enabled by 20261230100000_trigram_search_indexes.

-- CreateIndex
CREATE INDEX "sport_events_name_trgm_idx" ON "sport_events" USING GIN ("name" gin_trgm_ops);
