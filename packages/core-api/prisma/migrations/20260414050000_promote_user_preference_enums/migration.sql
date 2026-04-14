UPDATE "users"
SET "auth_provider" = 'email'
WHERE "auth_provider" = 'local';

CREATE TYPE "UserAuthProvider" AS ENUM ('email', 'google', 'apple');
CREATE TYPE "UserTimeFormat" AS ENUM ('12H', '24H');
CREATE TYPE "UserDateFormat" AS ENUM ('MDY', 'DMY', 'YMD');

ALTER TABLE "users"
ALTER COLUMN "time_format" DROP DEFAULT,
ALTER COLUMN "date_format" DROP DEFAULT;

ALTER TABLE "users"
ALTER COLUMN "auth_provider" TYPE "UserAuthProvider"
USING (
  CASE
    WHEN "auth_provider" IS NULL THEN NULL
    ELSE "auth_provider"::"UserAuthProvider"
  END
);

ALTER TABLE "users"
ALTER COLUMN "time_format" SET DEFAULT '12H'::"UserTimeFormat",
ALTER COLUMN "date_format" SET DEFAULT 'MDY'::"UserDateFormat";

ALTER TABLE "users"
ALTER COLUMN "time_format" TYPE "UserTimeFormat"
USING (
  CASE
    WHEN "time_format" IS NULL THEN NULL
    ELSE "time_format"::"UserTimeFormat"
  END
);

ALTER TABLE "users"
ALTER COLUMN "date_format" TYPE "UserDateFormat"
USING (
  CASE
    WHEN "date_format" IS NULL THEN NULL
    ELSE "date_format"::"UserDateFormat"
  END
);
