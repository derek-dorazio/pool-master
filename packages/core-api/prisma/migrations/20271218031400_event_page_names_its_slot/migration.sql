-- An event page names the slot definition it shows, and each offer carries only its page and its
-- setup (#2050, plan §7): the setup holds the coverage. Each page takes the definition and sport
-- league of its primary offer (else its first), and an offer on another definition, or whose
-- setup is another sport league's, is dropped: the page cannot show it. A page with no offer has
-- no definition to take, and none exists.
ALTER TABLE "event_pages" ADD COLUMN "sport_league_id" UUID, ADD COLUMN "sport_league_competition_slot_id" UUID;
UPDATE "event_pages" p SET "sport_league_id" = o."sport_league_id", "sport_league_competition_slot_id" = o."sport_league_competition_slot_id"
FROM (
  SELECT DISTINCT ON ("event_page_id") "event_page_id", "sport_league_id", "sport_league_competition_slot_id"
  FROM "event_page_offers"
  ORDER BY "event_page_id", "is_primary" DESC, "sort_order"
) o
WHERE o."event_page_id" = p."id";
DELETE FROM "event_page_offers" o
USING "event_pages" p, "contest_config_templates" t
WHERE p."id" = o."event_page_id" AND t."id" = o."template_id"
  AND (o."sport_league_competition_slot_id" <> p."sport_league_competition_slot_id" OR t."sport_league_id" <> p."sport_league_id");
ALTER TABLE "event_pages" ALTER COLUMN "sport_league_id" SET NOT NULL, ALTER COLUMN "sport_league_competition_slot_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "event_pages" ADD CONSTRAINT "event_pages_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_pages" ADD CONSTRAINT "event_pages_definition_fkey" FOREIGN KEY ("sport_league_id", "sport_league_competition_slot_id") REFERENCES "sport_league_competition_slots"("sport_league_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "event_pages_sport_league_id_sport_league_competition_slot_i_idx" ON "event_pages"("sport_league_id", "sport_league_competition_slot_id");

-- The offer's own pointers go.
ALTER TABLE "event_page_offers" DROP CONSTRAINT "event_page_offers_definition_fkey";
ALTER TABLE "event_page_offers" DROP CONSTRAINT "event_page_offers_sport_league_id_fkey";
DROP INDEX "event_page_offers_sport_league_id_sport_league_competition__idx";
ALTER TABLE "event_page_offers" DROP COLUMN "sport_league_competition_slot_id", DROP COLUMN "sport_league_id";
