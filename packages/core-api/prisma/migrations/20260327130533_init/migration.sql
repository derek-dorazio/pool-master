-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan_tier" TEXT NOT NULL DEFAULT 'free',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "default_locale" VARCHAR(10) NOT NULL DEFAULT 'en-US',
    "default_timezone" VARCHAR(50) NOT NULL DEFAULT 'America/New_York',
    "default_currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "display_name" TEXT NOT NULL,
    "auth_provider" TEXT,
    "auth_id" TEXT,
    "tenant_id" UUID NOT NULL,
    "timezone" VARCHAR(50),
    "locale" VARCHAR(10) DEFAULT 'en-US',
    "time_format" VARCHAR(5) DEFAULT '12H',
    "date_format" VARCHAR(5) DEFAULT 'MDY',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leagues" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by" UUID NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "max_members" INTEGER NOT NULL DEFAULT 20,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_memberships" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MANAGER',
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "league_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_invitations" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "email" VARCHAR(255),
    "invite_code" VARCHAR(100) NOT NULL,
    "invite_type" VARCHAR(20) NOT NULL DEFAULT 'EMAIL',
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "commissioner_audit_log" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "contest_id" UUID,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "reason" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissioner_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissioner_action_items" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "contest_id" UUID,
    "type" VARCHAR(50) NOT NULL,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "action_url" VARCHAR(500),
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commissioner_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_templates" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "sport" VARCHAR(50) NOT NULL,
    "contest_type" VARCHAR(50) NOT NULL,
    "draft_config" JSONB NOT NULL DEFAULT '{}',
    "scoring_config" JSONB NOT NULL DEFAULT '{}',
    "payout_config" JSONB NOT NULL DEFAULT '{}',
    "pool_config" JSONB NOT NULL DEFAULT '{}',
    "shared_with_tenant" BOOLEAN NOT NULL DEFAULT false,
    "is_platform_template" BOOLEAN NOT NULL DEFAULT false,
    "times_used" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sports" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "participant_type" TEXT NOT NULL,
    "stat_schema" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "sport_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL,
    "sport_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "participant_type" TEXT NOT NULL,
    "external_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "short_name" VARCHAR(100),
    "nationality" VARCHAR(10),
    "position" VARCHAR(50),
    "team_affiliation" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "injury_status" JSONB NOT NULL DEFAULT '{"status": "HEALTHY"}',
    "photo_url" TEXT,
    "photo_last_updated" TIMESTAMPTZ,
    "external_ids" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_season_records" (
    "id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "sport" VARCHAR(50) NOT NULL,
    "season" VARCHAR(20) NOT NULL,
    "rankings" JSONB NOT NULL DEFAULT '[]',
    "budget_price" INTEGER NOT NULL DEFAULT 0,
    "price_tier" VARCHAR(50),
    "price_updated_at" TIMESTAMPTZ,
    "events_entered" INTEGER NOT NULL DEFAULT 0,
    "events_completed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "top_5_finishes" INTEGER NOT NULL DEFAULT 0,
    "top_10_finishes" INTEGER NOT NULL DEFAULT 0,
    "top_25_finishes" INTEGER NOT NULL DEFAULT 0,
    "season_stats" JSONB NOT NULL DEFAULT '{}',
    "form_rating" DECIMAL(5,2) NOT NULL DEFAULT 50.0,
    "form_trend" VARCHAR(20) NOT NULL DEFAULT 'STABLE',
    "last_updated" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "participant_season_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_provider_mappings" (
    "id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "provider_id" VARCHAR(100) NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "confidence" VARCHAR(20) NOT NULL DEFAULT 'EXACT',
    "mapped_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "participant_provider_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contests" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "season_id" UUID,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "contest_type" TEXT NOT NULL,
    "selection_type" TEXT NOT NULL,
    "scoring_engine" TEXT NOT NULL,
    "is_exclusive" BOOLEAN NOT NULL DEFAULT false,
    "scoring_stops_on_elimination" BOOLEAN NOT NULL DEFAULT false,
    "scoring_rules" JSONB NOT NULL DEFAULT '{}',
    "payout_config" JSONB NOT NULL DEFAULT '{}',
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "lock_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "selection_configs" (
    "id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "selection_type" TEXT NOT NULL,
    "draft_mode" TEXT,
    "rounds" INTEGER,
    "time_per_pick_seconds" INTEGER,
    "auto_pick_policy" TEXT,
    "tier_config" JSONB,
    "tier_assignment_method" TEXT,
    "budget" INTEGER,
    "pricing_method" TEXT,
    "roster_size" INTEGER,
    "pick_count" INTEGER,
    "survivor_style" TEXT,
    "picks_per_period" INTEGER,
    "one_entity_per_season" BOOLEAN,
    "strikes_before_elimination" INTEGER,
    "buybacks_allowed" BOOLEAN,
    "round_values" JSONB,
    "start_round" TEXT,
    "is_exclusive" BOOLEAN NOT NULL DEFAULT false,
    "best_ball_n" INTEGER,
    "missed_cut_penalty" INTEGER,
    "captain_slot" BOOLEAN,
    "captain_multiplier" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "selection_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_pools" (
    "id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "sport" VARCHAR(50) NOT NULL,
    "event_id" UUID,
    "pool_type" VARCHAR(50) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "excluded_participant_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "pool_locked" BOOLEAN NOT NULL DEFAULT false,
    "pool_locked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_participant_pool" (
    "id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "cost" INTEGER,
    "tier" TEXT,
    "tier_assignment_method" TEXT,
    "ranking" INTEGER,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "unavailable_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_participant_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entries" (
    "id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "league_membership_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "total_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "is_eliminated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_picks" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "draft_round" INTEGER,
    "draft_pick_number" INTEGER,
    "picked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auto_picked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "roster_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_picks" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "period" INTEGER NOT NULL,
    "period_label" TEXT,
    "picked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_correct" BOOLEAN,
    "confidence_weight" INTEGER,
    "multiplier" DOUBLE PRECISION,
    "is_replacement" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bracket_predictions" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "predictions" JSONB NOT NULL DEFAULT '[]',
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tiebreaker_value" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bracket_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_sessions" (
    "id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "current_pick_number" INTEGER NOT NULL DEFAULT 0,
    "current_entry_id" UUID,
    "started_at" TIMESTAMPTZ,
    "pick_deadline" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "draft_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_picks" (
    "id" UUID NOT NULL,
    "draft_session_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "pick_number" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "pick_in_round" INTEGER NOT NULL,
    "picked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auto_picked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "draft_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_standings" (
    "id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "total_score" DOUBLE PRECISION NOT NULL,
    "last_updated_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_results" (
    "id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "final_rank" INTEGER NOT NULL,
    "total_score" DOUBLE PRECISION NOT NULL,
    "prize_amount" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "league_id" UUID,
    "season_id" UUID,
    "league_membership_id" UUID,
    "contest_name" TEXT,
    "contest_type" VARCHAR(50),
    "sport" VARCHAR(50),
    "num_entries" INTEGER,
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "is_winner" BOOLEAN NOT NULL DEFAULT false,
    "is_paid_position" BOOLEAN NOT NULL DEFAULT false,
    "entry_fee_paid" INTEGER,
    "prize_label" VARCHAR(100),
    "net_result" INTEGER,
    "percentile_rank" DOUBLE PRECISION,
    "points_behind_winner" DOUBLE PRECISION,
    "points_behind_next" DOUBLE PRECISION,
    "draft_position" INTEGER,
    "roster_snapshot_id" UUID,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "contest_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_roster_history" (
    "id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "locked_at" TIMESTAMPTZ NOT NULL,
    "roster" JSONB NOT NULL DEFAULT '[]',
    "draft_budget_used" INTEGER,
    "tiers_selected" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_roster_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_history" (
    "id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "league_membership_id" UUID NOT NULL,
    "prize_type" VARCHAR(50) NOT NULL,
    "prize_label" VARCHAR(255) NOT NULL,
    "prize_rank" INTEGER,
    "amount" INTEGER NOT NULL,
    "is_cash" BOOLEAN NOT NULL DEFAULT true,
    "non_cash_description" TEXT,
    "paid_at" TIMESTAMPTZ,
    "acknowledged_by_member" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_checkpoints" (
    "id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "checkpoint_label" VARCHAR(100) NOT NULL,
    "checkpoint_type" VARCHAR(50) NOT NULL,
    "checkpoint_order" INTEGER NOT NULL,
    "standings" JSONB NOT NULL DEFAULT '[]',
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoring_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_records" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "scope" VARCHAR(30) NOT NULL,
    "record_value" DOUBLE PRECISION NOT NULL,
    "record_label" VARCHAR(255) NOT NULL,
    "held_by_member_id" UUID NOT NULL,
    "held_by_member_name" VARCHAR(255) NOT NULL,
    "set_in_contest_id" UUID,
    "set_in_season_id" UUID,
    "set_at" TIMESTAMPTZ NOT NULL,
    "previous_record" JSONB,
    "is_tied" BOOLEAN NOT NULL DEFAULT false,
    "tied_with" UUID[] DEFAULT ARRAY[]::UUID[],
    "last_computed_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "league_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rivalry_records" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "member_a_id" UUID NOT NULL,
    "member_b_id" UUID NOT NULL,
    "total_contests_shared" INTEGER NOT NULL DEFAULT 0,
    "member_a_higher_finishes" INTEGER NOT NULL DEFAULT 0,
    "member_b_higher_finishes" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "member_a_total_points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "member_b_total_points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "current_streak" JSONB,
    "longest_streak" JSONB,
    "biggest_margin" JSONB,
    "closest_finish" JSONB,
    "last_contest_at" TIMESTAMPTZ,
    "last_updated_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rivalry_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_season_summaries" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "season_id" UUID,
    "season_name" TEXT NOT NULL,
    "sport" VARCHAR(50),
    "year" INTEGER,
    "num_members" INTEGER NOT NULL DEFAULT 0,
    "num_contests" INTEGER NOT NULL DEFAULT 0,
    "total_prize_pool" INTEGER NOT NULL DEFAULT 0,
    "champions" JSONB NOT NULL DEFAULT '[]',
    "highlights" JSONB NOT NULL DEFAULT '{}',
    "commissioner_note" TEXT,
    "opened_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "league_season_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trophies" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "league_membership_id" UUID NOT NULL,
    "trophy_type" VARCHAR(50) NOT NULL,
    "season_id" UUID,
    "contest_id" UUID,
    "label" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "awarded_at" TIMESTAMPTZ NOT NULL,
    "is_displayed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trophies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_events" (
    "id" UUID NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "provider_id" VARCHAR(100) NOT NULL,
    "sport" VARCHAR(50) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "venue" VARCHAR(500),
    "location" VARCHAR(500),
    "start_date" TIMESTAMPTZ NOT NULL,
    "end_date" TIMESTAMPTZ,
    "status" VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
    "rounds" INTEGER,
    "participant_count" INTEGER,
    "field_locked" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_jobs" (
    "id" UUID NOT NULL,
    "job_type" VARCHAR(50) NOT NULL,
    "provider_id" VARCHAR(100) NOT NULL,
    "sport" VARCHAR(50) NOT NULL,
    "event_external_id" VARCHAR(255),
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "records_processed" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "error_log" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_health_log" (
    "id" UUID NOT NULL,
    "provider_id" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "error_rate" DECIMAL(5,4),
    "avg_latency_ms" INTEGER,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_health_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "body" TEXT NOT NULL,
    "image_url" TEXT,
    "action_screen" VARCHAR(100),
    "action_params" JSONB NOT NULL DEFAULT '{}',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "group_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "do_not_disturb" BOOLEAN NOT NULL DEFAULT false,
    "dnd_schedule" JSONB,
    "category_preferences" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "push_title" VARCHAR(255),
    "push_body" TEXT,
    "email_subject" VARCHAR(255),
    "email_html" TEXT,
    "email_text" TEXT,
    "in_app_title" VARCHAR(255),
    "in_app_body" TEXT,
    "in_app_icon" VARCHAR(50),
    "sms_body" VARCHAR(160),
    "category" VARCHAR(50) NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_registrations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "token" TEXT NOT NULL,
    "app_version" VARCHAR(50),
    "os_version" VARCHAR(50),
    "device_model" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_notifications" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "fire_at" TIMESTAMPTZ NOT NULL,
    "context" JSONB NOT NULL,
    "source_type" VARCHAR(50) NOT NULL,
    "source_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "cancelled_reason" VARCHAR(255),
    "fired_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery_log" (
    "id" UUID NOT NULL,
    "notification_event_id" VARCHAR(255) NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "suppression_reason" VARCHAR(255),
    "provider_message_id" VARCHAR(255),
    "sent_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "opened_at" TIMESTAMPTZ,
    "tapped_at" TIMESTAMPTZ,
    "failed_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_delivery_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discoverable_leagues" (
    "league_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "photo_url" TEXT,
    "sports" VARCHAR(50)[],
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "max_members" INTEGER,
    "active_contest_count" INTEGER NOT NULL DEFAULT 0,
    "activity_level" VARCHAR(20) NOT NULL DEFAULT 'LOW',
    "join_policy" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "reported_count" INTEGER NOT NULL DEFAULT 0,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "last_activity_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "discoverable_leagues_pkey" PRIMARY KEY ("league_id")
);

-- CreateTable
CREATE TABLE "discoverable_contests" (
    "contest_id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "league_name" VARCHAR(255),
    "contest_name" VARCHAR(255) NOT NULL,
    "sport" VARCHAR(50) NOT NULL,
    "event_name" VARCHAR(500),
    "draft_type" VARCHAR(50),
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "max_members" INTEGER,
    "entry_fee" INTEGER,
    "prize_pool" INTEGER,
    "draft_start" TIMESTAMPTZ,
    "lock_time" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discoverable_contests_pkey" PRIMARY KEY ("contest_id")
);

-- CreateTable
CREATE TABLE "discovery_reports" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" UUID NOT NULL,
    "reported_by" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_locale_preferences" (
    "user_id" UUID NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'en-US',
    "timezone" VARCHAR(50),
    "time_format" VARCHAR(5) NOT NULL DEFAULT '12H',
    "date_format" VARCHAR(5) NOT NULL DEFAULT 'MDY',
    "first_day_of_week" VARCHAR(10) NOT NULL DEFAULT 'SUNDAY',
    "preferred_currency" VARCHAR(3),
    "device_locale" VARCHAR(10),
    "device_timezone" VARCHAR(50),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_locale_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "consent_type" VARCHAR(50) NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "download_url" TEXT,
    "download_expires_at" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_deletion_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,

    CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_exclusions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exclusion_type" VARCHAR(20) NOT NULL,
    "duration" VARCHAR(20) NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ,
    "reactivated_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "self_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_enforcement" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "level" VARCHAR(30) NOT NULL,
    "reason" TEXT NOT NULL,
    "trigger" VARCHAR(50) NOT NULL,
    "enforced_by" UUID,
    "starts_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ,
    "appeal_status" VARCHAR(20),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_enforcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_job_runs" (
    "id" UUID NOT NULL,
    "job_name" VARCHAR(100) NOT NULL,
    "records_processed" INTEGER NOT NULL DEFAULT 0,
    "records_deleted" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,

    CONSTRAINT "retention_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'VIEWER',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sso_provider_id" VARCHAR(255),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" VARCHAR(255),
    "last_login_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "admin_user_email" VARCHAR(255) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "resource_id" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "flag_type" VARCHAR(20) NOT NULL DEFAULT 'BOOLEAN',
    "enabled_globally" BOOLEAN NOT NULL DEFAULT false,
    "rollout_percentage" INTEGER,
    "owner" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flag_overrides" (
    "id" UUID NOT NULL,
    "flag_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "feature_flag_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_announcements" (
    "id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'BANNER',
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "link_url" TEXT,
    "link_text" VARCHAR(255),
    "severity" VARCHAR(20) NOT NULL DEFAULT 'INFO',
    "dismissable" BOOLEAN NOT NULL DEFAULT true,
    "target" VARCHAR(50) NOT NULL DEFAULT 'ALL_USERS',
    "target_tenant_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_runs" (
    "id" UUID NOT NULL,
    "migration_id" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    "options" JSONB NOT NULL,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "started_by" UUID NOT NULL,

    CONSTRAINT "migration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_tiers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "monthly_price_cents" INTEGER NOT NULL DEFAULT 0,
    "annual_price_cents" INTEGER NOT NULL DEFAULT 0,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "stripe_monthly_price_id" VARCHAR(255),
    "stripe_annual_price_id" VARCHAR(255),
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plan_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_memberships_league_id_user_id_key" ON "league_memberships"("league_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_invitations_invite_code_key" ON "league_invitations"("invite_code");

-- CreateIndex
CREATE INDEX "league_invitations_league_id_status_idx" ON "league_invitations"("league_id", "status");

-- CreateIndex
CREATE INDEX "commissioner_audit_log_league_id_created_at_idx" ON "commissioner_audit_log"("league_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "commissioner_audit_log_contest_id_created_at_idx" ON "commissioner_audit_log"("contest_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "commissioner_action_items_league_id_resolved_priority_idx" ON "commissioner_action_items"("league_id", "resolved", "priority");

-- CreateIndex
CREATE INDEX "contest_templates_league_id_idx" ON "contest_templates"("league_id");

-- CreateIndex
CREATE INDEX "contest_templates_is_platform_template_idx" ON "contest_templates"("is_platform_template");

-- CreateIndex
CREATE UNIQUE INDEX "sports_name_key" ON "sports"("name");

-- CreateIndex
CREATE INDEX "participants_sport_id_idx" ON "participants"("sport_id");

-- CreateIndex
CREATE INDEX "participants_sport_id_status_idx" ON "participants"("sport_id", "status");

-- CreateIndex
CREATE INDEX "participant_season_records_sport_season_idx" ON "participant_season_records"("sport", "season");

-- CreateIndex
CREATE INDEX "participant_season_records_budget_price_idx" ON "participant_season_records"("budget_price");

-- CreateIndex
CREATE UNIQUE INDEX "participant_season_records_participant_id_season_key" ON "participant_season_records"("participant_id", "season");

-- CreateIndex
CREATE INDEX "participant_provider_mappings_participant_id_idx" ON "participant_provider_mappings"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "participant_provider_mappings_provider_id_external_id_key" ON "participant_provider_mappings"("provider_id", "external_id");

-- CreateIndex
CREATE INDEX "contests_league_id_idx" ON "contests"("league_id");

-- CreateIndex
CREATE INDEX "contests_status_idx" ON "contests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "selection_configs_contest_id_key" ON "selection_configs"("contest_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_pools_contest_id_key" ON "contest_pools"("contest_id");

-- CreateIndex
CREATE INDEX "contest_participant_pool_contest_id_idx" ON "contest_participant_pool"("contest_id");

-- CreateIndex
CREATE INDEX "contest_participant_pool_pool_id_tier_idx" ON "contest_participant_pool"("pool_id", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "contest_participant_pool_contest_id_participant_id_key" ON "contest_participant_pool"("contest_id", "participant_id");

-- CreateIndex
CREATE INDEX "contest_entries_contest_id_idx" ON "contest_entries"("contest_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entries_contest_id_league_membership_id_key" ON "contest_entries"("contest_id", "league_membership_id");

-- CreateIndex
CREATE INDEX "roster_picks_entry_id_idx" ON "roster_picks"("entry_id");

-- CreateIndex
CREATE INDEX "contest_picks_contest_id_period_idx" ON "contest_picks"("contest_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "contest_picks_entry_id_contest_id_period_key" ON "contest_picks"("entry_id", "contest_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "bracket_predictions_entry_id_key" ON "bracket_predictions"("entry_id");

-- CreateIndex
CREATE INDEX "bracket_predictions_contest_id_idx" ON "bracket_predictions"("contest_id");

-- CreateIndex
CREATE UNIQUE INDEX "draft_sessions_contest_id_key" ON "draft_sessions"("contest_id");

-- CreateIndex
CREATE INDEX "draft_picks_draft_session_id_idx" ON "draft_picks"("draft_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "draft_picks_draft_session_id_pick_number_key" ON "draft_picks"("draft_session_id", "pick_number");

-- CreateIndex
CREATE INDEX "contest_standings_contest_id_rank_idx" ON "contest_standings"("contest_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "contest_standings_contest_id_entry_id_key" ON "contest_standings"("contest_id", "entry_id");

-- CreateIndex
CREATE INDEX "contest_results_contest_id_final_rank_idx" ON "contest_results"("contest_id", "final_rank");

-- CreateIndex
CREATE INDEX "contest_results_league_id_league_membership_id_idx" ON "contest_results"("league_id", "league_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_results_contest_id_entry_id_key" ON "contest_results"("contest_id", "entry_id");

-- CreateIndex
CREATE INDEX "team_roster_history_contest_id_idx" ON "team_roster_history"("contest_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_roster_history_contest_id_entry_id_key" ON "team_roster_history"("contest_id", "entry_id");

-- CreateIndex
CREATE INDEX "payout_history_contest_id_idx" ON "payout_history"("contest_id");

-- CreateIndex
CREATE INDEX "payout_history_league_id_league_membership_id_idx" ON "payout_history"("league_id", "league_membership_id");

-- CreateIndex
CREATE INDEX "scoring_checkpoints_contest_id_checkpoint_order_idx" ON "scoring_checkpoints"("contest_id", "checkpoint_order");

-- CreateIndex
CREATE INDEX "league_records_league_id_idx" ON "league_records"("league_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_records_league_id_category_scope_key" ON "league_records"("league_id", "category", "scope");

-- CreateIndex
CREATE INDEX "rivalry_records_league_id_idx" ON "rivalry_records"("league_id");

-- CreateIndex
CREATE UNIQUE INDEX "rivalry_records_league_id_member_a_id_member_b_id_key" ON "rivalry_records"("league_id", "member_a_id", "member_b_id");

-- CreateIndex
CREATE INDEX "league_season_summaries_league_id_idx" ON "league_season_summaries"("league_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_season_summaries_league_id_season_id_key" ON "league_season_summaries"("league_id", "season_id");

-- CreateIndex
CREATE INDEX "trophies_league_id_league_membership_id_idx" ON "trophies"("league_id", "league_membership_id");

-- CreateIndex
CREATE INDEX "trophies_league_id_trophy_type_idx" ON "trophies"("league_id", "trophy_type");

-- CreateIndex
CREATE INDEX "sport_events_sport_status_idx" ON "sport_events"("sport", "status");

-- CreateIndex
CREATE INDEX "sport_events_start_date_end_date_idx" ON "sport_events"("start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "sport_events_provider_id_external_id_key" ON "sport_events"("provider_id", "external_id");

-- CreateIndex
CREATE INDEX "ingestion_jobs_status_created_at_idx" ON "ingestion_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "ingestion_jobs_provider_id_sport_idx" ON "ingestion_jobs"("provider_id", "sport");

-- CreateIndex
CREATE INDEX "provider_health_log_provider_id_recorded_at_idx" ON "provider_health_log"("provider_id", "recorded_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_created_at_idx" ON "notifications"("user_id", "read", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_group_key_idx" ON "notifications"("user_id", "group_key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_event_type_version_key" ON "notification_templates"("event_type", "version");

-- CreateIndex
CREATE INDEX "device_registrations_user_id_is_active_idx" ON "device_registrations"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "device_registrations_platform_token_key" ON "device_registrations"("platform", "token");

-- CreateIndex
CREATE INDEX "scheduled_notifications_status_fire_at_idx" ON "scheduled_notifications"("status", "fire_at");

-- CreateIndex
CREATE INDEX "notification_delivery_log_notification_event_id_idx" ON "notification_delivery_log"("notification_event_id");

-- CreateIndex
CREATE INDEX "notification_delivery_log_user_id_created_at_idx" ON "notification_delivery_log"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "discoverable_leagues_activity_level_last_activity_at_idx" ON "discoverable_leagues"("activity_level", "last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "discoverable_contests_sport_status_lock_time_idx" ON "discoverable_contests"("sport", "status", "lock_time");

-- CreateIndex
CREATE INDEX "discovery_reports_entity_type_entity_id_idx" ON "discovery_reports"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "consent_records_user_id_consent_type_idx" ON "consent_records"("user_id", "consent_type");

-- CreateIndex
CREATE INDEX "data_export_requests_user_id_status_idx" ON "data_export_requests"("user_id", "status");

-- CreateIndex
CREATE INDEX "deletion_requests_user_id_status_idx" ON "deletion_requests"("user_id", "status");

-- CreateIndex
CREATE INDEX "self_exclusions_user_id_is_active_idx" ON "self_exclusions"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "account_enforcement_user_id_created_at_idx" ON "account_enforcement"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_log_resource_type_resource_id_idx" ON "admin_audit_log"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "admin_audit_log_admin_user_id_created_at_idx" ON "admin_audit_log"("admin_user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flag_overrides_flag_id_tenant_id_key" ON "feature_flag_overrides"("flag_id", "tenant_id");

-- CreateIndex
CREATE INDEX "global_announcements_is_active_starts_at_ends_at_idx" ON "global_announcements"("is_active", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "migration_runs_status_idx" ON "migration_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "plan_tiers_slug_key" ON "plan_tiers"("slug");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_memberships" ADD CONSTRAINT "league_memberships_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_memberships" ADD CONSTRAINT "league_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_invitations" ADD CONSTRAINT "league_invitations_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_invitations" ADD CONSTRAINT "league_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_invitations" ADD CONSTRAINT "league_invitations_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioner_audit_log" ADD CONSTRAINT "commissioner_audit_log_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioner_audit_log" ADD CONSTRAINT "commissioner_audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioner_action_items" ADD CONSTRAINT "commissioner_action_items_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_templates" ADD CONSTRAINT "contest_templates_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_templates" ADD CONSTRAINT "contest_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_season_records" ADD CONSTRAINT "participant_season_records_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_provider_mappings" ADD CONSTRAINT "participant_provider_mappings_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selection_configs" ADD CONSTRAINT "selection_configs_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_pools" ADD CONSTRAINT "contest_pools_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_participant_pool" ADD CONSTRAINT "contest_participant_pool_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "contest_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_participant_pool" ADD CONSTRAINT "contest_participant_pool_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_participant_pool" ADD CONSTRAINT "contest_participant_pool_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entries" ADD CONSTRAINT "contest_entries_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entries" ADD CONSTRAINT "contest_entries_league_membership_id_fkey" FOREIGN KEY ("league_membership_id") REFERENCES "league_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_picks" ADD CONSTRAINT "roster_picks_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "contest_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_picks" ADD CONSTRAINT "roster_picks_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_picks" ADD CONSTRAINT "contest_picks_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "contest_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_picks" ADD CONSTRAINT "contest_picks_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_picks" ADD CONSTRAINT "contest_picks_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket_predictions" ADD CONSTRAINT "bracket_predictions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "contest_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket_predictions" ADD CONSTRAINT "bracket_predictions_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_sessions" ADD CONSTRAINT "draft_sessions_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_draft_session_id_fkey" FOREIGN KEY ("draft_session_id") REFERENCES "draft_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "contest_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_standings" ADD CONSTRAINT "contest_standings_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_results" ADD CONSTRAINT "contest_results_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_locale_preferences" ADD CONSTRAINT "user_locale_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_flag_id_fkey" FOREIGN KEY ("flag_id") REFERENCES "feature_flags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_announcements" ADD CONSTRAINT "global_announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
