-- The GOLF sport row, as reference data: it belongs to the schema's meaning, not to an
-- environment's contents.
--
-- Nothing created it. There is no Prisma seed in this repository, and no migration inserted it,
-- so every environment got it by a different accident: the local browser-e2e job ran its own
-- `INSERT ... ON CONFLICT DO NOTHING` (ci.yml, "Seed the golf sport"), the functional suites
-- upsert it for themselves, and QA simply "already had it" — an assumption ci.yml's comment
-- stated out loud and that the first QA reset falsified. The reset left `sports` empty, and the
-- app is not merely empty without the row, it is broken: `golfSportQueryOptions` throws "The
-- golf sport is not set up." and every golf admin list built on that query fails to render. The
-- post-deploy journey failed in act 1 waiting for a table that could not exist.
--
-- So it moves here, which is where this repository already keeps reference data:
-- `contest_config_templates` is seeded by 20260419213000_add_contest_config_templates and
-- evolved by later migrations. One source of truth, present the instant the schema is, in every
-- environment including a freshly reset one.
--
-- ON CONFLICT DO NOTHING, on the `name` unique: idempotent, and it does not overwrite a row an
-- environment has corrected by hand. `tournament_format` has no column default on purpose
-- (#236) — the table that discriminates between sports must not make a row a stroke-play golf
-- sport by omission — so it is stated. `category` has a DEFAULT of 'GOLF' and is stated anyway,
-- because relying on that default is what the #236 comment warns against.
--
-- GOLF only. It is the one sport the product implements: creating an event for any other is
-- refused with 422 SPORT_NOT_SUPPORTED, and `PrismaSportCategory` has no value for several of
-- the Sport enum's members, so seeding them all would invent rows nothing can use. A new sport
-- takes code as well as a row, so its row arrives in the migration that adds its support.

INSERT INTO "sports" ("id", "name", "participant_type", "category", "tournament_format", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'GOLF', 'INDIVIDUAL', 'GOLF', 'STROKE_PLAY_TOURNAMENT', NOW(), NOW())
ON CONFLICT ("name") DO NOTHING;
