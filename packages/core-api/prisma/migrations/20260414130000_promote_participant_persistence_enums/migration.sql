CREATE TYPE "PrismaParticipantType" AS ENUM ('INDIVIDUAL', 'TEAM');
CREATE TYPE "PrismaParticipantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'RETIRED', 'SUSPENDED');
CREATE TYPE "PrismaParticipantFormTrend" AS ENUM ('RISING', 'STABLE', 'FALLING');
CREATE TYPE "PrismaParticipantMappingConfidence" AS ENUM ('EXACT', 'HIGH', 'MANUAL');
CREATE TYPE "PrismaSport" AS ENUM (
  'GOLF',
  'NFL',
  'NBA',
  'F1',
  'NASCAR',
  'NCAA_BASKETBALL',
  'NCAA_HOCKEY',
  'NCAA_FOOTBALL',
  'TENNIS',
  'HORSE_RACING',
  'SOCCER',
  'NHL',
  'MLB',
  'UFC'
);

ALTER TABLE "sports"
  ALTER COLUMN "participant_type" TYPE "PrismaParticipantType"
  USING "participant_type"::"PrismaParticipantType";

ALTER TABLE "participants"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "participant_type" TYPE "PrismaParticipantType"
  USING "participant_type"::"PrismaParticipantType",
  ALTER COLUMN "status" TYPE "PrismaParticipantStatus"
  USING "status"::"PrismaParticipantStatus";

ALTER TABLE "participants"
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "participant_season_records"
  ALTER COLUMN "form_trend" DROP DEFAULT,
  ALTER COLUMN "sport" TYPE "PrismaSport"
  USING "sport"::"PrismaSport",
  ALTER COLUMN "form_trend" TYPE "PrismaParticipantFormTrend"
  USING "form_trend"::"PrismaParticipantFormTrend";

ALTER TABLE "participant_season_records"
  ALTER COLUMN "form_trend" SET DEFAULT 'STABLE';

ALTER TABLE "participant_provider_mappings"
  ALTER COLUMN "confidence" DROP DEFAULT,
  ALTER COLUMN "confidence" TYPE "PrismaParticipantMappingConfidence"
  USING "confidence"::"PrismaParticipantMappingConfidence";

ALTER TABLE "participant_provider_mappings"
  ALTER COLUMN "confidence" SET DEFAULT 'EXACT';
