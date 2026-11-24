/**
 * Unit tests for the ingestion mappers. pool-master-5h3 made the manual event sync
 * (`submitEventSync` since #205) and the events module's `refreshEventParticipants` share one
 * ProviderManualSyncSubmissionResult -> DTO transform.
 */
import { SCHEDULED_SCORES_RUN } from '../../support/sync-run-fixtures';
import {
  toProviderEventDto,
  toProviderManualSyncSubmissionResponse,
  toProviderSummaryDto,
  toProviderSyncRunDetailDto,
  toProviderSyncRunDto,
} from '../../../packages/core-api/src/mappers/ingestion.mapper';
import type { ProviderManualSyncSubmissionResult } from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { ProviderSyncRunStatus, Sport, type ProviderSyncRun } from '@poolmaster/shared/domain';
import { fakeLogger } from '../../support/fake-logger';

function buildRun(overrides: Partial<ProviderSyncRun> = {}): ProviderSyncRun {
  return {
    id: 'run-1',
    providerId: 'mock-contest-feed',
    sport: Sport.GOLF,
    eventId: 'event-1',
    ...SCHEDULED_SCORES_RUN,
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
      kind: 'SCORES',
      trigger: 'SCHEDULE',
      sportLeagueId: null,
      sportEventId: null,
      backgroundJobId: null,
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

describe('toProviderSyncRunDto request payload', () => {
  const requestPayload = {
    sport: Sport.GOLF,
    eventId: 'event-1',
    source: 'MANUAL',
    actor: { type: 'ROOT_ADMIN', userId: 'admin-1', email: 'admin@example.test' },
    normalizedAt: '2026-01-01T00:00:00.000Z',
  };

  it('publishes a stored request payload of the current shape, dropping keys the contract no longer has, such as a retired mockEventState', () => {
    const logger = fakeLogger();

    const dto = toProviderSyncRunDto(buildRun({ payload: { requestPayload: { ...requestPayload, workflowContext: {}, mockEventState: null } } }), logger);

    expect(dto.payload.requestPayload).toEqual(requestPayload);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('leaves out and logs a stored request payload an older release wrote, so one old run cannot fail the whole list', () => {
    const logger = fakeLogger();
    const legacy = { sport: Sport.GOLF, eventId: 'event-1', source: 'MANUAL', actor: { type: 'ROOT_ADMIN', userId: 'admin-1' } };

    const dto = toProviderSyncRunDto(buildRun({ payload: { requestPayload: legacy, recordsProcessed: 3 } }), logger);

    expect(dto.payload).toEqual({ recordsProcessed: 3 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ingestion.syncRun.requestPayloadSkipped' }),
      expect.any(String),
    );
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

describe('the provider, unmapped participant and provider event mappers', () => {
  const AT = new Date('2026-04-09T12:00:00.000Z');
  const provider = {
    providerId: 'p1',
    providerName: 'Feed',
    status: 'HEALTHY',
    errorRate: 0,
    latencyMs: 20,
    lastEventAt: AT,
    sportsCovered: [Sport.GOLF],
    activeEventCount: 2,
    requestsPerMinute: 600,
    webhooksEnabled: true,
    syncedSportLeagueCount: 16,
    rateLimitedJobsLast24h: 3,
    settings: null,
  } as unknown as Parameters<typeof toProviderSummaryDto>[0];

  it('sends a provider\'s request rate, webhook switch, synced sport league count and rate-limited job count as they are', () => {
    expect(toProviderSummaryDto(provider)).toMatchObject({ requestsPerMinute: 600, webhooksEnabled: true, syncedSportLeagueCount: 16, rateLimitedJobsLast24h: 3 });
  });

  it('sends a provider\'s stored settings and leagues with whether its webhook secret is set, and none for a provider with no row', () => {
    const league = { id: 'pl-1', providerId: 'prov-1', code: 'nfl', name: 'NFL', sport: Sport.AMERICAN_FOOTBALL, webhookEventSet: 'GAME_PERIODS', quietAfterMinutes: 30, typicalGameMinutes: 200, isEnabled: true };
    const settings = {
      id: 'prov-1', code: 'BALLDONTLIE', name: 'BALLDONTLIE', baseUrl: 'https://api.example.test', requestsPerMinute: 5, webhooksEnabled: true,
      webhookPollMinutes: 10, webhookRoundPollMinutes: 5, hasPlayerStats: true, isEnabled: true, priority: 1, leagues: [league], webhookSecretSet: false,
    };
    const dto = toProviderSummaryDto({ ...provider, settings } as unknown as Parameters<typeof toProviderSummaryDto>[0]);
    expect(dto.settings).toEqual({ ...settings, leagues: [{ id: 'pl-1', code: 'nfl', name: 'NFL', sport: Sport.AMERICAN_FOOTBALL, webhookEventSet: 'GAME_PERIODS', quietAfterMinutes: 30, typicalGameMinutes: 200, isEnabled: true }] });
    expect(toProviderSummaryDto(provider).settings).toBeNull();
  });

  it('sends a provider\'s last event time as ISO, and a provider that has sent none as null', () => {
    expect(toProviderSummaryDto(provider).lastEventAt).toBe(AT.toISOString());
    expect(toProviderSummaryDto({ ...provider, lastEventAt: null }).lastEventAt).toBeNull();
  });

  it('sends a run\'s stored details alongside the run', () => {
    const details = { warnings: ['late'] } as never;

    expect(toProviderSyncRunDetailDto({ ...buildRun(), details })).toEqual(expect.objectContaining({ id: 'run-1', details }));
  });

  const providerEvent = {
    externalId: 'x1',
    providerId: 'p1',
    sport: Sport.GOLF,
    name: 'Open',
    startDate: AT,
    status: 'SCHEDULED',
    fieldLocked: false,
  } as unknown as Parameters<typeof toProviderEventDto>[0];

  it('sends a provider event\'s omitted venue, location, end, rounds and field size as null', () => {
    expect(toProviderEventDto(providerEvent)).toEqual(expect.objectContaining({
      venue: null, location: null, endDate: null, rounds: null, participantCount: null, startDate: AT.toISOString(),
    }));
  });

  it('sends a provider event\'s venue, location, end, rounds and field size when given', () => {
    expect(toProviderEventDto({ ...providerEvent, venue: 'Augusta', location: 'GA', endDate: AT, rounds: 4, participantCount: 88 }))
      .toEqual(expect.objectContaining({ venue: 'Augusta', location: 'GA', endDate: AT.toISOString(), rounds: 4, participantCount: 88 }));
  });
});
