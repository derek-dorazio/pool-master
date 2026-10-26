-- #1041: the date order follows the member's locale; the unused date format setting goes.
ALTER TABLE "users" DROP COLUMN "date_format";

DROP TYPE "UserDateFormat";
