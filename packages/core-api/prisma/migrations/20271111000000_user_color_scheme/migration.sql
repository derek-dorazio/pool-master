-- The member's Appearance choice: match the device, light or dark (#1471). Null means no choice yet.
CREATE TYPE "UserColorScheme" AS ENUM ('DEVICE', 'LIGHT', 'DARK');

ALTER TABLE "users" ADD COLUMN "color_scheme" "UserColorScheme";
