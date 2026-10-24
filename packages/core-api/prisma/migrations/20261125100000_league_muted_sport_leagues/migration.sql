-- #851: the sport leagues a league's commissioners are not emailed about. Every league starts with none.
ALTER TABLE "leagues" ADD COLUMN "muted_sport_league_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
