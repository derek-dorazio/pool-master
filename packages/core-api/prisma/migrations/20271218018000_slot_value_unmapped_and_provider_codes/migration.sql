-- League model slice 8 (#2005): the events sync matches games to Season slots by the code the
-- provider names their place by. A code no slot mapping includes raises an INFO finding.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'SLOT_VALUE_UNMAPPED';

-- The adapter's code is the provider's own value: its season type and its own week or round for
-- the game (the World Cup's stage order; a series playoff, whose games name no round, its series'
-- round in the bracket). Four leagues' seeded codes counted the postseason's places PoolMaster's
-- way instead, so they are set to the provider's. Each statement moves one code to a value no
-- other row of the league holds by then, since the mappings' unique key is checked row by row.
-- A league this database does not have changes nothing.

-- NFL: the provider numbers the postseason by week, with a gap before the Super Bowl (week 5).
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = v.value, "updated_at" = now()
FROM "sport_league_phase_slots" AS s, (VALUES ('FINAL', 'POST:5')) AS v(slot_key, value)
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = 'f91f2566-1978-4171-a706-ae417c4d601a'
  AND s."key" = v.slot_key AND m."match_type" = 'PROVIDER_CODE';

-- NBA: the play-in is its own season type, which the adapter does not read, so it maps no code;
-- the bracket's rounds are POST:1 to POST:4.
DELETE FROM "sport_league_phase_slot_provider_mappings" AS m
USING "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = '09f45f12-11be-43ac-bfa6-70a53f6e0169'
  AND s."key" = 'PLAY_IN' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:1', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = '09f45f12-11be-43ac-bfa6-70a53f6e0169' AND s."key" = 'ROUND_OF_16' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:2', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = '09f45f12-11be-43ac-bfa6-70a53f6e0169' AND s."key" = 'QUARTERFINAL' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:3', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = '09f45f12-11be-43ac-bfa6-70a53f6e0169' AND s."key" = 'SEMIFINAL' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:4', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = '09f45f12-11be-43ac-bfa6-70a53f6e0169' AND s."key" = 'FINAL' AND m."match_type" = 'PROVIDER_CODE';

-- NCAA women's: the provider numbers the First Four round 0 and the championship round 6 (the
-- men's run 1 to 7, as seeded).
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = v.value, "updated_at" = now()
FROM "sport_league_phase_slots" AS s, (VALUES ('PLAY_IN', 'POST:0')) AS v(slot_key, value)
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = 'ec248e1f-4468-4ecf-a9cf-51e02eebbf46' AND s."key" = v.slot_key AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:1', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = 'ec248e1f-4468-4ecf-a9cf-51e02eebbf46' AND s."key" = 'ROUND_OF_64' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:2', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = 'ec248e1f-4468-4ecf-a9cf-51e02eebbf46' AND s."key" = 'ROUND_OF_32' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:3', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = 'ec248e1f-4468-4ecf-a9cf-51e02eebbf46' AND s."key" = 'ROUND_OF_16' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:4', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = 'ec248e1f-4468-4ecf-a9cf-51e02eebbf46' AND s."key" = 'QUARTERFINAL' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:5', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = 'ec248e1f-4468-4ecf-a9cf-51e02eebbf46' AND s."key" = 'SEMIFINAL' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:6', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = 'ec248e1f-4468-4ecf-a9cf-51e02eebbf46' AND s."key" = 'FINAL' AND m."match_type" = 'PROVIDER_CODE';

-- World Cup: a knockout match's code is its stage's place in the provider's order of the
-- edition's stages, the group stage first: the round of 32 is stage 2 and the final stage 7.
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:7', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = '1015d5a8-22d1-482d-ba6a-d41c672e32b8' AND s."key" = 'FINAL' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:6', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = '1015d5a8-22d1-482d-ba6a-d41c672e32b8' AND s."key" = 'THIRD_PLACE' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:5', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = '1015d5a8-22d1-482d-ba6a-d41c672e32b8' AND s."key" = 'SEMIFINAL' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:4', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = '1015d5a8-22d1-482d-ba6a-d41c672e32b8' AND s."key" = 'QUARTERFINAL' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:3', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = '1015d5a8-22d1-482d-ba6a-d41c672e32b8' AND s."key" = 'ROUND_OF_16' AND m."match_type" = 'PROVIDER_CODE';
UPDATE "sport_league_phase_slot_provider_mappings" AS m SET "provider_value" = 'POST:2', "updated_at" = now()
FROM "sport_league_phase_slots" AS s
WHERE m."sport_league_phase_slot_id" = s."id" AND s."sport_league_id" = '1015d5a8-22d1-482d-ba6a-d41c672e32b8' AND s."key" = 'ROUND_OF_32' AND m."match_type" = 'PROVIDER_CODE';
