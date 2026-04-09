ALTER TABLE "consent_records"
ADD COLUMN IF NOT EXISTS "minimum_age_threshold" INTEGER,
ADD COLUMN IF NOT EXISTS "age_affirmed" BOOLEAN;
