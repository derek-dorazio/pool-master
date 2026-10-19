-- #715: KNOCKOUT_BRACKET becomes MATCHES (design Q5.2a). The format says only that an event's
-- results are games between two sides; whether those games form a bracket is read from their
-- links (advances_to_match_id), so an NFL regular-season week of unlinked games and a playoff
-- bracket share it. Renaming the value keeps every sports row that carries it.
ALTER TYPE "PrismaTournamentFormat" RENAME VALUE 'KNOCKOUT_BRACKET' TO 'MATCHES';
