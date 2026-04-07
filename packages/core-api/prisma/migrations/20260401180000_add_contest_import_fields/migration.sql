-- Migration: add_contest_import_fields
-- Adds columns and tables that were added to the Prisma schema after the initial migration.

-- 1. Missing columns on contests table
ALTER TABLE "contests" ADD COLUMN IF NOT EXISTS "sport" VARCHAR(50);
ALTER TABLE "contests" ADD COLUMN IF NOT EXISTS "is_imported" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contests" ADD COLUMN IF NOT EXISTS "imported_by" UUID;
ALTER TABLE "contests" ADD COLUMN IF NOT EXISTS "start_date" TIMESTAMPTZ;
ALTER TABLE "contests" ADD COLUMN IF NOT EXISTS "end_date" TIMESTAMPTZ;

-- 2. Missing tables

CREATE TABLE IF NOT EXISTS "season_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "season" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "season_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tenant_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL UNIQUE,
    "stripe_customer_id" VARCHAR(255),
    "stripe_subscription_id" VARCHAR(255),
    "plan_tier_slug" VARCHAR(50) NOT NULL DEFAULT 'free',
    "billing_cycle" VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
    "status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    "trial_start" TIMESTAMPTZ,
    "trial_end" TIMESTAMPTZ,
    "current_period_start" TIMESTAMPTZ,
    "current_period_end" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "payment_method_last4" VARCHAR(4),
    "payment_method_brand" VARCHAR(50),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'usd',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tenant_usage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "resource" VARCHAR(50) NOT NULL,
    "current_count" INTEGER NOT NULL DEFAULT 0,
    "counted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_usage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_usage_tenant_id_resource_key" UNIQUE ("tenant_id", "resource")
);

CREATE TABLE IF NOT EXISTS "entitlement_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "entitlement_key" VARCHAR(100) NOT NULL,
    "override_value" JSONB NOT NULL,
    "reason" VARCHAR(500),
    "set_by" UUID,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "entitlement_overrides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "entitlement_overrides_tenant_id_entitlement_key_key" UNIQUE ("tenant_id", "entitlement_key")
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS "season_notes_league_id_idx" ON "season_notes"("league_id");
CREATE INDEX IF NOT EXISTS "tenant_subscriptions_status_idx" ON "tenant_subscriptions"("status");
CREATE INDEX IF NOT EXISTS "tenant_usage_tenant_id_idx" ON "tenant_usage"("tenant_id");
