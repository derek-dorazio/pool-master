/**
 * Each background job type's payload schema (#1439). Exhaustive over the enum, so a new type
 * without a schema fails typecheck; the schema lives with the module whose handler reads it.
 */

import type { z } from 'zod';
import { BackgroundJobType } from '@poolmaster/shared/domain';
import { AddReleasedEditionToContestJobPayloadSchema } from '../contest-management/released-edition-job-requests';
import { ManualEventSyncJobPayloadSchema } from '../ingestion/manual-event-sync-job';
import { ProviderEventSyncJobPayloadSchema } from '../ingestion/provider-event-sync-job';
import {
  ContestEventChangedEmailsJobPayloadSchema,
  ContestSettledEmailsJobPayloadSchema,
  ContestStartedEmailsJobPayloadSchema,
} from '../notifications/contest-email-job-requests';
import { SettleSportEventContestsJobPayloadSchema } from '../contests/settle-sport-event-job-requests';
import { SettleGameContestsJobPayloadSchema } from '../contests/settle-game-job-requests';
import { RebuildLeaderboardsJobPayloadSchema } from '../contests/leaderboard-rebuild-job-requests';

export const BACKGROUND_JOB_PAYLOADS = {
  [BackgroundJobType.MANUAL_EVENT_SYNC]: ManualEventSyncJobPayloadSchema,
  [BackgroundJobType.PROVIDER_EVENT_SYNC]: ProviderEventSyncJobPayloadSchema,
  [BackgroundJobType.CONTEST_STARTED_EMAILS]: ContestStartedEmailsJobPayloadSchema,
  [BackgroundJobType.CONTEST_SETTLED_EMAILS]: ContestSettledEmailsJobPayloadSchema,
  [BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS]: ContestEventChangedEmailsJobPayloadSchema,
  [BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS]: SettleSportEventContestsJobPayloadSchema,
  [BackgroundJobType.SETTLE_GAME_CONTESTS]: SettleGameContestsJobPayloadSchema,
  [BackgroundJobType.REBUILD_LEADERBOARDS]: RebuildLeaderboardsJobPayloadSchema,
  [BackgroundJobType.ADD_RELEASED_EDITION_TO_CONTEST]: AddReleasedEditionToContestJobPayloadSchema,
} as const satisfies Record<BackgroundJobType, z.ZodType>;

/** What a job of type `T` carries. */
export type BackgroundJobPayload<T extends BackgroundJobType> = z.infer<(typeof BACKGROUND_JOB_PAYLOADS)[T]>;
