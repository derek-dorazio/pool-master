-- #995: the championship stat pools' setups call their players stars, as the Clutch Card's copy
-- does: "Tiered: 1 star per tier, best 4 count", and "Pick one star from each of the six tiers".
-- Only the setups #935 seeded on the composite leagues change; replace() leaves a name an admin
-- has already reworded alone where it no longer says player.
UPDATE "contest_config_templates" t
SET "name" = replace(t."name", 'player', 'star'),
    "description" = replace(t."description", 'player', 'star'),
    "updated_at" = NOW()
FROM "sport_leagues" l
WHERE l."id" = t."sport_league_id"
  AND l."scoring_family" = 'COMPOSITE'
  AND (t."name" LIKE '%player%' OR t."description" LIKE '%player%');
