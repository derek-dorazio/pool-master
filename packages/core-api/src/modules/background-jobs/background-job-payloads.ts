/**
 * Each background job type's payload schema (#1439). Exhaustive over the enum, so a new type
 * without a schema fails typecheck; the schema lives with the module whose handler reads it.
 */

import type { z } from 'zod';
import { BackgroundJobType, type BackgroundJobScope, type ProviderCode } from '@poolmaster/shared/domain';
import { SyncLeagueEventsJobPayloadSchema } from '../events/league-events-sync-job';
import { EventSyncJobPayloadSchema } from '../ingestion/event-sync-job-requests';
import {
  ContestEventChangedEmailsJobPayloadSchema,
  ContestReopenedEmailsJobPayloadSchema,
  ContestSettledEmailsJobPayloadSchema,
  ContestStartedEmailsJobPayloadSchema,
} from '../notifications/contest-email-job-requests';
import { SettleSportEventContestsJobPayloadSchema } from '../contests/settle-sport-event-job-requests';
import { SettleGameContestsJobPayloadSchema } from '../contests/settle-game-job-requests';
import { LeaderboardRebuildSubject, RebuildLeaderboardsJobPayloadSchema } from '../contests/leaderboard-rebuild-job-requests';
import { ReleaseSportEventJobPayloadSchema } from '../events/release-sport-event-job';
import { SyncEventGamesAndTiersJobPayloadSchema } from '../events/synced-field-follow-up-job';
import { EventContestsJobPayloadSchema } from '../events/event-contests-job-requests';
import { ResolveMappedParticipantFindingsJobPayloadSchema } from '../ingestion/findings/mapped-participant-findings-job';
import { RefreshSlotTiebreakersJobPayloadSchema } from '../events/slot-tiebreaker-job';
import { SyncLeagueRosterJobPayloadSchema } from '../ingestion/roster/league-roster-sync-job';
import { RefreshStatusJobPayloadSchema } from '../events/status-refresh-job-requests';

export const BACKGROUND_JOB_PAYLOADS = {
  [BackgroundJobType.SYNC_EVENT_FIELD]: EventSyncJobPayloadSchema,
  [BackgroundJobType.SYNC_EVENT_SCORES]: EventSyncJobPayloadSchema,
  [BackgroundJobType.CONTEST_STARTED_EMAILS]: ContestStartedEmailsJobPayloadSchema,
  [BackgroundJobType.CONTEST_SETTLED_EMAILS]: ContestSettledEmailsJobPayloadSchema,
  [BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS]: ContestEventChangedEmailsJobPayloadSchema,
  [BackgroundJobType.CONTEST_REOPENED_EMAILS]: ContestReopenedEmailsJobPayloadSchema,
  [BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS]: SettleSportEventContestsJobPayloadSchema,
  [BackgroundJobType.SETTLE_GAME_CONTESTS]: SettleGameContestsJobPayloadSchema,
  [BackgroundJobType.REBUILD_LEADERBOARDS]: RebuildLeaderboardsJobPayloadSchema,
  [BackgroundJobType.SYNC_LEAGUE_EVENTS]: SyncLeagueEventsJobPayloadSchema,
  [BackgroundJobType.RELEASE_SPORT_EVENT]: ReleaseSportEventJobPayloadSchema,
  [BackgroundJobType.SYNC_EVENT_GAMES_AND_TIERS]: SyncEventGamesAndTiersJobPayloadSchema,
  [BackgroundJobType.ACTIVATE_EVENT_CONTESTS]: EventContestsJobPayloadSchema,
  [BackgroundJobType.FOLLOW_POSTPONED_EVENT_CONTESTS]: EventContestsJobPayloadSchema,
  [BackgroundJobType.RESOLVE_MAPPED_PARTICIPANT_FINDINGS]: ResolveMappedParticipantFindingsJobPayloadSchema,
  [BackgroundJobType.REFRESH_SLOT_TIEBREAKERS]: RefreshSlotTiebreakersJobPayloadSchema,
  [BackgroundJobType.SYNC_LEAGUE_ROSTER]: SyncLeagueRosterJobPayloadSchema,
  [BackgroundJobType.REFRESH_SLOT_STATUS]: RefreshStatusJobPayloadSchema,
  [BackgroundJobType.REFRESH_EVENT_STATUS]: RefreshStatusJobPayloadSchema,
} as const satisfies Record<BackgroundJobType, z.ZodType>;

/** What a job of type `T` carries. */
export type BackgroundJobPayload<T extends BackgroundJobType> = z.infer<(typeof BACKGROUND_JOB_PAYLOADS)[T]>;

/**
 * Each job type's scope, read from its payload when it is queued (#1819), so Activity filters
 * jobs by sport league and event on indexed columns. Exhaustive over the type, so a new type
 * must say what it is about. A job on an event names the event only; its league is the event's.
 */
export const BACKGROUND_JOB_SCOPES: {
  [T in BackgroundJobType]: (payload: BackgroundJobPayload<T>) => BackgroundJobScope & { providerCode?: ProviderCode };
} = {
  // An event sync's Provider is named by whoever queues it (#2040, #2009): its payload holds our ids only.
  [BackgroundJobType.SYNC_EVENT_FIELD]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.SYNC_EVENT_SCORES]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.CONTEST_STARTED_EMAILS]: ({ sportEventId }) => ({ sportEventId }),
  // A contest's results may span several events, so the job names none.
  [BackgroundJobType.CONTEST_SETTLED_EMAILS]: () => ({}),
  [BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.CONTEST_REOPENED_EMAILS]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.SETTLE_GAME_CONTESTS]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.REBUILD_LEADERBOARDS]: ({ subject, id }) => (subject === LeaderboardRebuildSubject.EVENT ? { sportEventId: id } : {}),
  [BackgroundJobType.RELEASE_SPORT_EVENT]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.SYNC_LEAGUE_EVENTS]: ({ sportLeagueId }) => ({ sportLeagueId }),
  [BackgroundJobType.SYNC_EVENT_GAMES_AND_TIERS]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.ACTIVATE_EVENT_CONTESTS]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.FOLLOW_POSTPONED_EVENT_CONTESTS]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.RESOLVE_MAPPED_PARTICIPANT_FINDINGS]: ({ sportLeagueId }) => ({ sportLeagueId }),
  [BackgroundJobType.REFRESH_SLOT_TIEBREAKERS]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.SYNC_LEAGUE_ROSTER]: ({ sportLeagueId }) => ({ sportLeagueId }),
  [BackgroundJobType.REFRESH_SLOT_STATUS]: ({ sportEventId }) => ({ sportEventId }),
  [BackgroundJobType.REFRESH_EVENT_STATUS]: ({ sportEventId }) => ({ sportEventId }),
};
