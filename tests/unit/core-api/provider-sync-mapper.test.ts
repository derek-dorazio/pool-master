/**
 * Unit tests for the provider-sync mappers extracted in pool-master-5h3 so
 * `adminSyncProviderEventData`/`adminPrepareSportSync` and the new
 * `adminRefreshGolfTournamentField` route share one
 * ProviderManualSyncSubmissionResult -> DTO transform.
 */
import {
  toProviderManualSyncSubmissionResponse,
  toProviderSyncRunDto,
} from '../../../packages/core-api/src/mappers/provider-sync.mapper';

function buildRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    providerId: 'mock-contest-feed',
    sport: 'GOLF',
    eventId: 'event-1',
    status: 'SUBMITTED',
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    payload: { recordsProcessed: 0 },
    ...overrides,
  };
}

describe('toProviderSyncRunDto', () => {
  it('pool-master-5h3 serializes dates to ISO strings and passes null start/completed through', () => {
    expect(toProviderSyncRunDto(buildRun() as any)).toEqual({
      id: 'run-1',
      providerId: 'mock-contest-feed',
      sport: 'GOLF',
      eventId: 'event-1',
      status: 'SUBMITTED',
      startedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      payload: { recordsProcessed: 0 },
    });
  });

  it('pool-master-5h3 serializes startedAt/completedAt when present', () => {
    const run = buildRun({
      startedAt: new Date('2026-01-01T00:01:00Z'),
      completedAt: new Date('2026-01-01T00:02:00Z'),
    });

    const dto = toProviderSyncRunDto(run as any);

    expect(dto.startedAt).toBe('2026-01-01T00:01:00.000Z');
    expect(dto.completedAt).toBe('2026-01-01T00:02:00.000Z');
  });
});

describe('toProviderManualSyncSubmissionResponse', () => {
  it('pool-master-5h3 maps the submission result and every run in it', () => {
    const result = {
      sport: 'GOLF',
      eventId: 'event-1',
      requestedFeeds: ['EVENTPARTICIPANTS'],
      submittedAt: new Date('2026-01-01T00:00:00Z'),
      syncRuns: [buildRun(), buildRun({ id: 'run-2' })],
    };

    const response = toProviderManualSyncSubmissionResponse(result as any);

    expect(response.submittedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(response.syncRuns.map((run) => run.id)).toEqual(['run-1', 'run-2']);
  });
});
