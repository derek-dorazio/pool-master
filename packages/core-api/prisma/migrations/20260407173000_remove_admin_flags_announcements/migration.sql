-- Remove out-of-scope admin flag and global announcement tables.
-- These surfaces are no longer part of the first-pass site-admin model.

DROP TABLE IF EXISTS "feature_flag_overrides";
DROP TABLE IF EXISTS "global_announcements";
DROP TABLE IF EXISTS "feature_flags";
