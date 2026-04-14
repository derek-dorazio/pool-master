ALTER TABLE "users"
  ADD COLUMN "first_name" VARCHAR(100),
  ADD COLUMN "last_name" VARCHAR(100);

UPDATE "users"
SET
  "first_name" = COALESCE(NULLIF(split_part(trim("display_name"), ' ', 1), ''), 'Root'),
  "last_name" = COALESCE(
    NULLIF(
      CASE
        WHEN strpos(trim("display_name"), ' ') > 0
          THEN btrim(substr(trim("display_name"), strpos(trim("display_name"), ' ') + 1))
        ELSE ''
      END,
      ''
    ),
    'User'
  );

ALTER TABLE "users"
  ALTER COLUMN "first_name" SET NOT NULL,
  ALTER COLUMN "last_name" SET NOT NULL;

ALTER TABLE "users"
  DROP COLUMN "display_name";
