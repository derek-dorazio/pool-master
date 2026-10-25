-- #1007: event pages (`plans/event-landing-pages.md`), public pages for one event a fan would
-- name, each a curated list of offers: a contest setup on one sport league's series.
CREATE TABLE "event_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport" "PrismaSport" NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "redirect_to_page_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "event_pages_pkey" PRIMARY KEY ("id"),
    -- The shared `isEventPageSlug` pattern: lower case letters and digits, words joined by single dashes.
    CONSTRAINT "event_pages_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    -- A page never redirects to itself.
    CONSTRAINT "event_pages_redirect_check" CHECK ("redirect_to_page_id" IS NULL OR "redirect_to_page_id" <> "id")
);

CREATE TABLE "event_page_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_page_id" UUID NOT NULL,
    "sport_league_id" UUID NOT NULL,
    "event_series_name" VARCHAR(255) NOT NULL,
    "template_id" UUID NOT NULL,
    "bracket_start_round" INTEGER,
    "sort_order" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "event_page_offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_page_offers_bracket_start_round_check" CHECK ("bracket_start_round" IS NULL OR "bracket_start_round" >= 1)
);

CREATE UNIQUE INDEX "event_pages_sport_slug_key" ON "event_pages"("sport", "slug");
CREATE UNIQUE INDEX "event_page_offers_event_page_id_sort_order_key" ON "event_page_offers"("event_page_id", "sort_order");
CREATE INDEX "event_page_offers_sport_league_id_idx" ON "event_page_offers"("sport_league_id");
CREATE INDEX "event_page_offers_template_id_idx" ON "event_page_offers"("template_id");

ALTER TABLE "event_pages" ADD CONSTRAINT "event_pages_redirect_to_page_id_fkey" FOREIGN KEY ("redirect_to_page_id") REFERENCES "event_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_page_offers" ADD CONSTRAINT "event_page_offers_event_page_id_fkey" FOREIGN KEY ("event_page_id") REFERENCES "event_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_page_offers" ADD CONSTRAINT "event_page_offers_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_page_offers" ADD CONSTRAINT "event_page_offers_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "contest_config_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The first page, Championship Weekend, alone to start (#1007): the whole path is tried on QA
-- before the calendar's other pages follow, each a small seed of its own. Its offers, in order:
-- the Clutch Card on the Championship Weekend sport league's one event a season (primary: its
-- dates head the page), the NFL playoff bracket from the conference round (round 3), and NFL
-- Squares on one of the playoffs' games. Each template is found by its key in its own sport
-- league; a database without one (or without the league) seeds no offer for it.
INSERT INTO "event_pages" ("id", "sport", "slug", "display_order", "is_active", "updated_at")
VALUES (gen_random_uuid(), 'AMERICAN_FOOTBALL', 'championship-weekend', 20, TRUE, NOW());

INSERT INTO "event_page_offers" (
    "id", "event_page_id", "sport_league_id", "event_series_name", "template_id", "bracket_start_round",
    "sort_order", "is_primary", "updated_at"
)
SELECT gen_random_uuid(), p."id", l."id", offer."series", t."id", offer."start_round", offer."sort_order", offer."is_primary", NOW()
FROM (VALUES
    ('Championship Weekend', 'Conference Championships', 'championship-weekend-tiered-redzone', NULL::INTEGER, 1, TRUE),
    ('NFL', 'NFL Playoffs', 'nfl-bracket-second-chance-doubling', 3, 2, FALSE),
    ('NFL', 'NFL Playoffs', 'nfl-squares', NULL::INTEGER, 3, FALSE)
) AS offer("league", "series", "template_key", "start_round", "sort_order", "is_primary")
JOIN "event_pages" p ON p."sport" = 'AMERICAN_FOOTBALL' AND p."slug" = 'championship-weekend'
JOIN "sports" s ON s."sport" = 'AMERICAN_FOOTBALL'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = offer."league"
JOIN "contest_config_templates" t ON t."template_key" = offer."template_key" AND t."sport_league_id" = l."id";
