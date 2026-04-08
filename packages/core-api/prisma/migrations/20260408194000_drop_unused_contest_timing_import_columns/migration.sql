ALTER TABLE "contests"
  DROP COLUMN IF EXISTS "is_imported",
  DROP COLUMN IF EXISTS "imported_by",
  DROP COLUMN IF EXISTS "start_date",
  DROP COLUMN IF EXISTS "end_date";
