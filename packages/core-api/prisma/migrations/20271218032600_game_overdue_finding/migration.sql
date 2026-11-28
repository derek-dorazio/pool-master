-- A Game whose result is overdue (#2013): the sync tick raises it in place of the event's overdue chip.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'GAME_OVERDUE';

-- The sync tick reads Games in play and Games that may be overdue by status and start every minute.
CREATE INDEX "sport_event_round_match_games_status_scheduled_date_idx" ON "sport_event_round_match_games"("status", "scheduled_date");
