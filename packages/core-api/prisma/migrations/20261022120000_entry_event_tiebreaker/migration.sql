-- A prediction contest's tiebreaker is kept per event (#717): one guess per pick'em week, and a
-- bracket's on its one event. A roster contest's stays on the entry.
ALTER TABLE "contest_entry_events" ADD COLUMN "tiebreaker_value" INTEGER;

-- A bracket's guess moves from its entry to the entry's row for the bracket's one event.
INSERT INTO "contest_entry_events" ("contest_entry_id", "sport_event_id", "tiebreaker_value", "updated_at")
SELECT "contest_entries"."id", "contest_sport_events"."sport_event_id", "contest_entries"."tiebreaker_value", NOW()
FROM "contest_entries"
JOIN "contests" ON "contests"."id" = "contest_entries"."contest_id"
JOIN "contest_sport_events" ON "contest_sport_events"."contest_id" = "contests"."id"
WHERE "contests"."selection_type" = 'BRACKET' AND "contest_entries"."tiebreaker_value" IS NOT NULL
ON CONFLICT ("contest_entry_id", "sport_event_id") DO UPDATE SET "tiebreaker_value" = EXCLUDED."tiebreaker_value";

UPDATE "contest_entries" SET "tiebreaker_value" = NULL
FROM "contests"
WHERE "contests"."id" = "contest_entries"."contest_id" AND "contests"."selection_type" = 'BRACKET';
