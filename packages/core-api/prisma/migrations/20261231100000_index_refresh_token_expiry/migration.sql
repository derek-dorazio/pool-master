-- #1175: the nightly cleanup deletes refresh tokens expired more than 30 days ago, and finds them
-- by this index rather than scanning the table.

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
