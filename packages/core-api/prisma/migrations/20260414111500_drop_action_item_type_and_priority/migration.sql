DROP INDEX IF EXISTS "commissioner_action_items_league_id_resolved_priority_idx";

ALTER TABLE "commissioner_action_items"
  DROP COLUMN "type",
  DROP COLUMN "priority";

CREATE INDEX "commissioner_action_items_league_id_resolved_created_at_idx"
  ON "commissioner_action_items"("league_id", "resolved", "created_at" DESC);
