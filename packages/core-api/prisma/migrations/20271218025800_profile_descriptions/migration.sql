-- #2194: every tier and pricing profile describes itself (rules/domain-model-conventions-rules.md §10
-- *Naming Disambiguation*, *A profile or definition row describes itself*). The description is plain English for
-- agents and root admins: what the profile is and why it exists. What commissioners and members
-- read about a profile is display strings keyed by its code, not this column.
--
-- Each seeded profile is found by its code. A profile a root admin added on screen has no seeded
-- description, so it says so, and a root admin writes one on the Profiles tab.

ALTER TABLE "platform_tier_profiles" ADD COLUMN "description" VARCHAR(500);
ALTER TABLE "platform_pricing_profiles" ADD COLUMN "description" VARCHAR(500);

UPDATE "platform_tier_profiles" p
SET "description" = d."description", "updated_at" = CURRENT_TIMESTAMP
FROM (VALUES
  ('PLAYOFF_SEEDS_1_4_REST', 'Three tiers by playoff seed: the 1 seeds, the 2 to 4 seeds, then every seed from 5 on. For a playoff field seeded within two conferences of seven, so each tier holds teams of like standing.'),
  ('SEEDS_4_8_12', 'Three tiers by playoff seed: seeds 1 to 4, 5 to 8 and 9 to 12. For a 12-team playoff seeded as one list.'),
  ('SEEDS_2_5_REST', 'Three tiers by playoff seed: the top 2 seeds, seeds 3 to 5, then every seed from 6 on. For a playoff field seeded within conferences of six to ten, play-in teams included.'),
  ('SEEDS_1_2_REST', 'Three tiers by seed within a division: the division winners, the 2 seeds, then every seed from 3 on, wild cards included. For a playoff seeded by division.'),
  ('SEEDS_2_4_REST', 'Three tiers by playoff seed: the top 2 seeds, seeds 3 and 4, then every seed from 5 on. For a playoff field of six seeds per conference or league.'),
  ('SEEDS_3_6_REST', 'Three tiers by playoff seed: the top 3 seeds, seeds 4 to 6, then every seed from 7 on. For a playoff field of eight or nine seeds per conference.'),
  ('REGION_SEED_LINES_4', 'Four tiers by seed line: seeds 1 to 4, 5 to 8, 9 to 12, then 13 on. For a tournament seeded 1 to 16 in each of four regions, so each tier holds four seed lines.'),
  ('REGION_SEEDS_EACH', 'Four tiers, one per seed line: the 1 seeds, the 2 seeds, the 3 seeds and the 4 seeds. For a tournament of four regions seeded 1 to 4.'),
  ('TIERS_2_OF_2', 'Equal groups by odds, then seed, then ranking: two tiers, two in the first and everyone left in the second. For a field of about four.'),
  ('TIERS_3_OF_3', 'Equal groups by odds, then seed, then ranking: three tiers, three in each but the last, which takes everyone left. For a field of about ten, such as a horse race.'),
  ('TIERS_4_OF_3', 'Equal groups by odds, then seed, then ranking: four tiers, three in each but the last, which takes everyone left. For a field of about twelve.'),
  ('TIERS_4_OF_4', 'Equal groups by odds, then seed, then ranking: four tiers, four in each but the last, which takes everyone left. For a field of about sixteen.'),
  ('TIERS_4_OF_4_BY_ODDS', 'Equal groups by odds, then ranking: four tiers, four in each but the last, which takes everyone left. For a field of about sixteen with no seeds, so odds come first.'),
  ('TIERS_4_OF_6', 'Equal groups by odds, then seed, then ranking: four tiers, six in each but the last, which takes everyone left. For a large individual field where only the leaders are known.'),
  ('TIERS_4_OF_8_BY_ODDS', 'Equal groups by odds, then ranking: four tiers, eight in each but the last, which takes everyone left. For a field of about 32 with no seeds, so odds come first.'),
  ('TIERS_4_OF_16', 'Equal groups by odds, then seed, then ranking: four tiers, sixteen in each but the last, which takes everyone left. For a field of about 64.'),
  ('TIERS_5_OF_8', 'Equal groups by odds, then seed, then ranking: five tiers, eight in each but the last, which takes everyone left. For a field of 20 to 40, such as a race.'),
  ('TIERS_5_OF_10', 'Equal groups by odds, then seed, then ranking: five tiers, ten in each but the last, which takes everyone left. For a field of about 50 or more.'),
  ('TIERS_6_OF_2', 'Equal groups by odds, then seed, then ranking: six tiers, two in each but the last, which takes everyone left. For a field of about twelve where each tier is a close choice.'),
  ('TIERS_6_OF_8', 'Equal groups by odds, then seed, then ranking: six tiers, eight in each but the last, which takes everyone left. For a draw of 64 to 128, such as a tennis tournament.'),
  ('TIERS_6_OF_10', 'Equal groups by odds, then seed, then ranking: six tiers, ten in each but the last, which takes everyone left. For a field of 100 or more, such as a golf tournament.'),
  ('TIERS_7_OF_2', 'Equal groups by odds, then seed, then ranking: seven tiers, two in each but the last, which takes everyone left. For a field of about fourteen where each tier is a close choice.')
) AS d("code", "description")
WHERE p."code" = d."code";

UPDATE "platform_pricing_profiles" p
SET "description" = d."description", "updated_at" = CURRENT_TIMESTAMP
FROM (VALUES
  ('STANDARD', 'Budget prices under a $50,000 cap, in steps of $100, with the field ordered by odds, then seed, then ranking. The default for a field with no seeds.'),
  ('STANDARD_BY_SEED', 'The Standard prices with the field ordered by seed first, then odds, then ranking. For a seeded playoff field, so it starts with the same source as the league''s seed tier profile.'),
  ('SMALL', 'Budget prices under a $5,000 cap, in steps of $10, with the field ordered by odds, then seed, then ranking. The Standard curve at a tenth of the size.')
) AS d("code", "description")
WHERE p."code" = d."code";

UPDATE "platform_tier_profiles"
SET "description" = 'Added by a root admin before profiles had descriptions. Write what it is for on the Profiles tab.'
WHERE "description" IS NULL;
UPDATE "platform_pricing_profiles"
SET "description" = 'Added by a root admin before profiles had descriptions. Write what it is for on the Profiles tab.'
WHERE "description" IS NULL;

ALTER TABLE "platform_tier_profiles" ALTER COLUMN "description" SET NOT NULL;
ALTER TABLE "platform_pricing_profiles" ALTER COLUMN "description" SET NOT NULL;
