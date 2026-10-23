-- #893: the commissioner event emails ask which leagues an email was recorded from, every sweep.
CREATE INDEX "email_messages_template_key_league_id_idx" ON "email_messages"("template_key", "league_id");
