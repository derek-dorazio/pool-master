/**
 * Unit tests for the ingestion mappers. pool-master-5h3 made the manual event sync
 * (`submitEventSync` since #205) and the events module's `refreshEventParticipants` share one
 * ProviderManualSyncSubmissionResult -> DTO transform.
 */
import {
  toProviderManualSyncSubmissionResponse,
  toProviderSyncRunDto,
} from '../../../packages/core-api/src/mappers/ingestion.mapper';
import type { ProviderManualSyncSubmissionResult } from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { ProviderSyncRunStatus, Sport, type ProviderSyncRun } from '@poolmaster/shared/domain';

function buildRun(overrides: Partial<ProviderSyncRun> = {}): ProviderSyncRun {
  return {
    id: 'run-1',
    providerId: 'mock-contest-feed',
    sport: Sport.GOLF,
    eventId: 'event-1',
    status: ProviderSyncRunStatus.SUBMITTED,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    payload: { recordsProcessed: 0 },
    ...overrides,
  };
}

describe('toProviderSyncRunDto', () => {
  it('pool-master-5h3 serializes dates to ISO strings and passes null start/completed through', () => {
    expect(toProviderSyncRunDto(buildRun())).toEqual({
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

    const dto = toProviderSyncRunDto(run);

    expect(dto.startedAt).toBe('2026-01-01T00:01:00.000Z');
    expect(dto.completedAt).toBe('2026-01-01T00:02:00.000Z');
  });
});

describe('toProviderManualSyncSubmissionResponse', () => {
  it('pool-master-5h3 maps the submission result and every run in it', () => {
    const result: ProviderManualSyncSubmissionResult = {
      sport: Sport.GOLF,
      eventId: 'event-1',
      requestedFeeds: ['EVENTPARTICIPANTS'],
      submittedAt: new Date('2026-01-01T00:00:00Z'),
      syncRuns: [buildRun(), buildRun({ id: 'run-2' })],
    };

    const response = toProviderManualSyncSubmissionResponse(result);

    expect(response.submittedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(response.syncRuns.map((run: { id: string }) => run.id)).toEqual(['run-1', 'run-2']);
  });
});
