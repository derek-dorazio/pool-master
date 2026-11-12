-- #1537: the provider name match reads a sync's unmapped participants by sport and name; without
-- this it reads every participant of the sport through participants_sport_id_status_idx.
CREATE INDEX "participants_sport_id_name_idx" ON "participants"("sport_id", "name");
