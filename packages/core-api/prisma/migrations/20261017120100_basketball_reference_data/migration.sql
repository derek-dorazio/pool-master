-- #698: basketball's reference data. A separate migration from the one that adds BASKETBALL to the
-- sport enum, because a new enum value cannot be used in the transaction that added it.
--
-- The sports row: a team competes, and an event is a KNOCKOUT_BRACKET. Idempotent on the `sport`
-- unique, as the other sports' rows are.
INSERT INTO "sports" ("id", "sport", "participant_type", "tournament_format", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'BASKETBALL', 'TEAM', 'KNOCKOUT_BRACKET', NOW(), NOW())
ON CONFLICT ("sport") DO NOTHING;

-- The NCAA Division I men's and women's tournaments' sport leagues. Sport leagues are normally
-- created by an admin on the Manage pages, but the knockout contest templates (#699) name their
-- sport league, so these are reference data. The NBA and WNBA join later as data only. Idempotent
-- on the (sport_id, name) unique: an admin who already created either league keeps their row.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", league."name", TRUE, NOW(), NOW()
FROM "sports" s
CROSS JOIN (VALUES ('NCAA Division I Men'), ('NCAA Division I Women')) AS league("name")
WHERE s."sport" = 'BASKETBALL'
ON CONFLICT ("sport_id", "name") DO NOTHING;
