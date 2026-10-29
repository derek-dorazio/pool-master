-- Root admin and participant searches are substring matches (ILIKE '%term%'), which a btree index cannot
-- serve; trigram GIN indexes can (#1180). pg_trgm ships with Postgres and Aurora.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "leagues_name_trgm_idx" ON "leagues" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "participants_name_trgm_idx" ON "participants" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "participants_first_name_trgm_idx" ON "participants" USING GIN ("first_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "participants_last_name_trgm_idx" ON "participants" USING GIN ("last_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "participants_short_name_trgm_idx" ON "participants" USING GIN ("short_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "participants_team_affiliation_trgm_idx" ON "participants" USING GIN ("team_affiliation" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_email_trgm_idx" ON "users" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_username_trgm_idx" ON "users" USING GIN ("username" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_first_name_trgm_idx" ON "users" USING GIN ("first_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_last_name_trgm_idx" ON "users" USING GIN ("last_name" gin_trgm_ops);

