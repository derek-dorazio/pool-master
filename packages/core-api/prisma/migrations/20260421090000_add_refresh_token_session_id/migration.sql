ALTER TABLE "refresh_tokens"
  ADD COLUMN "session_id" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");
