/**
 * Unit tests for the Activity mapper: one background job, with the sync runs it ran and the
 * sport league and event it is about, as the Activity read answers it.
 */
import { BackgroundJobKind, BackgroundJobStatus, BackgroundJobType, JobErrorType, JobTrigger, type BackgroundJob } from '@poolmaster/shared/domain';
import { ActivityJobDtoSchema } from '@poolmaster/shared/dto';
import { toActivityJobDto } from '../../../packages/core-api/src/mappers/activity.mapper';
import type { ActivityJob } from '../../../packages/core-api/src/modules/activity/activity-service';

const JOB_ID = '00000000-0000-4000-8000-000000000001';
const LEAGUE_ID = '00000000-0000-4000-8000-000000000002';
const EVENT_ID = '00000000-0000-4000-8000-000000000003';
const RUN_1 = '00000000-0000-4000-8000-000000000004';
const RUN_2 = '00000000-0000-4000-8000-000000000005';
const CREATED_AT = new Date('2026-11-18T03:00:00.000Z');

function buildJob(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: JOB_ID,
    type: BackgroundJobType.SYNC_LEAGUE_EVENTS,
    payload: {},
    status: BackgroundJobStatus.QUEUED,
    runAt: CREATED_AT,
    attempts: 0,
    trigger: JobTrigger.SCHEDULE,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

/** A job as Activity presents it: about no league or event unless the test says so. */
function presented(job: BackgroundJob, syncRunIds: string[] = [], scope: Partial<Pick<ActivityJob, 'sportLeague' | 'sportEvent'>> = {}): ActivityJob {
  return { job, syncRunIds, sportLeague: null, sportEvent: null, ...scope };
}

describe('toActivityJobDto', () => {
  it('maps a finished league job with its kind, scope, trigger, changed rows, duration, result, error and sync runs, and the answer passes the contract schema', () => {
    const dto = toActivityJobDto(presented(buildJob({
      status: BackgroundJobStatus.SUCCEEDED,
      attempts: 2,
      sportLeagueId: LEAGUE_ID,
      startedAt: new Date('2026-11-18T03:04:12.000Z'),
      completedAt: new Date('2026-11-18T03:05:00.400Z'),
      lastError: 'first try timed out',
      changedCount: 2,
      result: { created: 2 },
    }), [RUN_1, RUN_2], { sportLeague: { id: LEAGUE_ID, name: 'PGA Tour' } }));

    expect(dto).toEqual({
      id: JOB_ID,
      type: BackgroundJobType.SYNC_LEAGUE_EVENTS,
      kind: BackgroundJobKind.SYNC,
      status: BackgroundJobStatus.SUCCEEDED,
      sportLeagueId: LEAGUE_ID,
      sportEventId: null,
      sportLeague: { id: LEAGUE_ID, name: 'PGA Tour' },
      sportEvent: null,
      attempts: 2,
      runAt: '2026-11-18T03:00:00.000Z',
      createdAt: '2026-11-18T03:00:00.000Z',
      completedAt: '2026-11-18T03:05:00.400Z',
      lastError: 'first try timed out',
      trigger: JobTrigger.SCHEDULE,
      startedBy: null,
      startedAt: '2026-11-18T03:04:12.000Z',
      durationSeconds: 48,
      changedCount: 2,
      errorType: null,
      result: { created: 2 },
      syncRunIds: [RUN_1, RUN_2],
    });
    expect(() => ActivityJobDtoSchema.parse(dto)).not.toThrow();
  });

  it('names a waiting event job\'s event and the event\'s league, and answers null for what it has not got yet: no league id of its own, no start, no duration, no changed rows, no error, no result', () => {
    const dto = toActivityJobDto(presented(
      buildJob({ type: BackgroundJobType.RELEASE_SPORT_EVENT, sportEventId: EVENT_ID, trigger: JobTrigger.SYSTEM }),
      [],
      { sportLeague: { id: LEAGUE_ID, name: 'PGA Tour' }, sportEvent: { id: EVENT_ID, name: 'The Sentry' } },
    ));

    expect(dto).toMatchObject({
      kind: BackgroundJobKind.RELEASE,
      sportLeagueId: null,
      sportEventId: EVENT_ID,
      sportLeague: { id: LEAGUE_ID, name: 'PGA Tour' },
      sportEvent: { id: EVENT_ID, name: 'The Sentry' },
      trigger: JobTrigger.SYSTEM,
      startedBy: null,
      startedAt: null,
      durationSeconds: null,
      changedCount: null,
      errorType: null,
      completedAt: null,
      lastError: null,
      result: null,
      syncRunIds: [],
    });
  });

  it('names the admin who started an ADMIN job by their full name, falling back to their username when they have none', () => {
    const starter = { id: '00000000-0000-4000-8000-0000000000aa', firstName: 'Dana', lastName: 'Lee', username: 'dlee', email: 'dana@example.com' };

    expect(toActivityJobDto(presented(buildJob({ trigger: JobTrigger.ADMIN, startedBy: starter }))).startedBy)
      .toEqual({ id: starter.id, displayName: 'Dana Lee' });
    expect(toActivityJobDto(presented(buildJob({ trigger: JobTrigger.ADMIN, startedBy: { ...starter, firstName: '', lastName: ' ' } }))).startedBy)
      .toEqual({ id: starter.id, displayName: 'dlee' });
  });

  it('answers a still-running try with no duration, and a failed job with its error type', () => {
    const running = toActivityJobDto(presented(buildJob({ status: BackgroundJobStatus.RUNNING, attempts: 1, startedAt: CREATED_AT })));
    expect(running).toMatchObject({ startedAt: '2026-11-18T03:00:00.000Z', durationSeconds: null });

    const failed = toActivityJobDto(presented(buildJob({
      status: BackgroundJobStatus.FAILED,
      attempts: 4,
      startedAt: CREATED_AT,
      completedAt: new Date('2026-11-18T03:00:09.000Z'),
      lastError: 'BALLDONTLIE request /pga/v1/tournaments failed: 429 Too Many Requests',
      errorType: JobErrorType.RATE_LIMITED,
    })));
    expect(failed).toMatchObject({ durationSeconds: 9, changedCount: null, errorType: JobErrorType.RATE_LIMITED });
    expect(() => ActivityJobDtoSchema.parse(failed)).not.toThrow();
  });
});
