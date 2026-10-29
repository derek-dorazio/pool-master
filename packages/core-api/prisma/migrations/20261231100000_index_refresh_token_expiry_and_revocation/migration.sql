-- #1175: the nightly cleanup deletes refresh tokens expired or revoked more than 30 days ago,
-- and finds them by these columns rather than scanning the table.

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_revoked_at_idx" ON "refresh_tokens"("revoked_at");

