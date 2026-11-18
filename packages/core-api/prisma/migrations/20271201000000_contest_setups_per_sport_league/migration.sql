-- Every contest setup belongs to one sport league (#1825). Ten setups were sport-wide (no sport
-- league: seven golf, three horse racing) and were offered on every league of their sport. Each
-- becomes its sport's first top-level league's own setup, keeping its id, and every other league
-- of the sport, a playoff round under a season league too, gets its own copy, as each was offered
-- the sport-wide rows before. Inactive leagues get copies too (horse racing is off, #1812), so
-- they come back with their setups intact.

-- The league that keeps each sport's original rows: the first by display order, then name.
CREATE TEMP TABLE sport_wide_template_keeper AS
SELECT DISTINCT ON (s.sport) s.sport, l.id AS sport_league_id
FROM sports s
JOIN sport_leagues l ON l.sport_id = s.id AND l.parent_sport_league_id IS NULL
WHERE s.sport IN (SELECT sport FROM contest_config_templates WHERE sport_league_id IS NULL)
ORDER BY s.sport, l.display_order NULLS LAST, l.name, l.id;

-- A sport-wide setup whose sport has no top-level league has nowhere to go: stop with its name
-- rather than at the NOT NULL below.
DO $$
DECLARE orphan TEXT;
BEGIN
  SELECT string_agg(DISTINCT t.sport::text, ', ') INTO orphan
  FROM contest_config_templates t
  WHERE t.sport_league_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM sport_wide_template_keeper k WHERE k.sport = t.sport);
  IF orphan IS NOT NULL THEN
    RAISE EXCEPTION 'Sport-wide contest setups of % have no sport league to belong to', orphan;
  END IF;
END $$;

-- One copy of each sport-wide template for every other league of its sport.
CREATE TEMP TABLE sport_wide_template_copy AS
SELECT t.id AS original_id, l.id AS sport_league_id, gen_random_uuid() AS copy_id
FROM contest_config_templates t
JOIN sports s ON s.sport = t.sport
JOIN sport_leagues l ON l.sport_id = s.id
JOIN sport_wide_template_keeper k ON k.sport = t.sport
WHERE t.sport_league_id IS NULL
  AND l.id <> k.sport_league_id;

INSERT INTO contest_config_templates (
  id, sport, sport_league_id, event_type, contest_type, selection_type, template_key, name,
  description, sort_order, is_default, active, config_json, schema_version, event_series_names,
  created_at, updated_at
)
SELECT c.copy_id, t.sport, c.sport_league_id, t.event_type, t.contest_type, t.selection_type,
  t.template_key, t.name, t.description, t.sort_order, t.is_default, t.active, t.config_json,
  t.schema_version, t.event_series_names, now(), now()
FROM sport_wide_template_copy c
JOIN contest_config_templates t ON t.id = c.original_id;

-- A contest made from a sport-wide setup now points at its own league's: the league of its
-- first event. A contest with no event yet keeps the original.
UPDATE contest_configurations cc
SET template_id = c.copy_id
FROM sport_wide_template_copy c
WHERE cc.template_id = c.original_id
  AND c.sport_league_id = (
    SELECT es.sport_league_id
    FROM contest_sport_events cse
    JOIN sport_events e ON e.id = cse.sport_event_id
    JOIN event_series es ON es.id = e.event_series_id
    WHERE cse.contest_id = cc.contest_id
    ORDER BY cse.sequence
    LIMIT 1
  );

-- An event page offer names its own sport league already.
UPDATE event_page_offers o
SET template_id = c.copy_id
FROM sport_wide_template_copy c
WHERE o.template_id = c.original_id
  AND o.sport_league_id = c.sport_league_id;

UPDATE contest_config_templates t
SET sport_league_id = k.sport_league_id, updated_at = now()
FROM sport_wide_template_keeper k
WHERE t.sport_league_id IS NULL
  AND t.sport = k.sport;

DROP TABLE sport_wide_template_copy;
DROP TABLE sport_wide_template_keeper;

-- DropIndex
DROP INDEX "contest_config_templates_sport_event_type_contest_type_sele_key";

-- DropIndex
DROP INDEX "contest_config_templates_sport_league_id_idx";

-- AlterTable
ALTER TABLE "contest_config_templates" ALTER COLUMN "sport_league_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "contest_config_templates_sport_league_id_event_type_contest_key" ON "contest_config_templates"("sport_league_id", "event_type", "contest_type", "selection_type", "template_key");
