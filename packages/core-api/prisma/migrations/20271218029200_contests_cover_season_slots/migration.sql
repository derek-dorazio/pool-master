-- League model slice 15 (#2014): a contest covers Season slots. ContestSeasonSlot replaces
-- ContestSportEvent, a contest and a cup are in a sport league Season instead of a year, every
-- contest has a template, and a draw's pending receipts point at a covered slot.

-- 1. Every contest has a template. A configuration made with none takes its sport league's
--    template for its selection type (the default first). Its rules stay its own: they live on
--    the configuration, not the template.
UPDATE "contest_configurations" cc
SET "template_id" = (
  SELECT t."id"
  FROM "contest_config_templates" t
  JOIN "contest_sport_events" cse ON cse."contest_id" = cc."contest_id" AND cse."sequence" = 1
  JOIN "sport_events" e ON e."id" = cse."sport_event_id"
  WHERE t."sport_league_id" = e."sport_league_id" AND t."selection_type" = c."selection_type"
  ORDER BY t."is_default" DESC, t."active" DESC, t."sort_order", t."id"
  LIMIT 1
)
FROM "contests" c
WHERE c."id" = cc."contest_id" AND cc."template_id" IS NULL;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM "contest_configurations" WHERE "template_id" IS NULL) THEN RAISE EXCEPTION 'contest_configurations without a template remain: no template of their sport league fits their selection type'; END IF; END $$;

-- 2. A contest's Season: its events' (one Season since #2014 part A), or for a contest with no
--    event its template's sport league Season of the contest's year.
ALTER TABLE "contests" ADD COLUMN "sport_league_season_id" UUID;

UPDATE "contests" c SET "sport_league_season_id" = e."sport_league_season_id"
FROM "contest_sport_events" cse
JOIN "sport_events" e ON e."id" = cse."sport_event_id"
WHERE cse."contest_id" = c."id" AND cse."sequence" = (
  SELECT min(first."sequence") FROM "contest_sport_events" first WHERE first."contest_id" = c."id"
);

UPDATE "contests" c SET "sport_league_season_id" = s."id"
FROM "contest_configurations" cc
JOIN "contest_config_templates" t ON t."id" = cc."template_id"
JOIN "sport_league_seasons" s ON s."sport_league_id" = t."sport_league_id"
WHERE cc."contest_id" = c."id" AND c."sport_league_season_id" IS NULL AND s."championship_year" = c."season_year";

DO $$ BEGIN IF EXISTS (SELECT 1 FROM "contests" WHERE "sport_league_season_id" IS NULL) THEN RAISE EXCEPTION 'contests without a Season remain: no event, and no Season of their template''s sport league for their year'; END IF; END $$;

ALTER TABLE "contests" ALTER COLUMN "sport_league_season_id" SET NOT NULL;

-- 3. The covered Season slots: each linked event's slots that the template lists. A linked event
--    the template lists none of keeps all its slots, as a contest made with no template covered
--    every round of its events.
CREATE TABLE "contest_season_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "sport_league_season_id" UUID NOT NULL,
    "sport_league_season_competition_slot_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_season_slots_pkey" PRIMARY KEY ("id")
);

INSERT INTO "contest_season_slots" ("contest_id", "sport_league_season_id", "sport_league_season_competition_slot_id", "created_at")
SELECT DISTINCT cse."contest_id", es."sport_league_season_id", es."sport_league_season_competition_slot_id", cse."created_at"
FROM "contest_sport_events" cse
JOIN "contests" c ON c."id" = cse."contest_id"
JOIN "contest_configurations" cc ON cc."contest_id" = c."id"
JOIN "sport_event_slots" es ON es."sport_event_id" = cse."sport_event_id" AND es."sport_league_season_id" = c."sport_league_season_id"
JOIN "sport_league_season_competition_slots" ss ON ss."id" = es."sport_league_season_competition_slot_id"
WHERE EXISTS (
  SELECT 1 FROM "contest_config_template_slots" ts
  WHERE ts."template_id" = cc."template_id" AND ts."sport_league_competition_slot_id" = ss."sport_league_competition_slot_id"
) OR NOT EXISTS (
  SELECT 1
  FROM "sport_event_slots" other
  JOIN "sport_league_season_competition_slots" oss ON oss."id" = other."sport_league_season_competition_slot_id"
  JOIN "contest_config_template_slots" ts ON ts."template_id" = cc."template_id" AND ts."sport_league_competition_slot_id" = oss."sport_league_competition_slot_id"
  WHERE other."sport_event_id" = cse."sport_event_id"
);

-- 4. A draw's pending receipts point at the first covered slot of the pending event: the earliest
--    to start, a slot with no dates yet last, and its id only between slots starting together.
ALTER TABLE "contest_draws" ADD COLUMN "receipts_pending_contest_season_slot_id" UUID;

UPDATE "contest_draws" d SET "receipts_pending_contest_season_slot_id" = (
  SELECT css."id"
  FROM "contest_season_slots" css
  JOIN "sport_event_slots" es ON es."sport_league_season_id" = css."sport_league_season_id"
    AND es."sport_league_season_competition_slot_id" = css."sport_league_season_competition_slot_id"
  JOIN "sport_league_season_competition_slots" ss ON ss."id" = css."sport_league_season_competition_slot_id"
  WHERE css."contest_id" = d."contest_id" AND es."sport_event_id" = d."receipts_pending_sport_event_id"
  ORDER BY ss."starts_at" ASC NULLS LAST, css."id"
  LIMIT 1
)
WHERE d."receipts_pending_sport_event_id" IS NOT NULL;

ALTER TABLE "contest_draws" DROP CONSTRAINT "contest_draws_receipts_pending_sport_event_id_fkey";
DROP INDEX "contest_draws_receipts_pending_sport_event_id_idx";
ALTER TABLE "contest_draws" DROP COLUMN "receipts_pending_sport_event_id";

-- 5. A cup's Season: its sport league's Season of the cup's year.
ALTER TABLE "cups" ADD COLUMN "sport_league_season_id" UUID;

UPDATE "cups" cu SET "sport_league_season_id" = s."id"
FROM "sport_league_seasons" s
WHERE s."sport_league_id" = cu."sport_league_id" AND s."championship_year" = cu."season_year";

DO $$ BEGIN IF EXISTS (SELECT 1 FROM "cups" WHERE "sport_league_season_id" IS NULL) THEN RAISE EXCEPTION 'cups without a Season remain: no Season of their sport league for their year'; END IF; END $$;

ALTER TABLE "cups" ALTER COLUMN "sport_league_season_id" SET NOT NULL;
DROP INDEX "cups_league_id_season_year_sport_league_id_key";
ALTER TABLE "cups" DROP COLUMN "season_year";

-- 6. The year column and the event links go.
DROP INDEX "contests_league_id_season_year_idx";
ALTER TABLE "contests" DROP COLUMN "season_year";
DROP TABLE "contest_sport_events";

-- 7. Keys, indexes and the required template.
ALTER TABLE "contest_configurations" DROP CONSTRAINT "contest_configurations_template_id_fkey";
ALTER TABLE "contest_configurations" ALTER COLUMN "template_id" SET NOT NULL;
ALTER TABLE "contest_configurations" ADD CONSTRAINT "contest_configurations_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "contest_config_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "contest_season_slots_sport_league_season_id_sport_league_se_idx" ON "contest_season_slots"("sport_league_season_id", "sport_league_season_competition_slot_id");
CREATE UNIQUE INDEX "contest_season_slots_contest_id_sport_league_season_competi_key" ON "contest_season_slots"("contest_id", "sport_league_season_competition_slot_id");
CREATE INDEX "contest_draws_receipts_pending_contest_season_slot_id_idx" ON "contest_draws"("receipts_pending_contest_season_slot_id");
CREATE INDEX "contests_league_id_sport_league_season_id_idx" ON "contests"("league_id", "sport_league_season_id");
CREATE INDEX "contests_sport_league_season_id_idx" ON "contests"("sport_league_season_id");
CREATE UNIQUE INDEX "contests_id_sport_league_season_id_key" ON "contests"("id", "sport_league_season_id");
CREATE UNIQUE INDEX "cups_league_id_sport_league_season_id_key" ON "cups"("league_id", "sport_league_season_id");

ALTER TABLE "contests" ADD CONSTRAINT "contests_sport_league_season_id_fkey" FOREIGN KEY ("sport_league_season_id") REFERENCES "sport_league_seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cups" ADD CONSTRAINT "cups_season_fkey" FOREIGN KEY ("sport_league_id", "sport_league_season_id") REFERENCES "sport_league_seasons"("sport_league_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contest_season_slots" ADD CONSTRAINT "contest_season_slots_contest_fkey" FOREIGN KEY ("contest_id", "sport_league_season_id") REFERENCES "contests"("id", "sport_league_season_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contest_season_slots" ADD CONSTRAINT "contest_season_slots_season_slot_fkey" FOREIGN KEY ("sport_league_season_id", "sport_league_season_competition_slot_id") REFERENCES "sport_league_season_competition_slots"("sport_league_season_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contest_draws" ADD CONSTRAINT "contest_draws_receipts_pending_contest_season_slot_id_fkey" FOREIGN KEY ("receipts_pending_contest_season_slot_id") REFERENCES "contest_season_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
