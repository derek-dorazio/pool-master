-- Plan 63: remove tenant/admin identity remnants and unify root-admin on users

BEGIN;

-- Drop legacy foreign keys before removing tenant/admin tables and columns.
ALTER TABLE IF EXISTS "admin_audit_log" DROP CONSTRAINT IF EXISTS "admin_audit_log_admin_user_id_fkey";
ALTER TABLE IF EXISTS "migration_runs" DROP CONSTRAINT IF EXISTS "migration_runs_started_by_fkey";
ALTER TABLE IF EXISTS "impersonation_sessions" DROP CONSTRAINT IF EXISTS "impersonation_sessions_admin_user_id_fkey";
ALTER TABLE IF EXISTS "impersonation_sessions" DROP CONSTRAINT IF EXISTS "impersonation_sessions_tenant_id_fkey";
ALTER TABLE IF EXISTS "leagues" DROP CONSTRAINT IF EXISTS "leagues_tenant_id_fkey";
ALTER TABLE IF EXISTS "seasons" DROP CONSTRAINT IF EXISTS "seasons_tenant_id_fkey";
ALTER TABLE IF EXISTS "users" DROP CONSTRAINT IF EXISTS "users_tenant_id_fkey";
ALTER TABLE IF EXISTS "tenant_subscriptions" DROP CONSTRAINT IF EXISTS "tenant_subscriptions_tenant_id_fkey";
ALTER TABLE IF EXISTS "tenant_usage" DROP CONSTRAINT IF EXISTS "tenant_usage_tenant_id_fkey";
ALTER TABLE IF EXISTS "entitlement_overrides" DROP CONSTRAINT IF EXISTS "entitlement_overrides_tenant_id_fkey";
ALTER TABLE IF EXISTS "feature_flag_overrides" DROP CONSTRAINT IF EXISTS "feature_flag_overrides_created_by_fkey";
ALTER TABLE IF EXISTS "feature_flag_overrides" DROP CONSTRAINT IF EXISTS "feature_flag_overrides_flag_id_fkey";
ALTER TABLE IF EXISTS "feature_flag_overrides" DROP CONSTRAINT IF EXISTS "feature_flag_overrides_tenant_id_fkey";
ALTER TABLE IF EXISTS "feature_flags" DROP CONSTRAINT IF EXISTS "feature_flags_updated_by_fkey";
ALTER TABLE IF EXISTS "global_announcements" DROP CONSTRAINT IF EXISTS "global_announcements_created_by_fkey";

-- Legacy admin-owned platform data cannot be mapped cleanly onto unified users.
DELETE FROM "migration_runs";
DELETE FROM "admin_audit_log";

ALTER TABLE IF EXISTS "admin_audit_log"
  ADD COLUMN IF NOT EXISTS "actor_id" UUID,
  ADD COLUMN IF NOT EXISTS "actor_email" VARCHAR(255);

ALTER TABLE IF EXISTS "admin_audit_log"
  DROP COLUMN IF EXISTS "admin_user_id",
  DROP COLUMN IF EXISTS "admin_user_email";

ALTER TABLE IF EXISTS "admin_audit_log"
  ALTER COLUMN "actor_id" SET NOT NULL,
  ALTER COLUMN "actor_email" SET NOT NULL;

DROP INDEX IF EXISTS "admin_audit_log_admin_user_id_created_at_idx";
CREATE INDEX IF NOT EXISTS "admin_audit_log_actor_id_created_at_idx"
  ON "admin_audit_log"("actor_id", "created_at" DESC);

ALTER TABLE IF EXISTS "migration_runs"
  ADD CONSTRAINT "migration_runs_started_by_fkey"
  FOREIGN KEY ("started_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "users"
  ADD COLUMN IF NOT EXISTS "is_root_admin" BOOLEAN NOT NULL DEFAULT false,
  DROP COLUMN IF EXISTS "tenant_id";

ALTER TABLE IF EXISTS "leagues"
  DROP COLUMN IF EXISTS "tenant_id";

ALTER TABLE IF EXISTS "seasons"
  DROP COLUMN IF EXISTS "tenant_id";

DROP TABLE IF EXISTS "impersonation_sessions";
DROP TABLE IF EXISTS "admin_users";
DROP TABLE IF EXISTS "tenant_subscriptions";
DROP TABLE IF EXISTS "tenant_usage";
DROP TABLE IF EXISTS "entitlement_overrides";
DROP TABLE IF EXISTS "feature_flag_overrides";
DROP TABLE IF EXISTS "feature_flags";
DROP TABLE IF EXISTS "global_announcements";
DROP TABLE IF EXISTS "tenants";

COMMIT;
