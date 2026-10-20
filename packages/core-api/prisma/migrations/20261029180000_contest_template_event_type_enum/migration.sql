-- #802: a contest template's event type becomes a typed value. Only a sport played as matches
-- has more than one kind of event: a KNOCKOUT (the playoffs, a tournament bracket) and a WEEK of
-- a season's games. Null still offers a template for every event of its sport. Every seeded row
-- holds null until the next migration sets it.
CREATE TYPE "PrismaContestTemplateEventType" AS ENUM ('KNOCKOUT', 'WEEK');

ALTER TABLE "contest_config_templates"
  ALTER COLUMN "event_type" TYPE "PrismaContestTemplateEventType"
  USING "event_type"::"PrismaContestTemplateEventType";
