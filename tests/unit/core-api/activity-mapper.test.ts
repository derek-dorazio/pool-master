/**
 * Unit tests for the Activity mapper: one background job, with the sync runs it ran, as the
 * Activity read answers it.
 */
import { BackgroundJobKind, BackgroundJobStatus, BackgroundJobType, type BackgroundJob } from '@poolmaster/shared/domain';
import { ActivityJobDtoSchema } from '@poolmaster/shared/dto';
import { toActivityJobDto } from '../../../packages/core-api/src/mappers/activity.mapper';

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
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe('toActivityJobDto', () => {
  it('maps a finished league job with its kind, scope, result, error and sync runs, and the answer passes the contract schema', () => {
    const dto = toActivityJobDto(buildJob({
      status: BackgroundJobStatus.SUCCEEDED,
      attempts: 2,
      sportLeagueId: LEAGUE_ID,
      completedAt: new Date('2026-11-18T03:05:00.000Z'),
      lastError: 'first try timed out',
      result: { created: 2 },
    }), [RUN_1, RUN_2]);

    expect(dto).toEqual({
      id: JOB_ID,
      type: BackgroundJobType.SYNC_LEAGUE_EVENTS,
      kind: BackgroundJobKind.SYNC,
      status: BackgroundJobStatus.SUCCEEDED,
      sportLeagueId: LEAGUE_ID,
      sportEventId: null,
      attempts: 2,
      runAt: '2026-11-18T03:00:00.000Z',
      createdAt: '2026-11-18T03:00:00.000Z',
      completedAt: '2026-11-18T03:05:00.000Z',
      lastError: 'first try timed out',
      result: { created: 2 },
      syncRunIds: [RUN_1, RUN_2],
    });
    expect(() => ActivityJobDtoSchema.parse(dto)).not.toThrow();
  });

  it('answers null for what a waiting event job has not got yet: no league, no completion, no error, no result', () => {
    const dto = toActivityJobDto(buildJob({ type: BackgroundJobType.ADD_RELEASED_EDITION_TO_CONTEST, sportEventId: EVENT_ID }), []);

    expect(dto).toMatchObject({
      kind: BackgroundJobKind.RELEASE,
      sportLeagueId: null,
      sportEventId: EVENT_ID,
      completedAt: null,
      lastError: null,
      result: null,
      syncRunIds: [],
    });
  });
});
