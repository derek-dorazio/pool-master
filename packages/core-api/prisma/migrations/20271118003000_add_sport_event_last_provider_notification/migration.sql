-- #1499: when the event's provider last sent a webhook notification about it.
ALTER TABLE "sport_events" ADD COLUMN "last_provider_notification_at" TIMESTAMPTZ;
