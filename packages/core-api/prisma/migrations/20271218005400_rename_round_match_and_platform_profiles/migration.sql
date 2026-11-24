-- League model 3 (#2000): pure renames to the plan's names, with no change in behaviour.
--   SportEventMatch -> SportEventRoundMatch, its foreign key columns -> sport_event_round_match_id.
--   TierProfile / PricingProfile -> PlatformTierProfile / PlatformPricingProfile, and the sport
--   league's two settings columns -> platform_tier_profile_id / platform_pricing_profile_id.
-- Every Platform...Profile also gains a `code`, the key migrations, seed scripts and test data find
-- it by. The seeded profiles get theirs by id; any profile a root admin added gets a numbered one.
-- Renames keep every row, so this applies to QA's data as it stands. The period score table keeps
-- its name until slice 10e replaces it.

-- SportEventMatch -> SportEventRoundMatch
ALTER TABLE "sport_event_matches" RENAME TO "sport_event_round_matches";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_pkey" TO "sport_event_round_matches_pkey";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_sport_event_id_fkey" TO "sport_event_round_matches_sport_event_id_fkey";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_sport_event_round_id_fkey" TO "sport_event_round_matches_sport_event_round_id_fkey";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_home_sport_event_participant_id_fkey" TO "sport_event_round_matches_home_sport_event_participant_id_fkey";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_away_sport_event_participant_id_fkey" TO "sport_event_round_matches_away_sport_event_participant_id_fkey";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_advances_to_match_id_fkey" TO "sport_event_round_matches_advances_to_match_id_fkey";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_advances_elsewhere" TO "sport_event_round_matches_advances_elsewhere";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_advances_to_side_with_match" TO "sport_event_round_matches_advances_to_side_with_match";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_ending_check" TO "sport_event_round_matches_ending_check";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_home_spread_half_points_check" TO "sport_event_round_matches_home_spread_half_points_check";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_match_number_positive" TO "sport_event_round_matches_match_number_positive";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_scores_not_negative" TO "sport_event_round_matches_scores_not_negative";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_shootout_scores_check" TO "sport_event_round_matches_shootout_scores_check";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_sides_differ" TO "sport_event_round_matches_sides_differ";
ALTER TABLE "sport_event_round_matches" RENAME CONSTRAINT "sport_event_matches_winner_only_when_completed" TO "sport_event_round_matches_winner_only_when_completed";
ALTER INDEX "sport_event_matches_sport_event_round_id_idx" RENAME TO "sport_event_round_matches_sport_event_round_id_idx";
ALTER INDEX "sport_event_matches_home_sport_event_participant_id_idx" RENAME TO "sport_event_round_matches_home_sport_event_participant_id_idx";
ALTER INDEX "sport_event_matches_away_sport_event_participant_id_idx" RENAME TO "sport_event_round_matches_away_sport_event_participant_id_idx";
ALTER INDEX "sport_event_matches_sport_event_id_match_number_key" RENAME TO "sport_event_round_matches_sport_event_id_match_number_key";
ALTER INDEX "sport_event_matches_sport_event_id_external_game_id_key" RENAME TO "sport_event_round_matches_sport_event_id_external_game_id_key";
ALTER INDEX "sport_event_matches_advances_to_match_id_advances_to_side_key" RENAME TO "sport_event_round_matches_advances_to_match_id_advances_to__key";

-- The three tables that point at a match: their column, foreign key and index.
ALTER TABLE "contest_entry_match_predictions" RENAME COLUMN "sport_event_match_id" TO "sport_event_round_match_id";
ALTER TABLE "contest_entry_match_predictions" RENAME CONSTRAINT "contest_entry_match_predictions_sport_event_match_id_fkey" TO "contest_entry_match_predictions_sport_event_round_match_id_fkey";
ALTER INDEX "contest_entry_match_predictions_sport_event_match_id_idx" RENAME TO "contest_entry_match_predictions_sport_event_round_match_id_idx";

ALTER TABLE "contest_squares_games" RENAME COLUMN "sport_event_match_id" TO "sport_event_round_match_id";
ALTER TABLE "contest_squares_games" RENAME CONSTRAINT "contest_squares_games_sport_event_match_id_fkey" TO "contest_squares_games_sport_event_round_match_id_fkey";
ALTER INDEX "contest_squares_games_sport_event_match_id_idx" RENAME TO "contest_squares_games_sport_event_round_match_id_idx";

ALTER TABLE "sport_event_match_period_scores" RENAME COLUMN "sport_event_match_id" TO "sport_event_round_match_id";
ALTER TABLE "sport_event_match_period_scores" RENAME CONSTRAINT "sport_event_match_period_scores_sport_event_match_id_fkey" TO "sport_event_match_period_scores_sport_event_round_match_id_fkey";
ALTER INDEX "sport_event_match_period_scores_sport_event_match_id_period_key" RENAME TO "sport_event_match_period_scores_sport_event_round_match_id__key";

-- A queued settle job names its game by the new payload field.
UPDATE "background_jobs"
  SET "payload" = ("payload" - 'sportEventMatchId') || jsonb_build_object('sportEventRoundMatchId', "payload" -> 'sportEventMatchId')
  WHERE "payload" ? 'sportEventMatchId';

-- TierProfile -> PlatformTierProfile
ALTER TYPE "PrismaTierProfileLastTier" RENAME TO "PrismaPlatformTierProfileLastTier";
ALTER TABLE "tier_profiles" RENAME TO "platform_tier_profiles";
ALTER TABLE "platform_tier_profiles" RENAME CONSTRAINT "tier_profiles_pkey" TO "platform_tier_profiles_pkey";
ALTER TABLE "platform_tier_profiles" RENAME CONSTRAINT "tier_profiles_last_tier_max_when_capped" TO "platform_tier_profiles_last_tier_max_when_capped";
ALTER TABLE "platform_tier_profiles" RENAME CONSTRAINT "tier_profiles_tier_count_range" TO "platform_tier_profiles_tier_count_range";
ALTER TABLE "platform_tier_profiles" RENAME CONSTRAINT "tier_profiles_tier_size_range" TO "platform_tier_profiles_tier_size_range";
ALTER INDEX "tier_profiles_name_key" RENAME TO "platform_tier_profiles_name_key";

-- PricingProfile -> PlatformPricingProfile
ALTER TABLE "pricing_profiles" RENAME TO "platform_pricing_profiles";
ALTER TABLE "platform_pricing_profiles" RENAME CONSTRAINT "pricing_profiles_pkey" TO "platform_pricing_profiles_pkey";
ALTER TABLE "platform_pricing_profiles" RENAME CONSTRAINT "pricing_profiles_values_range" TO "platform_pricing_profiles_values_range";
ALTER INDEX "pricing_profiles_name_key" RENAME TO "platform_pricing_profiles_name_key";

-- The sport league's two settings columns.
ALTER TABLE "sport_leagues" RENAME COLUMN "tier_profile_id" TO "platform_tier_profile_id";
ALTER TABLE "sport_leagues" RENAME COLUMN "pricing_profile_id" TO "platform_pricing_profile_id";
ALTER TABLE "sport_leagues" RENAME CONSTRAINT "sport_leagues_tier_profile_id_fkey" TO "sport_leagues_platform_tier_profile_id_fkey";
ALTER TABLE "sport_leagues" RENAME CONSTRAINT "sport_leagues_pricing_profile_id_fkey" TO "sport_leagues_platform_pricing_profile_id_fkey";
ALTER INDEX "sport_leagues_tier_profile_id_idx" RENAME TO "sport_leagues_platform_tier_profile_id_idx";
ALTER INDEX "sport_leagues_pricing_profile_id_idx" RENAME TO "sport_leagues_platform_pricing_profile_id_idx";

-- Each profile's code: the seeded ones by id, then any other in name order.
ALTER TABLE "platform_tier_profiles" ADD COLUMN "code" VARCHAR(50);
UPDATE "platform_tier_profiles" AS p SET "code" = v.code
  FROM (VALUES
    ('a5fbbf61-395b-4c08-b4b4-0ccc49cc216e'::uuid, 'TIERS_6_OF_10'),
    ('a2d64f3a-c3cc-4f30-8637-3b0a57fcc266'::uuid, 'TIERS_6_OF_8'),
    ('60e92e6b-907b-42b7-8abc-220a7d05dbfe'::uuid, 'TIERS_4_OF_16'),
    ('9bbfee95-8e4c-479d-9b37-2b858702a36e'::uuid, 'TIERS_7_OF_2'),
    ('87f393e6-ce83-4b63-887d-60a77bfb27c8'::uuid, 'TIERS_4_OF_3'),
    ('0895ba6f-b9a3-424e-b8b6-2bda12270c3a'::uuid, 'TIERS_4_OF_4'),
    ('d41118e0-2023-46c8-b9e3-e21cae96d3a9'::uuid, 'TIERS_5_OF_8'),
    ('d018505b-7491-43ca-8a05-88e116821e3e'::uuid, 'TIERS_3_OF_3'),
    ('ee08b685-3ff9-4503-9981-d6778da8e80a'::uuid, 'TIERS_5_OF_10'),
    ('f22df62d-4e17-47bc-8e32-fded0c0cd8de'::uuid, 'TIERS_4_OF_6'),
    ('3ab96023-4255-43c1-ab20-f4c79ae926ec'::uuid, 'TIERS_6_OF_5'),
    ('06eeb506-42ac-4935-8dfc-89bb21fd7b06'::uuid, 'TIERS_2_OF_2'),
    ('e3c484c4-713c-43a0-82f7-a0f5300b4a4a'::uuid, 'TIERS_6_OF_2')
  ) AS v(id, code)
  WHERE p.id = v.id;
UPDATE "platform_tier_profiles" AS p SET "code" = 'TIER_PROFILE_' || n.position
  FROM (SELECT id, row_number() OVER (ORDER BY name) AS position FROM "platform_tier_profiles" WHERE "code" IS NULL) AS n
  WHERE p.id = n.id;
ALTER TABLE "platform_tier_profiles" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "platform_tier_profiles_code_key" ON "platform_tier_profiles"("code");
ALTER TABLE "platform_tier_profiles" ADD CONSTRAINT platform_tier_profiles_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]*$');

ALTER TABLE "platform_pricing_profiles" ADD COLUMN "code" VARCHAR(50);
UPDATE "platform_pricing_profiles" AS p SET "code" = v.code
  FROM (VALUES
    ('d8905e82-0a31-486e-a7e6-9cc1cb44465f'::uuid, 'STANDARD'),
    ('5d5547f0-02f9-4c0a-845e-f5be7199208d'::uuid, 'SMALL')
  ) AS v(id, code)
  WHERE p.id = v.id;
UPDATE "platform_pricing_profiles" AS p SET "code" = 'PRICING_PROFILE_' || n.position
  FROM (SELECT id, row_number() OVER (ORDER BY name) AS position FROM "platform_pricing_profiles" WHERE "code" IS NULL) AS n
  WHERE p.id = n.id;
ALTER TABLE "platform_pricing_profiles" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "platform_pricing_profiles_code_key" ON "platform_pricing_profiles"("code");
ALTER TABLE "platform_pricing_profiles" ADD CONSTRAINT platform_pricing_profiles_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]*$');
