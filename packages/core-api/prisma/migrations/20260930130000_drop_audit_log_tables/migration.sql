-- plans/145 slice 4, #255. Deletes the audit-log feature: nothing read admin_audit_log (no client,
-- no screen) and nothing wrote commissioner_audit_log. Sync-run history is provider_sync_runs,
-- which this migration does not touch. One-way: the dropped rows are not recoverable.

-- DropForeignKey
ALTER TABLE "admin_audit_log" DROP CONSTRAINT "admin_audit_log_actor_id_fkey";

-- DropForeignKey
ALTER TABLE "commissioner_audit_log" DROP CONSTRAINT "commissioner_audit_log_actor_id_fkey";

-- DropForeignKey
ALTER TABLE "commissioner_audit_log" DROP CONSTRAINT "commissioner_audit_log_league_id_fkey";

-- DropTable
DROP TABLE "admin_audit_log";

-- DropTable
DROP TABLE "commissioner_audit_log";

-- The "system" user seeded by 20260902150000 existed only so a scheduler-driven audit entry had a
-- row for its required actor FK. With the table gone it has no purpose, and it was listed to root
-- admins as an ordinary active account. Its id was deliberately not the all-zero nil UUID, because
-- "not found" contract tests use that value as a known-nonexistent id — any future sentinel row
-- must keep off it for the same reason.
DELETE FROM "users" WHERE "id" = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
