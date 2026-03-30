-- AlterTable
ALTER TABLE "contests" ADD COLUMN     "end_date" TIMESTAMPTZ,
ADD COLUMN     "imported_by" UUID,
ADD COLUMN     "is_imported" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sport" VARCHAR(50),
ADD COLUMN     "start_date" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "trophies" ADD COLUMN     "awarded_by" UUID,
ADD COLUMN     "season_label" VARCHAR(100);

-- CreateTable
CREATE TABLE "season_notes" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "season" VARCHAR(100) NOT NULL,
    "content" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "season_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_configs" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "contest_result_retention" INTEGER NOT NULL DEFAULT -1,
    "roster_history_retention" INTEGER NOT NULL DEFAULT -1,
    "activity_log_retention" INTEGER NOT NULL DEFAULT 365,
    "payout_record_retention" INTEGER NOT NULL DEFAULT -1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "retention_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_usage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "resource" VARCHAR(50) NOT NULL,
    "current_count" INTEGER NOT NULL DEFAULT 0,
    "counted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_overrides" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entitlement_key" VARCHAR(100) NOT NULL,
    "override_value" JSONB NOT NULL,
    "reason" VARCHAR(500),
    "set_by" UUID,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlement_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stripe_customer_id" VARCHAR(255) NOT NULL,
    "stripe_subscription_id" VARCHAR(255),
    "plan_tier_slug" VARCHAR(50) NOT NULL,
    "billing_cycle" VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
    "status" VARCHAR(50) NOT NULL DEFAULT 'TRIALING',
    "trial_start" TIMESTAMPTZ,
    "trial_end" TIMESTAMPTZ,
    "current_period_start" TIMESTAMPTZ,
    "current_period_end" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "pending_plan_change_slug" VARCHAR(50),
    "payment_method_last4" VARCHAR(4),
    "payment_method_brand" VARCHAR(50),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'usd',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "season_notes_league_id_season_idx" ON "season_notes"("league_id", "season");

-- CreateIndex
CREATE UNIQUE INDEX "retention_configs_league_id_key" ON "retention_configs"("league_id");

-- CreateIndex
CREATE INDEX "tenant_usage_tenant_id_idx" ON "tenant_usage"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_usage_tenant_id_resource_key" ON "tenant_usage"("tenant_id", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "entitlement_overrides_tenant_id_entitlement_key_key" ON "entitlement_overrides"("tenant_id", "entitlement_key");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_subscriptions_tenant_id_key" ON "tenant_subscriptions"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_status_idx" ON "tenant_subscriptions"("status");

-- AddForeignKey
ALTER TABLE "tenant_usage" ADD CONSTRAINT "tenant_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
