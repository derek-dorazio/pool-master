-- Bracket rules name the round the bracket starts at (#721): 1 for a full bracket, a later round
-- for a second-chance bracket. Every bracket stored before it is a full bracket.
UPDATE "contest_configurations"
SET "config_json" = "config_json" || '{"startsAtRound": 1}'::jsonb
WHERE "selection_type" = 'BRACKET'
  AND "config_json" IS NOT NULL
  AND NOT ("config_json" ? 'startsAtRound');
