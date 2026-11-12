-- Baseline: the whole migration history squashed on 2026-11-04 (#1429), again on 2026-11-11 and
-- again on 2026-11-12, each just before a QA reset. The history before each squash is in git (at
-- 7bff210, and at the parent of each later squash commit) under packages/core-api/prisma/migrations. Generated
-- from schema.prisma with `prisma migrate diff --from-empty --to-schema-datamodel`, enum labels
-- kept in the order the history added them, plus the section at the end that the schema cannot
-- declare. Reference rows are in the next migration.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";
-- Trigram search indexes need pg_trgm; schema.prisma cannot declare an extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "UserAuthProvider" AS ENUM ('email', 'google', 'apple');

-- CreateEnum
CREATE TYPE "UserTimeFormat" AS ENUM ('12H', '24H');

-- CreateEnum
CREATE TYPE "UserColorScheme" AS ENUM ('DEVICE', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "PrismaLeagueIconKey" AS ENUM ('GOLF_FLAG', 'GOLF_BALL', 'FOOTBALL', 'FOOTBALL_HELMET', 'BASKETBALL', 'BASKETBALL_HOOP', 'CHECKERED_FLAG', 'RACING_WHEEL', 'TENNIS_BALL', 'TENNIS_RACKET', 'HORSESHOE', 'SOCCER_BALL', 'HOCKEY_STICK', 'HOCKEY_PUCK', 'BASEBALL', 'BASEBALL_BAT', 'FIGHT_GLOVE', 'TROPHY', 'WHISTLE', 'STOPWATCH');

-- CreateEnum
CREATE TYPE "PrismaLeagueRole" AS ENUM ('COMMISSIONER', 'MEMBER');

-- CreateEnum
CREATE TYPE "PrismaLeagueMembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PrismaSquadIconKey" AS ENUM ('CAPTAIN_SMILE_SUNSET', 'CAPTAIN_SMILE_FIELD', 'CAPTAIN_SMILE_OCEAN', 'CAPTAIN_SMILE_MIDNIGHT', 'CAPTAIN_SMILE_CANDY', 'CAPTAIN_WINK_SUNSET', 'CAPTAIN_WINK_FIELD', 'CAPTAIN_WINK_OCEAN', 'CAPTAIN_WINK_MIDNIGHT', 'CAPTAIN_WINK_CANDY', 'CHAMPION_BEARD_SUNSET', 'CHAMPION_BEARD_FIELD', 'CHAMPION_BEARD_OCEAN', 'CHAMPION_BEARD_MIDNIGHT', 'CHAMPION_BEARD_CANDY', 'MAVERICK_MASK_SUNSET', 'MAVERICK_MASK_FIELD', 'MAVERICK_MASK_OCEAN', 'MAVERICK_MASK_MIDNIGHT', 'MAVERICK_MASK_CANDY', 'STARFACE_SUNSET', 'STARFACE_FIELD', 'STARFACE_OCEAN', 'STARFACE_MIDNIGHT', 'STARFACE_CANDY', 'HELMET_STRIPE_SUNSET', 'HELMET_STRIPE_FIELD', 'HELMET_STRIPE_OCEAN', 'HELMET_STRIPE_MIDNIGHT', 'HELMET_STRIPE_CANDY', 'HELMET_BOLT_SUNSET', 'HELMET_BOLT_FIELD', 'HELMET_BOLT_OCEAN', 'HELMET_BOLT_MIDNIGHT', 'HELMET_BOLT_CANDY', 'HELMET_HORN_SUNSET', 'HELMET_HORN_FIELD', 'HELMET_HORN_OCEAN', 'HELMET_HORN_MIDNIGHT', 'HELMET_HORN_CANDY', 'HELMET_WING_SUNSET', 'HELMET_WING_FIELD', 'HELMET_WING_OCEAN', 'HELMET_WING_MIDNIGHT', 'HELMET_WING_CANDY', 'HELMET_GRID_SUNSET', 'HELMET_GRID_FIELD', 'HELMET_GRID_OCEAN', 'HELMET_GRID_MIDNIGHT', 'HELMET_GRID_CANDY', 'GOLF_BAG_SUNSET', 'GOLF_BAG_FIELD', 'GOLF_BAG_OCEAN', 'GOLF_BAG_MIDNIGHT', 'GOLF_BAG_CANDY', 'WHISTLE_BADGE_SUNSET', 'WHISTLE_BADGE_FIELD', 'WHISTLE_BADGE_OCEAN', 'WHISTLE_BADGE_MIDNIGHT', 'WHISTLE_BADGE_CANDY', 'STOPWATCH_BADGE_SUNSET', 'STOPWATCH_BADGE_FIELD', 'STOPWATCH_BADGE_OCEAN', 'STOPWATCH_BADGE_MIDNIGHT', 'STOPWATCH_BADGE_CANDY', 'MEGAPHONE_SUNSET', 'MEGAPHONE_FIELD', 'MEGAPHONE_OCEAN', 'MEGAPHONE_MIDNIGHT', 'MEGAPHONE_CANDY', 'FOAM_FINGER_SUNSET', 'FOAM_FINGER_FIELD', 'FOAM_FINGER_OCEAN', 'FOAM_FINGER_MIDNIGHT', 'FOAM_FINGER_CANDY', 'BULL_HEAD_SUNSET', 'BULL_HEAD_FIELD', 'BULL_HEAD_OCEAN', 'BULL_HEAD_MIDNIGHT', 'BULL_HEAD_CANDY', 'LUCKY_DUCK_SUNSET', 'LUCKY_DUCK_FIELD', 'LUCKY_DUCK_OCEAN', 'LUCKY_DUCK_MIDNIGHT', 'LUCKY_DUCK_CANDY', 'TURBO_TURTLE_SUNSET', 'TURBO_TURTLE_FIELD', 'TURBO_TURTLE_OCEAN', 'TURBO_TURTLE_MIDNIGHT', 'TURBO_TURTLE_CANDY', 'FIRE_PIZZA_SUNSET', 'FIRE_PIZZA_FIELD', 'FIRE_PIZZA_OCEAN', 'FIRE_PIZZA_MIDNIGHT', 'FIRE_PIZZA_CANDY', 'BANANA_BAT_SUNSET', 'BANANA_BAT_FIELD', 'BANANA_BAT_OCEAN', 'BANANA_BAT_MIDNIGHT', 'BANANA_BAT_CANDY');

-- CreateEnum
CREATE TYPE "PrismaSquadMembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PrismaLeagueInviteType" AS ENUM ('EMAIL', 'LINK');

-- CreateEnum
CREATE TYPE "PrismaLeagueInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PrismaEmailTemplateKey" AS ENUM ('LEAGUE_MEMBER_INVITE', 'LEAGUE_JOIN_SUCCESS', 'CONTEST_ENTRY_COMPLETED', 'CONTEST_STARTED_SUMMARY', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'CONTEST_ENTRY_REMINDER', 'CONTEST_OPENED', 'CONTEST_STANDINGS', 'CONTEST_RESULTS', 'CONTEST_EVENT_CHANGED', 'EVENT_COMING_UP', 'EVENT_READY_FOR_CONTESTS', 'CONTEST_NOT_OPEN', 'EVENT_STILL_DRAFT', 'SQUAD_OWNER_INVITE', 'SQUAD_OWNER_ADDED', 'EMAIL_TEST', 'YEAR_IN_REVIEW', 'EVENT_WEEKLY_DIGEST', 'LEAGUE_MEMBER_JOINED', 'CONTEST_EXPANDED', 'EMAIL_CHANGED', 'LEAGUE_PLAN_PREVIEW_ENDING');

-- CreateEnum
CREATE TYPE "PrismaEmailMessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'DELIVERED', 'BOUNCED', 'COMPLAINED');

-- CreateEnum
CREATE TYPE "PrismaBackgroundJobType" AS ENUM ('MANUAL_EVENT_SYNC', 'CONTEST_STARTED_EMAILS', 'CONTEST_SETTLED_EMAILS', 'SETTLE_SPORT_EVENT_CONTESTS', 'SETTLE_GAME_CONTESTS', 'REBUILD_LEADERBOARDS', 'CONTEST_EVENT_CHANGED_EMAILS', 'ADD_RELEASED_EDITION_TO_CONTEST', 'PROVIDER_EVENT_SYNC');

-- CreateEnum
CREATE TYPE "PrismaBackgroundJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PrismaEmailSkipReason" AS ENUM ('EMAIL_DISABLED', 'TEMPLATE_DISABLED', 'NOT_ALLOWED_IN_ENVIRONMENT', 'SUPPRESSED', 'OPTED_OUT', 'NOT_IN_PLAN');

-- CreateEnum
CREATE TYPE "PrismaOptionalEmailCategory" AS ENUM ('COMMISSIONER_UPDATES', 'CONTEST_UPDATES', 'LIVE_STANDINGS', 'RESULTS', 'RECEIPTS');

-- CreateEnum
CREATE TYPE "PrismaEmailSuppressionReason" AS ENUM ('BOUNCE', 'COMPLAINT');

-- CreateEnum
CREATE TYPE "PrismaSquadOwnerInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PrismaParticipantType" AS ENUM ('INDIVIDUAL', 'TEAM');

-- CreateEnum
CREATE TYPE "PrismaParticipantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'RETIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PrismaParticipantFormTrend" AS ENUM ('RISING', 'STABLE', 'FALLING');

-- CreateEnum
CREATE TYPE "PrismaParticipantMappingConfidence" AS ENUM ('EXACT', 'HIGH', 'MANUAL');

-- CreateEnum
CREATE TYPE "PrismaSportEventStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'POSTPONED');

-- CreateEnum
CREATE TYPE "ParticipantInactiveReason" AS ENUM ('WITHDRAWN', 'ELIMINATED');

-- CreateEnum
CREATE TYPE "PrismaSportEventSyncScope" AS ENUM ('NONE', 'SCORES_ONLY');

-- CreateEnum
CREATE TYPE "ValuationSource" AS ENUM ('AUTO_ODDS', 'AUTO_RANKING', 'MANUAL');

-- CreateEnum
CREATE TYPE "ParticipantStandingStatus" AS ENUM ('ACTIVE', 'IN_PROGRESS', 'COMPLETE', 'WITHDRAWN', 'ELIMINATED');

-- CreateEnum
CREATE TYPE "PrismaSport" AS ENUM ('GOLF', 'HORSE_RACING', 'AUTO_RACING', 'CYCLING', 'RUNNING', 'BASKETBALL', 'AMERICAN_FOOTBALL', 'HOCKEY', 'BASEBALL', 'SOCCER', 'TENNIS');

-- CreateEnum
CREATE TYPE "PrismaTournamentFormat" AS ENUM ('STROKE_PLAY_TOURNAMENT', 'RACE', 'MATCHES');

-- CreateEnum
CREATE TYPE "PrismaMatchStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrismaMatchSide" AS ENUM ('HOME', 'AWAY');

-- CreateEnum
CREATE TYPE "PrismaMatchEnding" AS ENUM ('PLAYED', 'RETIREMENT', 'WALKOVER', 'DEFAULT');

-- CreateEnum
CREATE TYPE "PrismaMatchResultSource" AS ENUM ('ADMIN', 'PROVIDER');

-- CreateEnum
CREATE TYPE "PrismaPredictedResult" AS ENUM ('TEAM', 'TIE');

-- CreateEnum
CREATE TYPE "PrismaBracketAdvancement" AS ENUM ('FIXED', 'RESEED_BY_SEED');

-- CreateEnum
CREATE TYPE "PrismaMatchPeriodLayout" AS ENUM ('QUARTERS', 'HALVES', 'THREE_PERIODS');

-- CreateEnum
CREATE TYPE "PrismaSportLeagueNoun" AS ENUM ('LEAGUE');

-- CreateEnum
CREATE TYPE "PrismaScoringFamily" AS ENUM ('STROKE_PLAY', 'FINISH_POSITION', 'HEAD_TO_HEAD', 'COMPOSITE');

-- CreateEnum
CREATE TYPE "PrismaSportStat" AS ENUM ('TOTAL_BASES', 'RUNS', 'RUNS_BATTED_IN', 'WALKS', 'STOLEN_BASES', 'POINTS', 'REBOUNDS', 'ASSISTS', 'GOALS', 'SHOTS_ON_GOAL', 'SHOTS_ON_TARGET', 'PASSING_TOUCHDOWNS', 'RUSHING_TOUCHDOWNS', 'RECEIVING_TOUCHDOWNS', 'RECEPTIONS', 'PASSING_YARDS', 'RUSHING_YARDS', 'RECEIVING_YARDS');

-- CreateEnum
CREATE TYPE "RaceResultStatus" AS ENUM ('FINISHED', 'DID_NOT_FINISH', 'DISQUALIFIED', 'DID_NOT_START');

-- CreateEnum
CREATE TYPE "PrismaContestFormat" AS ENUM ('ROSTER', 'PREDICTION', 'SQUARES');

-- CreateEnum
CREATE TYPE "PrismaContestStatus" AS ENUM ('DRAFT', 'OPEN', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PrismaContestTemplateEventType" AS ENUM ('KNOCKOUT', 'WEEK');

-- CreateEnum
CREATE TYPE "PrismaSelectionType" AS ENUM ('TIERED', 'BUDGET_PICK', 'RANDOM_DRAW', 'PICK_EM', 'BRACKET', 'SURVIVOR', 'SQUARES');

-- CreateEnum
CREATE TYPE "PrismaCupWeight" AS ENUM ('NORMAL', 'BONUS', 'DOUBLE', 'NOT_COUNTED');

-- CreateEnum
CREATE TYPE "PrismaEventEmailDelivery" AS ENUM ('PER_EVENT', 'WEEKLY_DIGEST');

-- CreateEnum
CREATE TYPE "PrismaCupPointsScale" AS ENUM ('STANDARD', 'TOP_TEN', 'FIELD_BEATEN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PrismaLeaguePlan" AS ENUM ('FREE', 'PRO', 'PREMIUM', 'PLATINUM');

-- CreateEnum
CREATE TYPE "PrismaLeaguePlanChangeReason" AS ENUM ('CHOSEN', 'PREVIEW_ENDED', 'GIFT_RESTORED');

-- CreateEnum
CREATE TYPE "PrismaLeaguePaymentKind" AS ENUM ('CONTEST_EXPANSION_PAYMENTS_OFF', 'CONTEST_EXPANSION_GRANT');

-- CreateEnum
CREATE TYPE "PrismaCupStatus" AS ENUM ('OPEN', 'CROWNED');

-- CreateEnum
CREATE TYPE "PrismaCupTrophy" AS ENUM ('CHAMPION', 'RUNNER_UP', 'THIRD');

-- CreateEnum
CREATE TYPE "PrismaPrizePayoutType" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "PrismaContestEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "PrismaParticipantRoundStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'DNF', 'DSQ', 'MISSED_CUT');

-- CreateEnum
CREATE TYPE "PrismaProviderSyncRunStatus" AS ENUM ('SUBMITTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "password_hash" TEXT,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "auth_provider" "UserAuthProvider",
    "auth_id" TEXT,
    "is_root_admin" BOOLEAN NOT NULL DEFAULT false,
    "timezone" VARCHAR(50),
    "locale" VARCHAR(10) DEFAULT 'en-US',
    "time_format" "UserTimeFormat" DEFAULT '12H',
    "color_scheme" "UserColorScheme",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" CHAR(64) NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "rotated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_change_undo_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "old_email" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_change_undo_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leagues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_code" VARCHAR(16) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "icon_key" "PrismaLeagueIconKey" NOT NULL DEFAULT 'TROPHY',
    "cup_points_scale" "PrismaCupPointsScale" NOT NULL DEFAULT 'STANDARD',
    "cup_custom_points" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "cup_name" TEXT NOT NULL,
    "hall_of_lame_visible" BOOLEAN NOT NULL DEFAULT true,
    "plan" "PrismaLeaguePlan" NOT NULL DEFAULT 'PREMIUM',
    "plan_renews_at" TIMESTAMPTZ NOT NULL DEFAULT (now() + '6 mons'::interval),
    "muted_sport_league_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "event_email_delivery" "PrismaEventEmailDelivery" NOT NULL DEFAULT 'PER_EVENT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "contest_id" UUID,
    "payer_id" UUID,
    "kind" "PrismaLeaguePaymentKind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "paid_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_expansions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "entries_per_contest" INTEGER NOT NULL,
    "payment_id" UUID NOT NULL,
    "expanded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_expansions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_plan_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "from_plan" "PrismaLeaguePlan" NOT NULL,
    "to_plan" "PrismaLeaguePlan" NOT NULL,
    "change_reason" "PrismaLeaguePlanChangeReason" NOT NULL,
    "changed_by_id" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_plan_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_plan_renewal_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "from_renews_at" TIMESTAMPTZ NOT NULL,
    "to_renews_at" TIMESTAMPTZ NOT NULL,
    "changed_by_id" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_plan_renewal_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "PrismaLeagueRole" NOT NULL DEFAULT 'MEMBER',
    "status" "PrismaLeagueMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "league_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "squads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon_key" "PrismaSquadIconKey" NOT NULL DEFAULT 'CAPTAIN_SMILE_FIELD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "squads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "squad_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "squad_id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "PrismaSquadMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "squad_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "email" VARCHAR(255),
    "invite_code" VARCHAR(100) NOT NULL,
    "invite_type" "PrismaLeagueInviteType" NOT NULL DEFAULT 'EMAIL',
    "status" "PrismaLeagueInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "current_uses" INTEGER NOT NULL DEFAULT 0,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "accepted_at" TIMESTAMPTZ,
    "accepted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "league_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_key" "PrismaEmailTemplateKey" NOT NULL,
    "recipient_user_id" UUID,
    "recipient_email" VARCHAR(255) NOT NULL,
    "league_id" UUID,
    "contest_id" UUID,
    "entry_id" UUID,
    "invitation_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "notice_about" VARCHAR(200),
    "from_name" VARCHAR(255) NOT NULL,
    "from_address" VARCHAR(255) NOT NULL,
    "subject" TEXT,
    "text_body" TEXT,
    "html_body" TEXT,
    "list_unsubscribe_url" TEXT,
    "status" "PrismaEmailMessageStatus" NOT NULL,
    "skip_reason" "PrismaEmailSkipReason",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "provider_message_id" VARCHAR(255),
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "suppression_reason" "PrismaEmailSuppressionReason" NOT NULL,
    "email_message_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "squad_owner_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "squad_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "invite_code" VARCHAR(100) NOT NULL,
    "status" "PrismaSquadOwnerInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "accepted_at" TIMESTAMPTZ,
    "accepted_by" UUID,
    "replacement_for_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "squad_owner_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport" "PrismaSport" NOT NULL,
    "participant_type" "PrismaParticipantType" NOT NULL,
    "tournament_format" "PrismaTournamentFormat" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_leagues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "match_keyword" VARCHAR(255),
    "current_event_year" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "bracket_advancement" "PrismaBracketAdvancement" NOT NULL DEFAULT 'FIXED',
    "round_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tier_count" INTEGER,
    "match_period_layout" "PrismaMatchPeriodLayout",
    "squares_from_round" INTEGER,
    "round_series_lengths" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "noun" "PrismaSportLeagueNoun",
    "display_name" VARCHAR(255),
    "display_order" INTEGER,
    "participant_type" "PrismaParticipantType",
    "scoring_family" "PrismaScoringFamily",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "event_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_league_affiliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participant_id" UUID NOT NULL,
    "sport_league_id" UUID NOT NULL,
    "ranking" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "participant_league_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "participant_type" "PrismaParticipantType" NOT NULL,
    "external_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "short_name" VARCHAR(100),
    "nationality" VARCHAR(10),
    "role" VARCHAR(50),
    "team_affiliation" TEXT,
    "status" "PrismaParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "injury_status" JSONB NOT NULL DEFAULT '{"status": "HEALTHY"}',
    "photo_url" TEXT,
    "photo_last_updated" TIMESTAMPTZ,
    "external_ids" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_provider_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participant_id" UUID NOT NULL,
    "provider_id" VARCHAR(100) NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "confidence" "PrismaParticipantMappingConfidence" NOT NULL DEFAULT 'EXACT',
    "mapped_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "participant_provider_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PrismaContestStatus" NOT NULL DEFAULT 'DRAFT',
    "contest_format" "PrismaContestFormat" NOT NULL DEFAULT 'ROSTER',
    "selection_type" "PrismaSelectionType" NOT NULL,
    "opened_at" TIMESTAMPTZ,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "next_reminder_at" TIMESTAMPTZ,
    "season_year" INTEGER NOT NULL,
    "cup_weight" "PrismaCupWeight" NOT NULL DEFAULT 'NORMAL',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "season_year" INTEGER NOT NULL,
    "sport_league_id" UUID NOT NULL,
    "status" "PrismaCupStatus" NOT NULL DEFAULT 'OPEN',
    "crowned_at" TIMESTAMPTZ,
    "crowned_points_scale" "PrismaCupPointsScale",
    "crowned_custom_points" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cup_standings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cup_id" UUID NOT NULL,
    "squad_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "display_position" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "podiums" INTEGER NOT NULL,
    "contests_counted" INTEGER NOT NULL,
    "trophy" "PrismaCupTrophy",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cup_standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_year_finishes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "squad_id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "place" INTEGER NOT NULL,
    "tied_count" INTEGER NOT NULL,
    "ranked_entry_count" INTEGER NOT NULL,
    "weight" "PrismaCupWeight" NOT NULL,
    "points" INTEGER NOT NULL,
    "settled_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_year_finishes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_year_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "sent_by_user_id" UUID,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_year_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_sport_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "sport_event_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_sport_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_configurations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "template_id" UUID,
    "template_version" INTEGER,
    "selection_type" "PrismaSelectionType" NOT NULL,
    "config_json" JSONB,
    "minimum_entries" INTEGER,
    "max_entries_per_squad" INTEGER,
    "total_prize_pool_amount" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_config_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport" "PrismaSport" NOT NULL,
    "sport_league_id" UUID,
    "event_type" "PrismaContestTemplateEventType",
    "contest_type" "PrismaContestFormat" NOT NULL,
    "selection_type" "PrismaSelectionType" NOT NULL,
    "template_key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "config_json" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "event_series_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_config_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport" "PrismaSport" NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "redirect_to_page_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "event_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_page_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_page_id" UUID NOT NULL,
    "sport_league_id" UUID NOT NULL,
    "event_series_name" VARCHAR(255) NOT NULL,
    "template_id" UUID NOT NULL,
    "bracket_start_round" INTEGER,
    "sort_order" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "event_page_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_contest_scoring_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_configuration_id" UUID NOT NULL,
    "participant_scoring_definition_id" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "participant_contest_scoring_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_prize_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_configuration_id" UUID NOT NULL,
    "prize_definition_id" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "rule_config" JSONB NOT NULL DEFAULT '{}',
    "payout_type" "PrismaPrizePayoutType",
    "amount" DOUBLE PRECISION,
    "percentage" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_prize_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "squad_id" UUID NOT NULL,
    "entry_number" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "tiebreaker_value" INTEGER,
    "last_standings_email_position" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entry_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_entry_id" UUID NOT NULL,
    "sport_event_id" UUID NOT NULL,
    "status" "PrismaContestEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ,
    "tiebreaker_value" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entry_match_predictions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_entry_id" UUID NOT NULL,
    "sport_event_match_id" UUID NOT NULL,
    "predicted_result" "PrismaPredictedResult" NOT NULL DEFAULT 'TEAM',
    "sport_event_participant_id" UUID,
    "confidence" INTEGER,
    "picked_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_match_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entry_standings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "contest_entry_id" UUID NOT NULL,
    "position" INTEGER,
    "display_position" VARCHAR(20),
    "counting_pick_limit" INTEGER NOT NULL,
    "scored_pick_count" INTEGER NOT NULL,
    "total_score" INTEGER,
    "as_of" TIMESTAMPTZ,
    "settled_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entry_event_standings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "contest_entry_id" UUID NOT NULL,
    "sport_event_id" UUID NOT NULL,
    "position" INTEGER,
    "display_position" VARCHAR(20),
    "counting_pick_limit" INTEGER NOT NULL,
    "scored_pick_count" INTEGER NOT NULL,
    "total_score" INTEGER,
    "as_of" TIMESTAMPTZ,
    "settled_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_event_standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_leaderboard_snapshots" (
    "contest_id" UUID NOT NULL,
    "shown_event" VARCHAR(36) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "computed_from" TIMESTAMPTZ NOT NULL,
    "contest_updated_at" TIMESTAMPTZ NOT NULL,
    "valid_until" TIMESTAMPTZ,
    "board" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_leaderboard_snapshots_pkey" PRIMARY KEY ("contest_id","shown_event")
);

-- CreateTable
CREATE TABLE "contest_draws" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "seed" VARCHAR(64) NOT NULL,
    "field_order" UUID[],
    "entry_order" UUID[],
    "drawn_by_user_id" UUID,
    "drawn_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receipts_pending_sport_event_id" UUID,

    CONSTRAINT "contest_draws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_squares_games" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "sport_event_match_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_squares_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entry_squares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "contest_entry_id" UUID NOT NULL,
    "row_index" INTEGER NOT NULL,
    "column_index" INTEGER NOT NULL,
    "claimed_by_user_id" UUID,
    "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_entry_squares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_squares_draws" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "seed" VARCHAR(64) NOT NULL,
    "row_digits" INTEGER[],
    "column_digits" INTEGER[],
    "drawn_by_user_id" UUID,
    "drawn_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_squares_draws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_squares_winners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "period_number" INTEGER NOT NULL,
    "home_score" INTEGER NOT NULL,
    "away_score" INTEGER NOT NULL,
    "row_index" INTEGER NOT NULL,
    "column_index" INTEGER NOT NULL,
    "contest_entry_id" UUID,
    "settled_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_squares_winners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entry_picks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entry_id" UUID NOT NULL,
    "sport_event_participant_id" UUID NOT NULL,
    "contest_format" "PrismaContestFormat" NOT NULL,
    "period" INTEGER,
    "slot" INTEGER,
    "tier" VARCHAR(50),
    "cost" DECIMAL(12,2),
    "is_auto_picked" BOOLEAN NOT NULL DEFAULT false,
    "lineup_slot" INTEGER,
    "pick_sequence" INTEGER,
    "picked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "external_id" VARCHAR(255) NOT NULL,
    "provider_id" VARCHAR(100) NOT NULL,
    "sport" "PrismaSport" NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "venue" VARCHAR(500),
    "location" VARCHAR(500),
    "start_date" TIMESTAMPTZ NOT NULL,
    "end_date" TIMESTAMPTZ,
    "status" "PrismaSportEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "rounds" INTEGER,
    "rounds_par" INTEGER,
    "participant_count" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "event_series_id" UUID NOT NULL,
    "event_year" INTEGER NOT NULL,
    "sync_scope" "PrismaSportEventSyncScope" NOT NULL DEFAULT 'NONE',
    "auto_lifecycle_enabled" BOOLEAN NOT NULL DEFAULT true,
    "pricing_config" JSONB,
    "last_provider_notification_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "inactive_reason" "ParticipantInactiveReason",
    "ranking" INTEGER,
    "odds_to_win" DECIMAL(10,2),
    "seed_number" INTEGER,
    "is_play_in_place" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "scheduled_date" TIMESTAMPTZ NOT NULL,
    "scheduled_end_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_id" UUID NOT NULL,
    "sport_event_round_id" UUID NOT NULL,
    "match_number" INTEGER NOT NULL,
    "home_sport_event_participant_id" UUID,
    "away_sport_event_participant_id" UUID,
    "is_neutral_site" BOOLEAN NOT NULL,
    "scheduled_date" TIMESTAMPTZ,
    "status" "PrismaMatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "winner_side" "PrismaMatchSide",
    "home_score" INTEGER,
    "away_score" INTEGER,
    "home_shootout_score" INTEGER,
    "away_shootout_score" INTEGER,
    "ending" "PrismaMatchEnding" NOT NULL DEFAULT 'PLAYED',
    "advances_to_match_id" UUID,
    "advances_to_side" "PrismaMatchSide",
    "region_label" VARCHAR(40),
    "home_spread" DECIMAL(4,1),
    "external_game_id" VARCHAR(255),
    "result_source" "PrismaMatchResultSource",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_match_period_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_match_id" UUID NOT NULL,
    "period_number" INTEGER NOT NULL,
    "home_score" INTEGER NOT NULL,
    "away_score" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_match_period_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_participant_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_participant_id" UUID NOT NULL,
    "sport_event_round_id" UUID NOT NULL,
    "status" "PrismaParticipantRoundStatus" NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_participant_golf_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participant_round_id" UUID NOT NULL,
    "strokes" INTEGER NOT NULL,
    "score_to_par" INTEGER NOT NULL,
    "thru" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_golf_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_participant_stat_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participant_round_id" UUID NOT NULL,
    "stat" "PrismaSportStat" NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_stat_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_participant_standings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_participant_id" UUID NOT NULL,
    "position" INTEGER,
    "display_position" VARCHAR(20),
    "status" "ParticipantStandingStatus" NOT NULL DEFAULT 'ACTIVE',
    "as_of" TIMESTAMPTZ,
    "current_round" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_participant_golf_standings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "standing_id" UUID NOT NULL,
    "event_score_to_par" INTEGER NOT NULL,
    "event_strokes" INTEGER NOT NULL,
    "current_round_thru" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_golf_standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_participant_race_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_participant_id" UUID NOT NULL,
    "finish_position" INTEGER,
    "start_position" INTEGER,
    "result_status" "RaceResultStatus" NOT NULL,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "rider_name" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_race_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_tiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_id" UUID NOT NULL,
    "tier_key" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "tier_number" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_participant_valuations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_participant_id" UUID NOT NULL,
    "sport_event_tier_id" UUID,
    "tier_order_index" INTEGER,
    "tier_assigned_source" "ValuationSource",
    "price" DECIMAL(10,2),
    "price_assigned_source" "ValuationSource",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_sync_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" VARCHAR(100) NOT NULL,
    "sport" "PrismaSport" NOT NULL,
    "event_id" VARCHAR(255),
    "status" "PrismaProviderSyncRunStatus" NOT NULL,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "payload_json" JSONB NOT NULL DEFAULT '{}',
    "details_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_runtime_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "config_key" VARCHAR(100) NOT NULL,
    "config_json" JSONB NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_runtime_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "PrismaBackgroundJobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "PrismaBackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "run_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMPTZ,
    "last_error" TEXT,
    "dedupe_key" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_runtime_config_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "config_key" VARCHAR(100) NOT NULL,
    "previous_json" JSONB,
    "new_json" JSONB NOT NULL,
    "changed_by_id" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_runtime_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_opt_outs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "category" "PrismaOptionalEmailCategory" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_is_root_admin_is_active_idx" ON "users"("is_root_admin", "is_active");

-- CreateIndex
CREATE INDEX "users_email_trgm_idx" ON "users" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_username_trgm_idx" ON "users" USING GIN ("username" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_first_name_trgm_idx" ON "users" USING GIN ("first_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_last_name_trgm_idx" ON "users" USING GIN ("last_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_created_at_idx" ON "password_reset_tokens"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_change_undo_tokens_token_hash_key" ON "email_change_undo_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_change_undo_tokens_user_id_created_at_idx" ON "email_change_undo_tokens"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "leagues_league_code_key" ON "leagues"("league_code");

-- CreateIndex
CREATE INDEX "leagues_plan_renews_at_idx" ON "leagues"("plan_renews_at");

-- CreateIndex
CREATE INDEX "leagues_name_trgm_idx" ON "leagues" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "league_payments_league_id_paid_at_idx" ON "league_payments"("league_id", "paid_at" DESC);

-- CreateIndex
CREATE INDEX "league_payments_payer_id_paid_at_idx" ON "league_payments"("payer_id", "paid_at" DESC);

-- CreateIndex
CREATE INDEX "league_payments_contest_id_idx" ON "league_payments"("contest_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_expansions_payment_id_key" ON "contest_expansions"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_expansions_contest_id_entries_per_contest_key" ON "contest_expansions"("contest_id", "entries_per_contest");

-- CreateIndex
CREATE INDEX "league_plan_changes_league_id_changed_at_idx" ON "league_plan_changes"("league_id", "changed_at" DESC);

-- CreateIndex
CREATE INDEX "league_plan_changes_changed_by_id_idx" ON "league_plan_changes"("changed_by_id");

-- CreateIndex
CREATE INDEX "league_plan_renewal_changes_league_id_changed_at_idx" ON "league_plan_renewal_changes"("league_id", "changed_at" DESC);

-- CreateIndex
CREATE INDEX "league_plan_renewal_changes_changed_by_id_idx" ON "league_plan_renewal_changes"("changed_by_id");

-- CreateIndex
CREATE INDEX "league_memberships_league_id_status_idx" ON "league_memberships"("league_id", "status");

-- CreateIndex
CREATE INDEX "league_memberships_user_id_status_idx" ON "league_memberships"("user_id", "status");

-- CreateIndex
CREATE INDEX "league_memberships_status_joined_at_idx" ON "league_memberships"("status", "joined_at");

-- CreateIndex
CREATE UNIQUE INDEX "league_memberships_league_id_user_id_key" ON "league_memberships"("league_id", "user_id");

-- CreateIndex
CREATE INDEX "squads_league_id_is_active_idx" ON "squads"("league_id", "is_active");

-- CreateIndex
CREATE INDEX "squads_created_by_idx" ON "squads"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "squads_league_id_name_key" ON "squads"("league_id", "name");

-- CreateIndex
CREATE INDEX "squad_memberships_squad_id_status_idx" ON "squad_memberships"("squad_id", "status");

-- CreateIndex
CREATE INDEX "squad_memberships_user_id_idx" ON "squad_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "squad_memberships_squad_id_user_id_key" ON "squad_memberships"("squad_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "squad_memberships_league_id_user_id_key" ON "squad_memberships"("league_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_invitations_invite_code_key" ON "league_invitations"("invite_code");

-- CreateIndex
CREATE INDEX "league_invitations_league_id_status_idx" ON "league_invitations"("league_id", "status");

-- CreateIndex
CREATE INDEX "league_invitations_invited_by_idx" ON "league_invitations"("invited_by");

-- CreateIndex
CREATE INDEX "league_invitations_accepted_by_idx" ON "league_invitations"("accepted_by");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_idempotency_key_key" ON "email_messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "email_messages_status_next_attempt_at_idx" ON "email_messages"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "email_messages_invitation_id_created_at_idx" ON "email_messages"("invitation_id", "created_at");

-- CreateIndex
CREATE INDEX "email_messages_created_at_idx" ON "email_messages"("created_at");

-- CreateIndex
CREATE INDEX "email_messages_provider_message_id_idx" ON "email_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "email_messages_contest_id_template_key_idx" ON "email_messages"("contest_id", "template_key");

-- CreateIndex
CREATE INDEX "email_messages_template_key_notice_about_league_id_idx" ON "email_messages"("template_key", "notice_about", "league_id");

-- CreateIndex
CREATE INDEX "email_messages_entry_id_idx" ON "email_messages"("entry_id");

-- CreateIndex
CREATE INDEX "email_messages_league_id_idx" ON "email_messages"("league_id");

-- CreateIndex
CREATE INDEX "email_messages_recipient_user_id_idx" ON "email_messages"("recipient_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_email_key" ON "email_suppressions"("email");

-- CreateIndex
CREATE INDEX "email_suppressions_email_message_id_idx" ON "email_suppressions"("email_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "squad_owner_invitations_invite_code_key" ON "squad_owner_invitations"("invite_code");

-- CreateIndex
CREATE INDEX "squad_owner_invitations_league_id_status_idx" ON "squad_owner_invitations"("league_id", "status");

-- CreateIndex
CREATE INDEX "squad_owner_invitations_squad_id_status_idx" ON "squad_owner_invitations"("squad_id", "status");

-- CreateIndex
CREATE INDEX "squad_owner_invitations_invited_by_idx" ON "squad_owner_invitations"("invited_by");

-- CreateIndex
CREATE INDEX "squad_owner_invitations_accepted_by_idx" ON "squad_owner_invitations"("accepted_by");

-- CreateIndex
CREATE UNIQUE INDEX "sports_sport_key" ON "sports"("sport");

-- CreateIndex
CREATE UNIQUE INDEX "sport_leagues_sport_id_name_key" ON "sport_leagues"("sport_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "event_series_sport_league_id_name_key" ON "event_series"("sport_league_id", "name");

-- CreateIndex
CREATE INDEX "participant_league_affiliations_sport_league_id_ranking_idx" ON "participant_league_affiliations"("sport_league_id", "ranking");

-- CreateIndex
CREATE UNIQUE INDEX "participant_league_affiliations_participant_id_sport_league_key" ON "participant_league_affiliations"("participant_id", "sport_league_id");

-- CreateIndex
CREATE INDEX "participants_sport_id_status_idx" ON "participants"("sport_id", "status");

-- CreateIndex
CREATE INDEX "participants_sport_id_name_idx" ON "participants"("sport_id", "name");

-- CreateIndex
CREATE INDEX "participants_name_trgm_idx" ON "participants" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "participants_first_name_trgm_idx" ON "participants" USING GIN ("first_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "participants_last_name_trgm_idx" ON "participants" USING GIN ("last_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "participants_short_name_trgm_idx" ON "participants" USING GIN ("short_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "participants_team_affiliation_trgm_idx" ON "participants" USING GIN ("team_affiliation" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "participant_provider_mappings_participant_id_idx" ON "participant_provider_mappings"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "participant_provider_mappings_provider_id_external_id_key" ON "participant_provider_mappings"("provider_id", "external_id");

-- CreateIndex
CREATE INDEX "contests_league_id_season_year_idx" ON "contests"("league_id", "season_year");

-- CreateIndex
CREATE INDEX "contests_status_idx" ON "contests"("status");

-- CreateIndex
CREATE INDEX "contests_next_reminder_at_idx" ON "contests"("next_reminder_at");

-- CreateIndex
CREATE INDEX "cups_sport_league_id_idx" ON "cups"("sport_league_id");

-- CreateIndex
CREATE UNIQUE INDEX "cups_league_id_season_year_sport_league_id_key" ON "cups"("league_id", "season_year", "sport_league_id");

-- CreateIndex
CREATE INDEX "cup_standings_squad_id_idx" ON "cup_standings"("squad_id");

-- CreateIndex
CREATE UNIQUE INDEX "cup_standings_cup_id_squad_id_key" ON "cup_standings"("cup_id", "squad_id");

-- CreateIndex
CREATE INDEX "league_year_finishes_league_id_year_idx" ON "league_year_finishes"("league_id", "year");

-- CreateIndex
CREATE INDEX "league_year_finishes_squad_id_idx" ON "league_year_finishes"("squad_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_year_finishes_contest_id_squad_id_key" ON "league_year_finishes"("contest_id", "squad_id");

-- CreateIndex
CREATE INDEX "league_year_reviews_sent_by_user_id_idx" ON "league_year_reviews"("sent_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_year_reviews_league_id_year_key" ON "league_year_reviews"("league_id", "year");

-- CreateIndex
CREATE INDEX "contest_sport_events_sport_event_id_idx" ON "contest_sport_events"("sport_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_sport_events_contest_id_sport_event_id_key" ON "contest_sport_events"("contest_id", "sport_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_sport_events_contest_id_sequence_key" ON "contest_sport_events"("contest_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "contest_configurations_contest_id_key" ON "contest_configurations"("contest_id");

-- CreateIndex
CREATE INDEX "contest_configurations_template_id_idx" ON "contest_configurations"("template_id");

-- CreateIndex
CREATE INDEX "contest_config_templates_sport_contest_type_active_sort_ord_idx" ON "contest_config_templates"("sport", "contest_type", "active", "sort_order");

-- CreateIndex
CREATE INDEX "contest_config_templates_sport_league_id_idx" ON "contest_config_templates"("sport_league_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_config_templates_sport_event_type_contest_type_sele_key" ON "contest_config_templates"("sport", "event_type", "contest_type", "selection_type", "template_key");

-- CreateIndex
CREATE INDEX "event_pages_redirect_to_page_id_idx" ON "event_pages"("redirect_to_page_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_pages_sport_slug_key" ON "event_pages"("sport", "slug");

-- CreateIndex
CREATE INDEX "event_page_offers_sport_league_id_idx" ON "event_page_offers"("sport_league_id");

-- CreateIndex
CREATE INDEX "event_page_offers_template_id_idx" ON "event_page_offers"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_page_offers_event_page_id_sort_order_key" ON "event_page_offers"("event_page_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "participant_contest_scoring_rules_contest_configuration_id__key" ON "participant_contest_scoring_rules"("contest_configuration_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "contest_prize_definitions_contest_configuration_id_sort_ord_key" ON "contest_prize_definitions"("contest_configuration_id", "sort_order");

-- CreateIndex
CREATE INDEX "contest_entries_squad_id_idx" ON "contest_entries"("squad_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entries_contest_id_squad_id_entry_number_key" ON "contest_entries"("contest_id", "squad_id", "entry_number");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entries_id_contest_id_key" ON "contest_entries"("id", "contest_id");

-- CreateIndex
CREATE INDEX "contest_entry_events_sport_event_id_idx" ON "contest_entry_events"("sport_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entry_events_contest_entry_id_sport_event_id_key" ON "contest_entry_events"("contest_entry_id", "sport_event_id");

-- CreateIndex
CREATE INDEX "contest_entry_match_predictions_sport_event_match_id_idx" ON "contest_entry_match_predictions"("sport_event_match_id");

-- CreateIndex
CREATE INDEX "contest_entry_match_predictions_sport_event_participant_id_idx" ON "contest_entry_match_predictions"("sport_event_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entry_match_predictions_contest_entry_id_sport_even_key" ON "contest_entry_match_predictions"("contest_entry_id", "sport_event_match_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entry_standings_contest_entry_id_key" ON "contest_entry_standings"("contest_entry_id");

-- CreateIndex
CREATE INDEX "contest_entry_standings_contest_id_position_idx" ON "contest_entry_standings"("contest_id", "position");

-- CreateIndex
CREATE INDEX "contest_entry_event_standings_contest_id_sport_event_id_pos_idx" ON "contest_entry_event_standings"("contest_id", "sport_event_id", "position");

-- CreateIndex
CREATE INDEX "contest_entry_event_standings_sport_event_id_idx" ON "contest_entry_event_standings"("sport_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entry_event_standings_contest_entry_id_sport_event__key" ON "contest_entry_event_standings"("contest_entry_id", "sport_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_draws_contest_id_key" ON "contest_draws"("contest_id");

-- CreateIndex
CREATE INDEX "contest_draws_drawn_by_user_id_idx" ON "contest_draws"("drawn_by_user_id");

-- CreateIndex
CREATE INDEX "contest_draws_receipts_pending_sport_event_id_idx" ON "contest_draws"("receipts_pending_sport_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_squares_games_contest_id_key" ON "contest_squares_games"("contest_id");

-- CreateIndex
CREATE INDEX "contest_squares_games_sport_event_match_id_idx" ON "contest_squares_games"("sport_event_match_id");

-- CreateIndex
CREATE INDEX "contest_entry_squares_contest_entry_id_idx" ON "contest_entry_squares"("contest_entry_id");

-- CreateIndex
CREATE INDEX "contest_entry_squares_claimed_by_user_id_idx" ON "contest_entry_squares"("claimed_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entry_squares_contest_id_row_index_column_index_key" ON "contest_entry_squares"("contest_id", "row_index", "column_index");

-- CreateIndex
CREATE UNIQUE INDEX "contest_squares_draws_contest_id_key" ON "contest_squares_draws"("contest_id");

-- CreateIndex
CREATE INDEX "contest_squares_draws_drawn_by_user_id_idx" ON "contest_squares_draws"("drawn_by_user_id");

-- CreateIndex
CREATE INDEX "contest_squares_winners_contest_entry_id_idx" ON "contest_squares_winners"("contest_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_squares_winners_contest_id_period_number_key" ON "contest_squares_winners"("contest_id", "period_number");

-- CreateIndex
CREATE INDEX "contest_entry_picks_entry_id_idx" ON "contest_entry_picks"("entry_id");

-- CreateIndex
CREATE INDEX "contest_entry_picks_sport_event_participant_id_idx" ON "contest_entry_picks"("sport_event_participant_id");

-- CreateIndex
CREATE INDEX "sport_events_event_year_idx" ON "sport_events"("event_year");

-- CreateIndex
CREATE INDEX "sport_events_sport_status_idx" ON "sport_events"("sport", "status");

-- CreateIndex
CREATE INDEX "sport_events_start_date_end_date_idx" ON "sport_events"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "sport_events_status_idx" ON "sport_events"("status");

-- CreateIndex
CREATE INDEX "sport_events_name_trgm_idx" ON "sport_events" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "sport_events_provider_id_external_id_key" ON "sport_events"("provider_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_events_event_series_id_event_year_key" ON "sport_events"("event_series_id", "event_year");

-- CreateIndex
CREATE INDEX "sport_event_participants_participant_id_idx" ON "sport_event_participants"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_participants_sport_event_id_participant_id_key" ON "sport_event_participants"("sport_event_id", "participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_rounds_sport_event_id_round_number_key" ON "sport_event_rounds"("sport_event_id", "round_number");

-- CreateIndex
CREATE INDEX "sport_event_matches_sport_event_round_id_idx" ON "sport_event_matches"("sport_event_round_id");

-- CreateIndex
CREATE INDEX "sport_event_matches_home_sport_event_participant_id_idx" ON "sport_event_matches"("home_sport_event_participant_id");

-- CreateIndex
CREATE INDEX "sport_event_matches_away_sport_event_participant_id_idx" ON "sport_event_matches"("away_sport_event_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_matches_sport_event_id_match_number_key" ON "sport_event_matches"("sport_event_id", "match_number");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_matches_sport_event_id_external_game_id_key" ON "sport_event_matches"("sport_event_id", "external_game_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_matches_advances_to_match_id_advances_to_side_key" ON "sport_event_matches"("advances_to_match_id", "advances_to_side");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_match_period_scores_sport_event_match_id_period_key" ON "sport_event_match_period_scores"("sport_event_match_id", "period_number");

-- CreateIndex
CREATE INDEX "sport_event_participant_rounds_sport_event_round_id_idx" ON "sport_event_participant_rounds"("sport_event_round_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_participant_rounds_sport_event_participant_id_s_key" ON "sport_event_participant_rounds"("sport_event_participant_id", "sport_event_round_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_participant_golf_rounds_participant_round_id_key" ON "sport_event_participant_golf_rounds"("participant_round_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_participant_stat_lines_participant_round_id_sta_key" ON "sport_event_participant_stat_lines"("participant_round_id", "stat");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_participant_standings_sport_event_participant_i_key" ON "sport_event_participant_standings"("sport_event_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_participant_golf_standings_standing_id_key" ON "sport_event_participant_golf_standings"("standing_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_participant_race_results_sport_event_participan_key" ON "sport_event_participant_race_results"("sport_event_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_tiers_sport_event_id_tier_key_key" ON "sport_event_tiers"("sport_event_id", "tier_key");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_tiers_sport_event_id_tier_number_key" ON "sport_event_tiers"("sport_event_id", "tier_number");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_participant_valuations_sport_event_participant__key" ON "sport_event_participant_valuations"("sport_event_participant_id");

-- CreateIndex
CREATE INDEX "sport_event_participant_valuations_sport_event_tier_id_tier_idx" ON "sport_event_participant_valuations"("sport_event_tier_id", "tier_order_index");

-- CreateIndex
CREATE INDEX "provider_sync_runs_created_at_idx" ON "provider_sync_runs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "provider_sync_runs_provider_id_created_at_idx" ON "provider_sync_runs"("provider_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "provider_sync_runs_sport_created_at_idx" ON "provider_sync_runs"("sport", "created_at" DESC);

-- CreateIndex
CREATE INDEX "provider_sync_runs_status_created_at_idx" ON "provider_sync_runs"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "platform_runtime_configs_config_key_key" ON "platform_runtime_configs"("config_key");

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_dedupe_key_key" ON "background_jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "background_jobs_status_run_at_idx" ON "background_jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "background_jobs_status_lease_until_idx" ON "background_jobs"("status", "lease_until");

-- CreateIndex
CREATE INDEX "background_jobs_status_completed_at_idx" ON "background_jobs"("status", "completed_at");

-- CreateIndex
CREATE INDEX "platform_runtime_config_history_config_key_changed_at_idx" ON "platform_runtime_config_history"("config_key", "changed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "email_opt_outs_user_id_category_key" ON "email_opt_outs"("user_id", "category");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_change_undo_tokens" ADD CONSTRAINT "email_change_undo_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_payments" ADD CONSTRAINT "league_payments_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_payments" ADD CONSTRAINT "league_payments_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_payments" ADD CONSTRAINT "league_payments_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_expansions" ADD CONSTRAINT "contest_expansions_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_expansions" ADD CONSTRAINT "contest_expansions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "league_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_plan_changes" ADD CONSTRAINT "league_plan_changes_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_plan_changes" ADD CONSTRAINT "league_plan_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_plan_renewal_changes" ADD CONSTRAINT "league_plan_renewal_changes_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_plan_renewal_changes" ADD CONSTRAINT "league_plan_renewal_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_memberships" ADD CONSTRAINT "league_memberships_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_memberships" ADD CONSTRAINT "league_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squads" ADD CONSTRAINT "squads_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squads" ADD CONSTRAINT "squads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squad_memberships" ADD CONSTRAINT "squad_memberships_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squad_memberships" ADD CONSTRAINT "squad_memberships_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squad_memberships" ADD CONSTRAINT "squad_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_invitations" ADD CONSTRAINT "league_invitations_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_invitations" ADD CONSTRAINT "league_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_invitations" ADD CONSTRAINT "league_invitations_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "contest_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "league_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squad_owner_invitations" ADD CONSTRAINT "squad_owner_invitations_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squad_owner_invitations" ADD CONSTRAINT "squad_owner_invitations_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squad_owner_invitations" ADD CONSTRAINT "squad_owner_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squad_owner_invitations" ADD CONSTRAINT "squad_owner_invitations_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_leagues" ADD CONSTRAINT "sport_leagues_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_league_affiliations" ADD CONSTRAINT "participant_league_affiliations_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_league_affiliations" ADD CONSTRAINT "participant_league_affiliations_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_provider_mappings" ADD CONSTRAINT "participant_provider_mappings_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cups" ADD CONSTRAINT "cups_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cups" ADD CONSTRAINT "cups_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_standings" ADD CONSTRAINT "cup_standings_cup_id_fkey" FOREIGN KEY ("cup_id") REFERENCES "cups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_standings" ADD CONSTRAINT "cup_standings_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_year_finishes" ADD CONSTRAINT "league_year_finishes_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_year_finishes" ADD CONSTRAINT "league_year_finishes_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_year_finishes" ADD CONSTRAINT "league_year_finishes_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_year_reviews" ADD CONSTRAINT "league_year_reviews_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_year_reviews" ADD CONSTRAINT "league_year_reviews_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_sport_events" ADD CONSTRAINT "contest_sport_events_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_sport_events" ADD CONSTRAINT "contest_sport_events_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_configurations" ADD CONSTRAINT "contest_configurations_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_configurations" ADD CONSTRAINT "contest_configurations_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "contest_config_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_config_templates" ADD CONSTRAINT "contest_config_templates_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_pages" ADD CONSTRAINT "event_pages_redirect_to_page_id_fkey" FOREIGN KEY ("redirect_to_page_id") REFERENCES "event_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_page_offers" ADD CONSTRAINT "event_page_offers_event_page_id_fkey" FOREIGN KEY ("event_page_id") REFERENCES "event_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_page_offers" ADD CONSTRAINT "event_page_offers_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_page_offers" ADD CONSTRAINT "event_page_offers_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "contest_config_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_contest_scoring_rules" ADD CONSTRAINT "participant_contest_scoring_rules_contest_configuration_id_fkey" FOREIGN KEY ("contest_configuration_id") REFERENCES "contest_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_prize_definitions" ADD CONSTRAINT "contest_prize_definitions_contest_configuration_id_fkey" FOREIGN KEY ("contest_configuration_id") REFERENCES "contest_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entries" ADD CONSTRAINT "contest_entries_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entries" ADD CONSTRAINT "contest_entries_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_events" ADD CONSTRAINT "contest_entry_events_contest_entry_id_fkey" FOREIGN KEY ("contest_entry_id") REFERENCES "contest_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_events" ADD CONSTRAINT "contest_entry_events_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_match_predictions" ADD CONSTRAINT "contest_entry_match_predictions_contest_entry_id_fkey" FOREIGN KEY ("contest_entry_id") REFERENCES "contest_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_match_predictions" ADD CONSTRAINT "contest_entry_match_predictions_sport_event_match_id_fkey" FOREIGN KEY ("sport_event_match_id") REFERENCES "sport_event_matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_match_predictions" ADD CONSTRAINT "contest_entry_match_predictions_sport_event_participant_id_fkey" FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_standings" ADD CONSTRAINT "contest_entry_standings_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_standings" ADD CONSTRAINT "contest_entry_standings_contest_entry_id_fkey" FOREIGN KEY ("contest_entry_id") REFERENCES "contest_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_event_standings" ADD CONSTRAINT "contest_entry_event_standings_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_event_standings" ADD CONSTRAINT "contest_entry_event_standings_contest_entry_id_fkey" FOREIGN KEY ("contest_entry_id") REFERENCES "contest_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_event_standings" ADD CONSTRAINT "contest_entry_event_standings_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_leaderboard_snapshots" ADD CONSTRAINT "contest_leaderboard_snapshots_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_draws" ADD CONSTRAINT "contest_draws_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_draws" ADD CONSTRAINT "contest_draws_drawn_by_user_id_fkey" FOREIGN KEY ("drawn_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_draws" ADD CONSTRAINT "contest_draws_receipts_pending_sport_event_id_fkey" FOREIGN KEY ("receipts_pending_sport_event_id") REFERENCES "sport_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_squares_games" ADD CONSTRAINT "contest_squares_games_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_squares_games" ADD CONSTRAINT "contest_squares_games_sport_event_match_id_fkey" FOREIGN KEY ("sport_event_match_id") REFERENCES "sport_event_matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_squares" ADD CONSTRAINT "contest_entry_squares_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_squares" ADD CONSTRAINT "contest_entry_squares_contest_entry_id_contest_id_fkey" FOREIGN KEY ("contest_entry_id", "contest_id") REFERENCES "contest_entries"("id", "contest_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_squares" ADD CONSTRAINT "contest_entry_squares_claimed_by_user_id_fkey" FOREIGN KEY ("claimed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_squares_draws" ADD CONSTRAINT "contest_squares_draws_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_squares_draws" ADD CONSTRAINT "contest_squares_draws_drawn_by_user_id_fkey" FOREIGN KEY ("drawn_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_squares_winners" ADD CONSTRAINT "contest_squares_winners_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_squares_winners" ADD CONSTRAINT "contest_squares_winners_contest_entry_id_fkey" FOREIGN KEY ("contest_entry_id") REFERENCES "contest_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_picks" ADD CONSTRAINT "contest_entry_picks_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "contest_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_picks" ADD CONSTRAINT "contest_entry_picks_sport_event_participant_id_fkey" FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_event_series_id_fkey" FOREIGN KEY ("event_series_id") REFERENCES "event_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participants" ADD CONSTRAINT "sport_event_participants_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participants" ADD CONSTRAINT "sport_event_participants_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_rounds" ADD CONSTRAINT "sport_event_rounds_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_matches" ADD CONSTRAINT "sport_event_matches_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_matches" ADD CONSTRAINT "sport_event_matches_sport_event_round_id_fkey" FOREIGN KEY ("sport_event_round_id") REFERENCES "sport_event_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_matches" ADD CONSTRAINT "sport_event_matches_home_sport_event_participant_id_fkey" FOREIGN KEY ("home_sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_matches" ADD CONSTRAINT "sport_event_matches_away_sport_event_participant_id_fkey" FOREIGN KEY ("away_sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_matches" ADD CONSTRAINT "sport_event_matches_advances_to_match_id_fkey" FOREIGN KEY ("advances_to_match_id") REFERENCES "sport_event_matches"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_match_period_scores" ADD CONSTRAINT "sport_event_match_period_scores_sport_event_match_id_fkey" FOREIGN KEY ("sport_event_match_id") REFERENCES "sport_event_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_rounds" ADD CONSTRAINT "sport_event_participant_rounds_sport_event_participant_id_fkey" FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_rounds" ADD CONSTRAINT "sport_event_participant_rounds_sport_event_round_id_fkey" FOREIGN KEY ("sport_event_round_id") REFERENCES "sport_event_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_golf_rounds" ADD CONSTRAINT "sport_event_participant_golf_rounds_participant_round_id_fkey" FOREIGN KEY ("participant_round_id") REFERENCES "sport_event_participant_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_stat_lines" ADD CONSTRAINT "sport_event_participant_stat_lines_participant_round_id_fkey" FOREIGN KEY ("participant_round_id") REFERENCES "sport_event_participant_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_standings" ADD CONSTRAINT "sport_event_participant_standings_sport_event_participant__fkey" FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_golf_standings" ADD CONSTRAINT "sport_event_participant_golf_standings_standing_id_fkey" FOREIGN KEY ("standing_id") REFERENCES "sport_event_participant_standings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_race_results" ADD CONSTRAINT "sport_event_participant_race_results_sport_event_participa_fkey" FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_tiers" ADD CONSTRAINT "sport_event_tiers_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_valuations" ADD CONSTRAINT "sport_event_participant_valuations_sport_event_participant_fkey" FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_valuations" ADD CONSTRAINT "sport_event_participant_valuations_sport_event_tier_id_fkey" FOREIGN KEY ("sport_event_tier_id") REFERENCES "sport_event_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_opt_outs" ADD CONSTRAINT "email_opt_outs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- What schema.prisma cannot declare. Everything above is generated from the schema; everything
-- below was built by the pre-squash history by hand and is kept here verbatim from that database.
-- ---------------------------------------------------------------------------------------------

-- Scalar lists: Prisma never emits NOT NULL for them, but the history made these NOT NULL.
ALTER TABLE "contest_config_templates" ALTER COLUMN "event_series_names" SET NOT NULL;
ALTER TABLE "cups" ALTER COLUMN "crowned_custom_points" SET NOT NULL;
ALTER TABLE "leagues" ALTER COLUMN "cup_custom_points" SET NOT NULL;
ALTER TABLE "leagues" ALTER COLUMN "muted_sport_league_ids" SET NOT NULL;
ALTER TABLE "sport_leagues" ALTER COLUMN "round_names" SET NOT NULL;
ALTER TABLE "sport_leagues" ALTER COLUMN "round_series_lengths" SET NOT NULL;

-- Partial unique indexes.
CREATE UNIQUE INDEX uq_pick_roster_participant ON contest_entry_picks USING btree (entry_id, sport_event_participant_id) WHERE (contest_format = 'ROSTER'::"PrismaContestFormat");
CREATE UNIQUE INDEX event_page_offers_one_primary_key ON event_page_offers USING btree (event_page_id) WHERE is_primary;

-- CHECK constraints.
ALTER TABLE "background_jobs" ADD CONSTRAINT background_jobs_completed_when_finished CHECK (((status <> ALL (ARRAY['SUCCEEDED'::"PrismaBackgroundJobStatus", 'FAILED'::"PrismaBackgroundJobStatus"])) OR (completed_at IS NOT NULL)));
ALTER TABLE "background_jobs" ADD CONSTRAINT background_jobs_leased_when_running CHECK (((status <> 'RUNNING'::"PrismaBackgroundJobStatus") OR (lease_until IS NOT NULL)));
ALTER TABLE "contest_entry_match_predictions" ADD CONSTRAINT contest_entry_match_predictions_confidence_positive CHECK (((confidence IS NULL) OR (confidence >= 1)));
ALTER TABLE "contest_entry_match_predictions" ADD CONSTRAINT contest_entry_match_predictions_team_with_team_result CHECK (((predicted_result = 'TEAM'::"PrismaPredictedResult") = (sport_event_participant_id IS NOT NULL)));
ALTER TABLE "contest_entry_squares" ADD CONSTRAINT contest_entry_squares_position_check CHECK ((((row_index >= 0) AND (row_index <= 9)) AND ((column_index >= 0) AND (column_index <= 9))));
ALTER TABLE "contest_expansions" ADD CONSTRAINT contest_expansions_entries_per_contest_positive CHECK ((entries_per_contest >= 1));
ALTER TABLE "contest_squares_draws" ADD CONSTRAINT contest_squares_draws_digits_check CHECK (((array_length(row_digits, 1) = 10) AND (row_digits @> ARRAY[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) AND (array_length(column_digits, 1) = 10) AND (column_digits @> ARRAY[0, 1, 2, 3, 4, 5, 6, 7, 8, 9])));
ALTER TABLE "contest_squares_winners" ADD CONSTRAINT contest_squares_winners_values_check CHECK (((period_number >= 1) AND (home_score >= 0) AND (away_score >= 0) AND ((row_index >= 0) AND (row_index <= 9)) AND ((column_index >= 0) AND (column_index <= 9))));
ALTER TABLE "cups" ADD CONSTRAINT cups_crowned_check CHECK ((((status = 'CROWNED'::"PrismaCupStatus") = (crowned_at IS NOT NULL)) AND ((status = 'CROWNED'::"PrismaCupStatus") = (crowned_points_scale IS NOT NULL)) AND ((NOT (crowned_points_scale IS DISTINCT FROM 'CUSTOM'::"PrismaCupPointsScale")) = (cardinality(crowned_custom_points) > 0))));
ALTER TABLE "email_messages" ADD CONSTRAINT email_messages_due_when_queued CHECK (((status <> ALL (ARRAY['QUEUED'::"PrismaEmailMessageStatus", 'SENDING'::"PrismaEmailMessageStatus"])) OR (next_attempt_at IS NOT NULL)));
ALTER TABLE "email_messages" ADD CONSTRAINT email_messages_skip_reason_when_skipped CHECK (((status = 'SKIPPED'::"PrismaEmailMessageStatus") = (skip_reason IS NOT NULL)));
ALTER TABLE "email_suppressions" ADD CONSTRAINT email_suppressions_email_lower_case CHECK (((email)::text = lower((email)::text)));
ALTER TABLE "event_page_offers" ADD CONSTRAINT event_page_offers_bracket_start_round_check CHECK (((bracket_start_round IS NULL) OR (bracket_start_round >= 1)));
ALTER TABLE "event_pages" ADD CONSTRAINT event_pages_redirect_check CHECK (((redirect_to_page_id IS NULL) OR (redirect_to_page_id <> id)));
ALTER TABLE "event_pages" ADD CONSTRAINT event_pages_slug_check CHECK (((slug)::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text));
ALTER TABLE "league_payments" ADD CONSTRAINT league_payments_amount_cents_not_negative CHECK ((amount_cents >= 0));
ALTER TABLE "leagues" ADD CONSTRAINT leagues_cup_custom_points_check CHECK (((cup_points_scale = 'CUSTOM'::"PrismaCupPointsScale") = (cardinality(cup_custom_points) > 0)));
ALTER TABLE "sport_event_match_period_scores" ADD CONSTRAINT sport_event_match_period_scores_period_number_check CHECK ((period_number >= 1));
ALTER TABLE "sport_event_match_period_scores" ADD CONSTRAINT sport_event_match_period_scores_scores_check CHECK (((home_score >= 0) AND (away_score >= 0)));
ALTER TABLE "sport_event_matches" ADD CONSTRAINT sport_event_matches_advances_elsewhere CHECK (((advances_to_match_id IS NULL) OR (advances_to_match_id <> id)));
ALTER TABLE "sport_event_matches" ADD CONSTRAINT sport_event_matches_advances_to_side_with_match CHECK (((advances_to_match_id IS NULL) = (advances_to_side IS NULL)));
ALTER TABLE "sport_event_matches" ADD CONSTRAINT sport_event_matches_ending_check CHECK (((ending = 'PLAYED'::"PrismaMatchEnding") OR ((status = 'COMPLETED'::"PrismaMatchStatus") AND (winner_side IS NOT NULL) AND ((ending <> 'WALKOVER'::"PrismaMatchEnding") OR ((home_score IS NULL) AND (away_score IS NULL))))));
ALTER TABLE "sport_event_matches" ADD CONSTRAINT sport_event_matches_home_spread_half_points_check CHECK (((home_spread IS NULL) OR ((home_spread * (2)::numeric) = trunc((home_spread * (2)::numeric)))));
ALTER TABLE "sport_event_matches" ADD CONSTRAINT sport_event_matches_match_number_positive CHECK ((match_number >= 1));
ALTER TABLE "sport_event_matches" ADD CONSTRAINT sport_event_matches_scores_not_negative CHECK ((((home_score IS NULL) OR (home_score >= 0)) AND ((away_score IS NULL) OR (away_score >= 0))));
ALTER TABLE "sport_event_matches" ADD CONSTRAINT sport_event_matches_shootout_scores_check CHECK ((((home_shootout_score IS NULL) AND (away_shootout_score IS NULL)) OR ((home_shootout_score IS NOT NULL) AND (away_shootout_score IS NOT NULL) AND (home_shootout_score >= 0) AND (away_shootout_score >= 0))));
ALTER TABLE "sport_event_matches" ADD CONSTRAINT sport_event_matches_sides_differ CHECK (((home_sport_event_participant_id IS NULL) OR (away_sport_event_participant_id IS NULL) OR (home_sport_event_participant_id <> away_sport_event_participant_id)));
ALTER TABLE "sport_event_matches" ADD CONSTRAINT sport_event_matches_winner_only_when_completed CHECK (((winner_side IS NULL) OR (status = 'COMPLETED'::"PrismaMatchStatus")));
ALTER TABLE "sport_event_participant_race_results" ADD CONSTRAINT race_results_finish_position_positive CHECK (((finish_position IS NULL) OR (finish_position >= 1)));
ALTER TABLE "sport_event_participant_race_results" ADD CONSTRAINT race_results_official_finisher_has_place CHECK (((NOT is_official) OR (result_status <> 'FINISHED'::"RaceResultStatus") OR (finish_position IS NOT NULL)));
ALTER TABLE "sport_event_participant_race_results" ADD CONSTRAINT race_results_place_only_when_finished CHECK (((finish_position IS NULL) OR (result_status = 'FINISHED'::"RaceResultStatus")));
ALTER TABLE "sport_event_participant_race_results" ADD CONSTRAINT race_results_start_position_positive CHECK (((start_position IS NULL) OR (start_position >= 1)));
ALTER TABLE "sport_leagues" ADD CONSTRAINT sport_leagues_round_series_lengths_check CHECK ((round_series_lengths <@ ARRAY[1, 3, 5, 7, 9]));
ALTER TABLE "sport_leagues" ADD CONSTRAINT sport_leagues_squares_from_round_check CHECK (((squares_from_round IS NULL) OR (squares_from_round >= 1)));
ALTER TABLE "sport_leagues" ADD CONSTRAINT sport_leagues_tier_count_positive CHECK (((tier_count IS NULL) OR (tier_count >= 1)));
