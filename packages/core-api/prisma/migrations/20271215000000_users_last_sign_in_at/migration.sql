-- #1882: the root admin's Customers › Users grid shows when each user last signed in. Nothing
-- stored it: refresh tokens rotate on every refresh and are purged after they expire. Null until
-- the user's next sign-in after this deploy.
ALTER TABLE "users" ADD COLUMN "last_sign_in_at" TIMESTAMPTZ;
