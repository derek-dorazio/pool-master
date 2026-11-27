-- An event's own provider notification is recorded on its Games in play (#2008), as a game's is
-- on its Game (#2007): the event keeps no notification time of its own. A time an event holds
-- moves to its Games in progress that have none, or an older one, so the quiet check keeps it.
UPDATE "sport_event_round_match_games" AS g
SET "last_provider_notification_at" = e."last_provider_notification_at"
FROM "sport_events" AS e
WHERE g."sport_event_id" = e."id"
  AND g."status" = 'IN_PROGRESS'
  AND e."last_provider_notification_at" IS NOT NULL
  AND (g."last_provider_notification_at" IS NULL OR g."last_provider_notification_at" < e."last_provider_notification_at");

ALTER TABLE "sport_events" DROP COLUMN "last_provider_notification_at";
