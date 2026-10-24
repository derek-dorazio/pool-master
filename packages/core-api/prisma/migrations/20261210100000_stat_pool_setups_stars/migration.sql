-- #995: the championship stat pools' setups call their players stars, as the Clutch Card's copy
-- does: "Tiered: 1 star per tier, best 4 count", and "Pick one star from each of the six tiers".
-- Every setup on a composite (stat pool) league whose name or description says player changes,
-- which today is the fifteen #935 seeded; replace() leaves one that no longer says player alone.
UPDATE "contest_config_templates" t
SET "name" = replace(t."name", 'player', 'star'),
    "description" = replace(t."description", 'player', 'star'),
    "updated_at" = NOW()
FROM "sport_leagues" l
WHERE l."id" = t."sport_league_id"
  AND l."scoring_family" = 'COMPOSITE'
  AND (t."name" LIKE '%player%' OR t."description" LIKE '%player%');
