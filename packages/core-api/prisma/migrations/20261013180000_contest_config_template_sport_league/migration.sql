-- #624: an optional sport league on a contest template.
--
-- A sport like auto racing has several leagues (NASCAR, IndyCar, F1), each with its own official
-- points preset. A template with a sport league is offered only for that league's events; a null
-- sport league (every existing row) keeps the template sport-wide, offered for every league of its
-- sport. ON DELETE RESTRICT: a league with templates is retired (is_active), never deleted.

ALTER TABLE "contest_config_templates" ADD COLUMN "sport_league_id" UUID;

CREATE INDEX "contest_config_templates_sport_league_id_idx" ON "contest_config_templates"("sport_league_id");

ALTER TABLE "contest_config_templates" ADD CONSTRAINT "contest_config_templates_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
