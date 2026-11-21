/**
 * DOMAIN_EVENT_HANDLERS (#1946): the one place that says what follows each kind of change. It is
 * exhaustive over `DomainEventType`, so a new event type without an entry fails typecheck; an
 * entry may be `[]`, which says on purpose that nothing follows. Each handler lives beside its
 * job's builder in the module that owns the job; this map only imports them.
 *
 * The map is pinned by `domain-event-handlers.test.ts`, and the domain event table in
 * docs/BACKGROUND-JOBS.md is generated from it (`npm run docs:domain-events`).
 */

import { releaseIntoTemplateContestsHandler } from '../contest-management/released-edition-job-requests';
import {
  rebuildChangedResultsLeaderboardsHandler,
  rebuildContestLeaderboardsHandler,
  rebuildDecidedGameLeaderboardsHandler,
  rebuildEventLeaderboardsHandler,
} from '../contests/leaderboard-rebuild-job-requests';
import { settleDecidedGameContestsHandler } from '../contests/settle-game-job-requests';
import { settleFinishedEventContestsHandler } from '../contests/settle-sport-event-job-requests';
import { syncGamesThenTierFieldHandler } from '../events/synced-field-follow-up-job';
import { tellLeaguesEventPostponedHandler, tellLeaguesEventRescheduledHandler } from '../notifications/contest-email-job-requests';
import { DomainEventType } from './domain-event';
import type { DomainEventHandlerMap } from './domain-event-handler';

export const DOMAIN_EVENT_HANDLERS = {
  [DomainEventType.SPORT_EVENT_STATUS_CHANGED]: [
    settleFinishedEventContestsHandler,
    releaseIntoTemplateContestsHandler,
    tellLeaguesEventPostponedHandler,
    rebuildEventLeaderboardsHandler,
  ],
  [DomainEventType.SPORT_EVENT_RESCHEDULED]: [tellLeaguesEventRescheduledHandler],
  [DomainEventType.SPORT_EVENT_RESULTS_CHANGED]: [rebuildChangedResultsLeaderboardsHandler],
  [DomainEventType.GAME_DECIDED]: [settleDecidedGameContestsHandler, rebuildDecidedGameLeaderboardsHandler],
  [DomainEventType.CONTEST_ENTRY_EVENT_STATUS_CHANGED]: [rebuildContestLeaderboardsHandler],
  [DomainEventType.SPORT_EVENT_FIELD_SYNCED]: [syncGamesThenTierFieldHandler],
} as const satisfies DomainEventHandlerMap;
