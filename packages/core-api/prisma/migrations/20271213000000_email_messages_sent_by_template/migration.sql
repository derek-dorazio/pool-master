-- #1870: the root admin's Notifications page counts each email's sends of the last 30 days and
-- reads its latest send. Both read one range of sent_at per template key.
CREATE INDEX "email_messages_template_key_sent_at_idx" ON "email_messages"("template_key", "sent_at");
