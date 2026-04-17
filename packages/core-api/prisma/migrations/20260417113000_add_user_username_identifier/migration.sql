ALTER TABLE "users"
ADD COLUMN "username" VARCHAR(100);

UPDATE "users"
SET "username" = LOWER("email")
WHERE "username" IS NULL;

ALTER TABLE "users"
ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
