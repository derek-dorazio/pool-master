/**
 * DOMAIN_EVENT_HANDLERS (#1946): the one place that says what follows each kind of change. It is
 * exhaustive over `DomainEventType`, so a new event type without an entry fails typecheck; an
 * entry may be `[]`, which says on purpose that nothing follows. Each handler lives beside its
 * job's builder in the module that owns the job; this map only imports them.
 *
 * The map is pinned by `domain-event-handlers.test.ts`, and the domain event table in
 * docs/BACKGROUND-JOBS.md is generated from it (`npm run docs:domain-events`).
 */

import {
  rebuildChangedResultsLeaderboardsHandler,
  rebuildContestLeaderboardsHandler,
  rebuildDecidedGameLeaderboardsHandler,
  rebuildEventLeaderboardsHandler,
  rebuildMovedContestLeaderboardsHandler,
} from '../contests/leaderboard-rebuild-job-requests';
import { settleDecidedGameContestsHandler } from '../contests/settle-game-job-requests';
import { settleFinishedEventContestsHandler } from '../contests/settle-sport-event-job-requests';
import {
  tellLeagueContestReopenedHandler,
  tellLeagueContestSettledHandler,
  tellLeagueContestStartedHandler,
  tellLeaguesEventCancelledHandler,
  tellLeaguesEventPostponedHandler,
  tellLeaguesEventRescheduledHandler,
} from '../notifications/contest-email-job-requests';
import { activateEventContestsHandler, followPostponedEventContestsHandler } from '../events/event-contests-job-requests';
import { syncGamesThenTierFieldHandler } from '../events/synced-field-follow-up-job';
import { resolveMappedParticipantFindingsHandler } from '../ingestion/findings/mapped-participant-findings-job';
import { refreshDecidedGameSlotTiebreakersHandler, refreshSlotTiebreakersHandler } from '../events/slot-tiebreaker-job';
import { refreshEventStatusHandler, refreshSlotStatusHandler } from '../events/status-refresh-job-requests';
import { DomainEventType } from './domain-event';
import type { DomainEventHandlerMap } from './domain-event-handler';

export const DOMAIN_EVENT_HANDLERS = {
  [DomainEventType.SPORT_EVENT_STATUS_CHANGED]: [
    activateEventContestsHandler,
    followPostponedEventContestsHandler,
    settleFinishedEventContestsHandler,
    tellLeaguesEventPostponedHandler,
    tellLeaguesEventCancelledHandler,
    rebuildEventLeaderboardsHandler,
  ],
  [DomainEventType.SPORT_EVENT_RESCHEDULED]: [tellLeaguesEventRescheduledHandler],
  [DomainEventType.SPORT_EVENT_RESULTS_CHANGED]: [rebuildChangedResultsLeaderboardsHandler],
  [DomainEventType.SPORT_EVENT_GAMES_CHANGED]: [refreshSlotTiebreakersHandler],
  [DomainEventType.GAME_DECIDED]: [settleDecidedGameContestsHandler, rebuildDecidedGameLeaderboardsHandler, refreshDecidedGameSlotTiebreakersHandler],
  [DomainEventType.CONTEST_ENTRY_EVENT_STATUS_CHANGED]: [rebuildContestLeaderboardsHandler],
  // A contest opened by its commissioner (DRAFT to OPEN) has no email handler: its entry reminders
  // start from the `nextReminderAt` the move sets, and its "New contest open" email is told by
  // contest management. Every move rebuilds the contest's boards.
  [DomainEventType.CONTEST_STATUS_CHANGED]: [
    tellLeagueContestStartedHandler,
    tellLeagueContestReopenedHandler,
    tellLeagueContestSettledHandler,
    rebuildMovedContestLeaderboardsHandler,
  ],
  [DomainEventType.SPORT_EVENT_FIELD_SYNCED]: [syncGamesThenTierFieldHandler],
  [DomainEventType.PARTICIPANT_PROVIDER_MAPPED]: [resolveMappedParticipantFindingsHandler],
  // Status bubbles up (#2013): a Match that moved refreshes its event's slots, and a slot that moved its event.
  [DomainEventType.MATCH_STATUS_CHANGED]: [refreshSlotStatusHandler],
  [DomainEventType.SEASON_SLOT_STATUS_CHANGED]: [refreshEventStatusHandler],
} as const satisfies DomainEventHandlerMap;
