-- The contest template data pass (#2164), from the owner's review of every seeded template on
-- 2026-11-26, and random draw's new name on screen, Sweepstakes (#2174). Data only.
--
-- - Seeded playoffs get seed-range tier profiles, and fields with no seeds a profile that orders
--   by odds and has no SEED source. Whether a league's tier profile lists SEED is what says its
--   field has seeds, and so whether its knockout templates carry the upset bonus.
-- - Each playoff of more than eight teams gets one tiered and one budget template, every pick
--   counting, as the NFL's pair (#2160). Smaller playoffs lose theirs.
-- - Every knockout random draw and bracket comes as Straight up (1 point a win), Escalating
--   (doubling) and Full (doubling plus the seed-difference upset bonus, the default) where the
--   field has seeds; Straight up and Escalating (the default) where it has none.
-- - Second-chance and second-week brackets, tennis survivor, and the squares of every hockey and
--   soccer league go. March Madness squares cover the final only (#2166 brings the rest back).
-- - NCAA soccer keeps one bracket and one random draw. Tennis and golf tiered and budget become
--   all-count and best-4 pairs; Formula 1's tiered counts all five.
--
-- Leagues are found by their URL segment, a unique key. What names a removed template (an event
-- page's offer, a contest's configuration) is moved to the template that replaces it, of the same
-- selection type. A removed template with no replacement of its kind (a format the league no
-- longer offers) takes its offers with it and leaves its contests on their own rules, with no
-- template named.

-- Tier profiles ------------------------------------------------------------------------------

INSERT INTO "platform_tier_profiles" ("code", "name", "type", "updated_at") VALUES
  ('SEEDS_4_8_12', 'Playoff seeds: top 4, 5-8, 9-12', 'RANGES', CURRENT_TIMESTAMP),
  ('SEEDS_2_5_REST', 'Playoff seeds: top 2, 3-5, 6+', 'RANGES', CURRENT_TIMESTAMP),
  ('SEEDS_2_4_REST', 'Playoff seeds: top 2, 3-4, 5+', 'RANGES', CURRENT_TIMESTAMP),
  ('SEEDS_3_6_REST', 'Playoff seeds: top 3, 4-6, 7+', 'RANGES', CURRENT_TIMESTAMP),
  ('REGION_SEED_LINES_4', 'Seed lines: 1-4, 5-8, 9-12, 13+', 'RANGES', CURRENT_TIMESTAMP),
  ('REGION_SEEDS_EACH', 'Seed lines: each of 1, 2, 3, 4', 'RANGES', CURRENT_TIMESTAMP);

INSERT INTO "platform_tier_profile_ranges" ("platform_tier_profile_id", "tier_number", "from_value", "to_value")
SELECT p."id", r."tier_number", r."from_value", r."to_value"
FROM "platform_tier_profiles" p
JOIN (VALUES
  ('SEEDS_4_8_12', 1, 1, 4), ('SEEDS_4_8_12', 2, 5, 8), ('SEEDS_4_8_12', 3, 9, 12),
  ('SEEDS_2_5_REST', 1, 1, 2), ('SEEDS_2_5_REST', 2, 3, 5), ('SEEDS_2_5_REST', 3, 6, NULL),
  ('SEEDS_2_4_REST', 1, 1, 2), ('SEEDS_2_4_REST', 2, 3, 4), ('SEEDS_2_4_REST', 3, 5, NULL),
  ('SEEDS_3_6_REST', 1, 1, 3), ('SEEDS_3_6_REST', 2, 4, 6), ('SEEDS_3_6_REST', 3, 7, NULL),
  ('REGION_SEED_LINES_4', 1, 1, 4), ('REGION_SEED_LINES_4', 2, 5, 8), ('REGION_SEED_LINES_4', 3, 9, 12), ('REGION_SEED_LINES_4', 4, 13, NULL),
  ('REGION_SEEDS_EACH', 1, 1, 1), ('REGION_SEEDS_EACH', 2, 2, 2), ('REGION_SEEDS_EACH', 3, 3, 3), ('REGION_SEEDS_EACH', 4, 4, 4)
) AS r("code", "tier_number", "from_value", "to_value") ON r."code" = p."code";

-- Fields with no seeds: equal groups by odds, then ranking.
INSERT INTO "platform_tier_profiles" ("code", "name", "type", "tier_count", "tier_size", "last_tier", "updated_at") VALUES
  ('TIERS_4_OF_4_BY_ODDS', '4 tiers of 4, by odds', 'EQUAL_GROUPS', 4, 4, 'ALL_REMAINING', CURRENT_TIMESTAMP),
  ('TIERS_4_OF_8_BY_ODDS', '4 tiers of 8, by odds', 'EQUAL_GROUPS', 4, 8, 'ALL_REMAINING', CURRENT_TIMESTAMP);

INSERT INTO "platform_tier_profile_sources" ("platform_tier_profile_id", "order_index", "basis")
SELECT p."id", s."order_index", s."basis"::"PrismaFieldOrderBasis"
FROM "platform_tier_profiles" p
CROSS JOIN (VALUES (0, 'SEED'), (1, 'ODDS'), (2, 'RANKING')) AS s("order_index", "basis")
WHERE p."code" IN ('SEEDS_4_8_12', 'SEEDS_2_5_REST', 'SEEDS_2_4_REST', 'SEEDS_3_6_REST', 'REGION_SEED_LINES_4', 'REGION_SEEDS_EACH');

INSERT INTO "platform_tier_profile_sources" ("platform_tier_profile_id", "order_index", "basis")
SELECT p."id", s."order_index", s."basis"::"PrismaFieldOrderBasis"
FROM "platform_tier_profiles" p
CROSS JOIN (VALUES (0, 'ODDS'), (1, 'RANKING')) AS s("order_index", "basis")
WHERE p."code" IN ('TIERS_4_OF_4_BY_ODDS', 'TIERS_4_OF_8_BY_ODDS');

-- Each league's tier and pricing profile; the two start with the same source.
UPDATE "sport_leagues" l
SET "platform_tier_profile_id" = tp."id", "platform_pricing_profile_id" = pp."id", "updated_at" = CURRENT_TIMESTAMP
FROM (VALUES
  ('ncaamf', 'SEEDS_4_8_12', 'STANDARD_BY_SEED'),
  ('nba', 'SEEDS_2_5_REST', 'STANDARD_BY_SEED'),
  ('nhl', 'SEEDS_2_5_REST', 'STANDARD_BY_SEED'),
  ('mlb', 'SEEDS_2_4_REST', 'STANDARD_BY_SEED'),
  ('mls', 'SEEDS_3_6_REST', 'STANDARD_BY_SEED'),
  ('ncaamb', 'REGION_SEED_LINES_4', 'STANDARD_BY_SEED'),
  ('ncaawb', 'REGION_SEED_LINES_4', 'STANDARD_BY_SEED'),
  ('ncaamh', 'REGION_SEEDS_EACH', 'STANDARD_BY_SEED'),
  ('world-cup', 'TIERS_4_OF_8_BY_ODDS', 'STANDARD'),
  ('womens-world-cup', 'TIERS_4_OF_4_BY_ODDS', 'STANDARD'),
  ('euro', 'TIERS_4_OF_4_BY_ODDS', 'STANDARD'),
  ('copa-america', 'TIERS_4_OF_4_BY_ODDS', 'STANDARD'),
  ('ucl', 'TIERS_4_OF_4_BY_ODDS', 'STANDARD')
) AS a("url_segment", "tier_code", "pricing_code")
JOIN "platform_tier_profiles" tp ON tp."code" = a."tier_code"
JOIN "platform_pricing_profiles" pp ON pp."code" = a."pricing_code"
WHERE l."url_segment" = a."url_segment";

-- New templates --------------------------------------------------------------------------------

-- Each new template is copied from a template the league has today (its league, kind, coverage
-- and scoring) and covers the same slots.
CREATE TEMP TABLE "_new_templates" (
  "url_segment" TEXT NOT NULL,
  "from_key" TEXT NOT NULL,
  "template_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "config_json" JSONB NOT NULL,
  "sort_after" INTEGER NOT NULL
);

-- One tiered and one budget template per playoff of more than eight teams: one pick per tier,
-- the budget the same number of picks, every pick counting, scored as the league's Escalating
-- template is today. The description keeps the league's own scoring sentence.
INSERT INTO "_new_templates"
SELECT l."url_segment", f."key", n."template_key", n."name",
       n."lead" || ' ' || substring(f."description" FROM '\. (.*)$'),
       CASE WHEN n."kind" = 'TIERED'
         THEN jsonb_build_object('selectionType', 'TIERED', 'picksPerTier', 1, 'countedScores', n."picks", 'maxEntriesPerSquad', 1, 'scoring', f."config_json"->'scoring')
         ELSE jsonb_build_object('selectionType', 'BUDGET_PICK', 'rosterSize', n."picks", 'countedScores', n."picks", 'maxEntriesPerSquad', 1, 'scoring', f."config_json"->'scoring')
       END,
       f."sort_order"
FROM (VALUES
  ('ncaamf', 'TIERED', 'cfp-tiered-doubling', 'cfp-tiered-pick-3', 3, 'Tiered: 1 team from each of 3 tiers, doubling points', 'Pick one team from each tier: the 1 to 4 seeds, the 5 to 8 seeds, and the 9 to 12 seeds.'),
  ('ncaamf', 'BUDGET_PICK', 'cfp-budget-doubling', 'cfp-budget-pick-3', 3, 'Budget: 3 teams under the cap, doubling points', 'Every team has a price: pick three whose prices fit under the salary cap.'),
  ('nba', 'TIERED', 'nba-tiered-doubling', 'nba-tiered-pick-3', 3, 'Tiered: 1 team from each of 3 tiers, doubling points', 'Pick one team from each tier: the 1 and 2 seeds, the 3 to 5 seeds, and the rest.'),
  ('nba', 'BUDGET_PICK', 'nba-budget-doubling', 'nba-budget-pick-3', 3, 'Budget: 3 teams under the cap, doubling points', 'Every team has a price: pick three whose prices fit under the salary cap.'),
  ('nhl', 'TIERED', 'nhl-tiered-doubling', 'nhl-tiered-pick-3', 3, 'Tiered: 1 team from each of 3 tiers, doubling points', 'Pick one team from each tier: the 1 and 2 seeds, the 3 to 5 seeds, and the rest.'),
  ('nhl', 'BUDGET_PICK', 'nhl-budget-doubling', 'nhl-budget-pick-3', 3, 'Budget: 3 teams under the cap, doubling points', 'Every team has a price: pick three whose prices fit under the salary cap.'),
  ('mlb', 'TIERED', 'mlb-tiered-doubling', 'mlb-tiered-pick-3', 3, 'Tiered: 1 team from each of 3 tiers, doubling points', 'Pick one team from each tier: the 1 and 2 seeds, the 3 and 4 seeds, and the rest.'),
  ('mlb', 'BUDGET_PICK', 'mlb-budget-doubling', 'mlb-budget-pick-3', 3, 'Budget: 3 teams under the cap, doubling points', 'Every team has a price: pick three whose prices fit under the salary cap.'),
  ('mls', 'TIERED', 'mls-tiered-doubling', 'mls-tiered-pick-3', 3, 'Tiered: 1 team from each of 3 tiers, doubling points', 'Pick one team from each tier: the 1 to 3 seeds, the 4 to 6 seeds, and the rest.'),
  ('mls', 'BUDGET_PICK', 'mls-budget-doubling', 'mls-budget-pick-3', 3, 'Budget: 3 teams under the cap, doubling points', 'Every team has a price: pick three whose prices fit under the salary cap.'),
  ('ncaamb', 'TIERED', 'ncaa-men-tiered-doubling', 'ncaa-men-tiered-pick-4', 4, 'Tiered: 1 team from each of 4 tiers, doubling points', 'Pick one team from each tier of seed lines: 1 to 4, 5 to 8, 9 to 12, and 13 to 16.'),
  ('ncaamb', 'BUDGET_PICK', 'ncaa-men-budget-doubling', 'ncaa-men-budget-pick-4', 4, 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap.'),
  ('ncaawb', 'TIERED', 'ncaa-women-tiered-doubling', 'ncaa-women-tiered-pick-4', 4, 'Tiered: 1 team from each of 4 tiers, doubling points', 'Pick one team from each tier of seed lines: 1 to 4, 5 to 8, 9 to 12, and 13 to 16.'),
  ('ncaawb', 'BUDGET_PICK', 'ncaa-women-budget-doubling', 'ncaa-women-budget-pick-4', 4, 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap.'),
  ('ncaamh', 'TIERED', 'ncaa-men-hockey-tiered-doubling', 'ncaa-men-hockey-tiered-pick-4', 4, 'Tiered: 1 team from each of 4 tiers, doubling points', 'Pick one team from each tier: the 1 seeds, the 2 seeds, the 3 seeds, and the 4 seeds.'),
  ('ncaamh', 'BUDGET_PICK', 'ncaa-men-hockey-budget-doubling', 'ncaa-men-hockey-budget-pick-4', 4, 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap.'),
  ('world-cup', 'TIERED', 'world-cup-tiered-doubling', 'world-cup-tiered-pick-4', 4, 'Tiered: 1 team from each of 4 tiers, doubling points', 'Pick one team from each of the four tiers, set by the odds.'),
  ('world-cup', 'BUDGET_PICK', 'world-cup-budget-doubling', 'world-cup-budget-pick-4', 4, 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap.'),
  ('womens-world-cup', 'TIERED', 'womens-world-cup-tiered-doubling', 'womens-world-cup-tiered-pick-4', 4, 'Tiered: 1 team from each of 4 tiers, doubling points', 'Pick one team from each of the four tiers, set by the odds.'),
  ('womens-world-cup', 'BUDGET_PICK', 'womens-world-cup-budget-doubling', 'womens-world-cup-budget-pick-4', 4, 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap.'),
  ('euro', 'TIERED', 'euro-tiered-doubling', 'euro-tiered-pick-4', 4, 'Tiered: 1 team from each of 4 tiers, doubling points', 'Pick one team from each of the four tiers, set by the odds.'),
  ('euro', 'BUDGET_PICK', 'euro-budget-doubling', 'euro-budget-pick-4', 4, 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap.'),
  ('ucl', 'TIERED', 'champions-league-tiered-doubling', 'champions-league-tiered-pick-4', 4, 'Tiered: 1 team from each of 4 tiers, doubling points', 'Pick one team from each of the four tiers, set by the odds.'),
  ('ucl', 'BUDGET_PICK', 'champions-league-budget-doubling', 'champions-league-budget-pick-4', 4, 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap.')
) AS n("url_segment", "kind", "from_key", "template_key", "picks", "name", "lead")
JOIN "sport_leagues" l ON l."url_segment" = n."url_segment"
JOIN LATERAL (
  SELECT t."template_key" AS "key", t."description", t."config_json", t."sort_order"
  FROM "contest_config_templates" t WHERE t."sport_league_id" = l."id" AND t."template_key" = n."from_key"
) f ON true;

-- Straight up: every knockout random draw and bracket scored by round gets one, 1 point for each
-- win or right pick in every round, beside today's Escalating one. NCAA soccer, which keeps one
-- template of each, is the stated exception.
INSERT INTO "_new_templates"
SELECT l."url_segment", t."template_key",
       regexp_replace(t."template_key", '-doubling$', '-straight-up'),
       replace(t."name", ', doubling points', CASE WHEN t."selection_type" = 'BRACKET' THEN ', 1 point a pick' ELSE ', 1 point a win' END),
       regexp_replace(t."description", 'scores 1 point (in|on) .*$', 'scores 1 point in every round.'),
       jsonb_set(t."config_json", '{scoring,config,roundValues}',
         (SELECT jsonb_agg(1) FROM jsonb_array_elements(t."config_json"->'scoring'->'config'->'roundValues'))),
       t."sort_order" - 1
FROM "contest_config_templates" t
JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
WHERE t."selection_type" IN ('RANDOM_DRAW', 'BRACKET')
  AND t."template_key" ~ '-(random-draw|bracket)-doubling$'
  AND t."config_json"->'scoring'->>'participantScoringDefinitionId' = 'KNOCKOUT_ROUND_POINTS'
  AND l."url_segment" NOT IN ('ncaams', 'ncaaws');

-- Tennis: best 4 count, scored Full, beside the all-count tiered and budget templates.
INSERT INTO "_new_templates"
SELECT l."url_segment", t."template_key", regexp_replace(t."template_key", n."from_suffix" || '$', n."new_suffix"), n."name",
       regexp_replace(regexp_replace(t."description", 'salary cap\.', 'salary cap; your best four count.'), '\.$', ', plus the seed difference for an upset.'),
       jsonb_set(t."config_json", '{scoring}', full_t."config_json"->'scoring')
         || CASE WHEN t."selection_type" = 'BUDGET_PICK' THEN '{"countedScores": 4}'::jsonb ELSE '{}'::jsonb END,
       full_t."sort_order" + 1
FROM (VALUES
  ('-tiered-best-four-doubling', '-tiered-doubling-upset-bonus', '-tiered-best-four-doubling-upset-bonus', 'Tiered: 1 player per tier, best 4, doubling + upset bonus'),
  ('-budget-doubling', '-budget-doubling-upset-bonus', '-budget-best-four-doubling-upset-bonus', 'Budget: 6 players, best 4 count, doubling + upset bonus')
) AS n("from_suffix", "full_suffix", "new_suffix", "name")
JOIN "sport_leagues" l ON l."url_segment" IN ('atp', 'wta', 'ncaamt', 'ncaawt')
JOIN "contest_config_templates" t ON t."sport_league_id" = l."id" AND t."template_key" LIKE '%' || n."from_suffix"
JOIN "contest_config_templates" full_t ON full_t."sport_league_id" = l."id"
  AND full_t."template_key" = regexp_replace(t."template_key", n."from_suffix" || '$', n."full_suffix");

-- Golf: 1 golfer per tier, all count, the twin of the all-count budget template.
INSERT INTO "_new_templates"
SELECT l."url_segment", t."template_key", 'golf-tiered-pick-6-all-count', 'Tiered: 1 golfer per tier, all count',
       'Pick one golfer from each tier of the field. All six golfers'' scores count.',
       t."config_json" || '{"countedScores": 6}'::jsonb,
       t."sort_order" + 1
FROM "contest_config_templates" t
JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
WHERE l."url_segment" IN ('pga', 'lpga') AND t."template_key" = 'golf-tiered-pick-6';

INSERT INTO "contest_config_templates" ("sport_league_id", "contest_type", "selection_type", "template_key", "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at", "coverage_mode")
SELECT t."sport_league_id", t."contest_type", t."selection_type", n."template_key", n."name", n."description", n."sort_after", false, true, n."config_json", t."schema_version", CURRENT_TIMESTAMP, t."coverage_mode"
FROM "_new_templates" n
JOIN "sport_leagues" l ON l."url_segment" = n."url_segment"
JOIN "contest_config_templates" t ON t."sport_league_id" = l."id" AND t."template_key" = n."from_key";

INSERT INTO "contest_config_template_slots" ("sport_league_id", "template_id", "sport_league_competition_slot_id")
SELECT nt."sport_league_id", nt."id", s."sport_league_competition_slot_id"
FROM "_new_templates" n
JOIN "sport_leagues" l ON l."url_segment" = n."url_segment"
JOIN "contest_config_templates" ft ON ft."sport_league_id" = l."id" AND ft."template_key" = n."from_key"
JOIN "contest_config_templates" nt ON nt."sport_league_id" = l."id" AND nt."template_key" = n."template_key"
JOIN "contest_config_template_slots" s ON s."template_id" = ft."id";

-- Removed templates ----------------------------------------------------------------------------

-- Each removed template, and the one of its kind that replaces it (none: the league no longer
-- offers that kind).
CREATE TEMP TABLE "_removed_templates" (
  "sport_league_id" UUID NOT NULL,
  "template_key" TEXT NOT NULL,
  "replaced_by" TEXT
);

-- Tiered and budget variants, replaced by the league's new pair.
INSERT INTO "_removed_templates"
SELECT t."sport_league_id", t."template_key", n."template_key"
FROM "_new_templates" n
JOIN "sport_leagues" l ON l."url_segment" = n."url_segment"
JOIN "contest_config_templates" t ON t."sport_league_id" = l."id"
  AND t."template_key" IN (n."from_key", n."from_key" || '-upset-bonus')
WHERE n."template_key" ~ '-(tiered|budget)-pick-[0-9]+$';

-- Tiered and budget on playoffs of eight teams or fewer, and on NCAA soccer: none.
INSERT INTO "_removed_templates"
SELECT t."sport_league_id", t."template_key", NULL
FROM "contest_config_templates" t
JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
WHERE l."url_segment" IN ('copa-america', 'pwhl', 'nwsl', 'wnba', 'ncaawh', 'ncaams', 'ncaaws')
  AND t."selection_type" IN ('TIERED', 'BUDGET_PICK');

-- Second-chance and second-week brackets: the league's Escalating bracket, the same scoring. An
-- event page offer keeps its own starting round.
INSERT INTO "_removed_templates"
SELECT t."sport_league_id", t."template_key", regexp_replace(t."template_key", '-bracket-second-(chance|week)-doubling$', '-bracket-doubling')
FROM "contest_config_templates" t
WHERE t."template_key" ~ '-bracket-second-(chance|week)-doubling$';

-- The upset bonus where the field has no seeds: the Escalating template of its kind.
INSERT INTO "_removed_templates"
SELECT t."sport_league_id", t."template_key", regexp_replace(t."template_key", '-upset-bonus$', '')
FROM "contest_config_templates" t
JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
WHERE l."url_segment" IN ('world-cup', 'womens-world-cup', 'euro', 'copa-america', 'ucl')
  AND t."template_key" ~ '-(random-draw|bracket)-doubling-upset-bonus$';

-- NCAA soccer keeps its Full random draw and its Escalating bracket.
INSERT INTO "_removed_templates"
SELECT t."sport_league_id", t."template_key",
       CASE WHEN t."selection_type" = 'RANDOM_DRAW' THEN t."template_key" || '-upset-bonus'
            WHEN t."selection_type" = 'BRACKET' THEN regexp_replace(t."template_key", '-upset-bonus$', '') END
FROM "contest_config_templates" t
JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
WHERE l."url_segment" IN ('ncaams', 'ncaaws')
  AND (t."template_key" ~ '-random-draw-doubling$' OR t."template_key" ~ '-bracket-doubling-upset-bonus$');

INSERT INTO "_removed_templates"
SELECT t."sport_league_id", t."template_key", NULL
FROM "contest_config_templates" t
JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
WHERE l."url_segment" IN ('ncaams', 'ncaaws') AND t."selection_type" = 'SURVIVOR';

-- Squares only on football and March Madness.
INSERT INTO "_removed_templates"
SELECT t."sport_league_id", t."template_key", NULL
FROM "contest_config_templates" t
JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
WHERE l."url_segment" IN ('ncaamh', 'ncaawh', 'world-cup', 'womens-world-cup', 'euro', 'copa-america', 'ucl', 'mls', 'nwsl', 'ncaams', 'ncaaws')
  AND t."selection_type" = 'SQUARES';

-- Tennis: no survivor; tiered and budget only as the all-count and best-4 pairs, scored Full.
INSERT INTO "_removed_templates"
SELECT t."sport_league_id", t."template_key",
       CASE
         WHEN t."selection_type" = 'SURVIVOR' THEN NULL
         WHEN t."template_key" ~ '-tiered-doubling$' THEN t."template_key" || '-upset-bonus'
         WHEN t."template_key" ~ '-budget-doubling$' THEN t."template_key" || '-upset-bonus'
         ELSE regexp_replace(t."template_key", '-tiered-(seeds-only|best-four)-doubling$', '-tiered-best-four-doubling-upset-bonus')
       END
FROM "contest_config_templates" t
JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
WHERE l."url_segment" IN ('atp', 'wta', 'ncaamt', 'ncaawt')
  AND (t."selection_type" = 'SURVIVOR' OR t."template_key" ~ '-(tiered|tiered-seeds-only|tiered-best-four|budget)-doubling$');

-- Golf: 2 per tier goes to the best-4 tiered template; the top 4 tiers to the all-count one.
INSERT INTO "_removed_templates"
SELECT t."sport_league_id", t."template_key",
       CASE t."template_key" WHEN 'golf-tiered-pick-12' THEN 'golf-tiered-pick-6' ELSE 'golf-tiered-pick-6-all-count' END
FROM "contest_config_templates" t
JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
WHERE l."url_segment" IN ('pga', 'lpga') AND t."template_key" IN ('golf-tiered-pick-12', 'golf-tiered-top-four-tiers');

-- What named a removed template names its replacement.
UPDATE "event_page_offers" o
SET "template_id" = n."id", "updated_at" = CURRENT_TIMESTAMP
FROM "_removed_templates" r
JOIN "contest_config_templates" old_t ON old_t."sport_league_id" = r."sport_league_id" AND old_t."template_key" = r."template_key"
JOIN "contest_config_templates" n ON n."sport_league_id" = r."sport_league_id" AND n."template_key" = r."replaced_by"
WHERE o."template_id" = old_t."id";

UPDATE "contest_configurations" c
SET "template_id" = n."id", "updated_at" = CURRENT_TIMESTAMP
FROM "_removed_templates" r
JOIN "contest_config_templates" old_t ON old_t."sport_league_id" = r."sport_league_id" AND old_t."template_key" = r."template_key"
JOIN "contest_config_templates" n ON n."sport_league_id" = r."sport_league_id" AND n."template_key" = r."replaced_by"
WHERE c."template_id" = old_t."id";

-- A format the league no longer offers takes its event page offers with it; its contests keep
-- their own rules (the template link is cleared by its ON DELETE SET NULL).
DELETE FROM "event_page_offers" o
USING "_removed_templates" r
JOIN "contest_config_templates" old_t ON old_t."sport_league_id" = r."sport_league_id" AND old_t."template_key" = r."template_key"
WHERE o."template_id" = old_t."id" AND r."replaced_by" IS NULL;

DELETE FROM "contest_config_templates" t
USING "_removed_templates" r
WHERE t."sport_league_id" = r."sport_league_id" AND t."template_key" = r."template_key";

-- Changed templates ----------------------------------------------------------------------------

-- March Madness squares cover the final only at launch.
DELETE FROM "contest_config_template_slots" ts
USING "contest_config_templates" t, "sport_leagues" l, "sport_league_competition_slots" s
WHERE ts."template_id" = t."id" AND l."id" = t."sport_league_id" AND s."id" = ts."sport_league_competition_slot_id"
  AND l."url_segment" IN ('ncaamb', 'ncaawb') AND t."selection_type" = 'SQUARES' AND s."slot_kind" <> 'FINAL';

-- Formula 1's tiered template counts all five drivers, as its budget twin does.
UPDATE "contest_config_templates" t
SET "config_json" = t."config_json" || '{"countedScores": 5}'::jsonb,
    "description" = 'Pick one driver from each of the five tiers of the field. Each driver scores Formula 1 points, 25 for the win down to 1 for tenth.',
    "updated_at" = CURRENT_TIMESTAMP
FROM "sport_leagues" l
WHERE l."id" = t."sport_league_id" AND l."url_segment" = 'f1' AND t."template_key" = 'formula-1-tiered-points';

-- Defaults: the new tiered and budget pairs; tennis's all-count Full pair; and Full for random
-- draw and bracket wherever the league's tier profile orders by seed, so its field has seeds.
UPDATE "contest_config_templates" t SET "is_default" = false, "updated_at" = CURRENT_TIMESTAMP
FROM "sport_leagues" l
WHERE l."id" = t."sport_league_id" AND t."is_default"
  AND (
    (t."selection_type" IN ('TIERED', 'BUDGET_PICK') AND EXISTS (
      SELECT 1 FROM "_new_templates" n WHERE n."url_segment" = l."url_segment" AND n."template_key" ~ '-(tiered|budget)-pick-[0-9]+$'))
    OR (t."selection_type" IN ('TIERED', 'BUDGET_PICK') AND l."url_segment" IN ('atp', 'wta', 'ncaamt', 'ncaawt'))
    OR (t."selection_type" IN ('RANDOM_DRAW', 'BRACKET') AND EXISTS (
      SELECT 1 FROM "contest_config_templates" f
      WHERE f."sport_league_id" = t."sport_league_id" AND f."selection_type" = t."selection_type" AND f."template_key" ~ '-doubling-upset-bonus$'))
  );

UPDATE "contest_config_templates" t SET "is_default" = true, "updated_at" = CURRENT_TIMESTAMP
FROM "sport_leagues" l
WHERE l."id" = t."sport_league_id"
  AND (
    t."template_key" ~ '-(tiered|budget)-pick-[0-9]+$'
    OR (l."url_segment" IN ('atp', 'wta', 'ncaamt', 'ncaawt') AND t."template_key" ~ '-(tiered|budget)-doubling-upset-bonus$')
    OR (t."selection_type" IN ('RANDOM_DRAW', 'BRACKET') AND t."template_key" ~ '-doubling-upset-bonus$')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "contest_config_templates" d
    WHERE d."sport_league_id" = t."sport_league_id" AND d."selection_type" = t."selection_type" AND d."is_default");

-- The upset bonus is kept only where the field has seeds.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "contest_config_templates" t
    JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
    WHERE t."config_json"->'scoring'->'config'->'upsetBonus'->>'rule' = 'SEED_DIFFERENCE'
      AND NOT EXISTS (
        SELECT 1 FROM "platform_tier_profile_sources" s
        WHERE s."platform_tier_profile_id" = l."platform_tier_profile_id" AND s."basis" = 'SEED')
  ) THEN
    RAISE EXCEPTION 'An upset bonus template is left on a league whose field has no seeds';
  END IF;
END $$;

-- Random draw is called Sweepstakes on screen (#2174).
UPDATE "contest_config_templates"
SET "name" = 'Sweepstakes:' || substring("name" FROM length('Quick pick:') + 1), "updated_at" = CURRENT_TIMESTAMP
WHERE "name" LIKE 'Quick pick:%';

-- Each knockout league's templates in order: tiered, budget, random draw, pick'em, bracket,
-- survivor, squares; Straight up before Escalating before Full.
UPDATE "contest_config_templates" t
SET "sort_order" = o."position", "updated_at" = CURRENT_TIMESTAMP
FROM (
  SELECT t2."id", row_number() OVER (
    PARTITION BY t2."sport_league_id"
    ORDER BY
      array_position(ARRAY['TIERED', 'BUDGET_PICK', 'RANDOM_DRAW', 'PICK_EM', 'BRACKET', 'SURVIVOR', 'SQUARES'], t2."selection_type"::text),
      CASE WHEN t2."template_key" ~ '-straight-up$' THEN 0 WHEN t2."template_key" ~ '-upset-bonus$' THEN 2 ELSE 1 END,
      t2."sort_order",
      t2."template_key"
  ) AS "position"
  FROM "contest_config_templates" t2
  JOIN "sport_leagues" l ON l."id" = t2."sport_league_id"
  WHERE l."scoring_family" = 'HEAD_TO_HEAD'
) o
WHERE o."id" = t."id";

DROP TABLE "_removed_templates";
DROP TABLE "_new_templates";
