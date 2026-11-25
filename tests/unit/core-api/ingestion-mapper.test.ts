/**
 * Unit tests for the ingestion mappers. pool-master-5h3 made the manual event sync
 * (`submitEventSync` since #205) and the events module's `refreshEventParticipants` share one
 * ProviderManualSyncSubmissionResult -> DTO transform.
 */
import { SCHEDULED_SCORES_RUN } from '../../support/sync-run-fixtures';
import {
  toProviderManualSyncSubmissionResponse,
  toProviderSummaryDto,
  toProviderSyncRunDetailDto,
  toProviderSyncRunDto,
} from '../../../packages/core-api/src/mappers/ingestion.mapper';
import type { ProviderManualSyncSubmissionResult } from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { ProviderSyncRunStatus, Sport, type ProviderSyncRun } from '@poolmaster/shared/domain';

function buildRun(overrides: Partial<ProviderSyncRun> = {}): ProviderSyncRun {
  return {
    id: 'run-1',
    providerId: 'provider-row-1',
    providerName: 'Mock contest feed',
    sport: Sport.GOLF,
    eventId: 'event-1',
    ...SCHEDULED_SCORES_RUN,
    status: ProviderSyncRunStatus.SUBMITTED,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    summary: 'Submitted event live scores sync for event-1.',
    stats: {},
    changedCount: null,
    errorCount: 0,
    ...overrides,
  };
}

describe('toProviderSyncRunDto', () => {
  it('serializes dates to ISO strings, names the run\'s provider, passes its outcome columns and null start/completed through', () => {
    expect(toProviderSyncRunDto(buildRun())).toEqual({
      id: 'run-1',
      providerId: 'provider-row-1',
      providerName: 'Mock contest feed',
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
      summary: 'Submitted event live scores sync for event-1.',
      stats: {},
      changedCount: null,
      errorCount: 0,
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

describe('the provider, unmapped participant and provider event mappers', () => {
  const AT = new Date('2026-04-09T12:00:00.000Z');
  const provider = {
    providerId: 'p1',
    providerName: 'Feed',
    status: 'HEALTHY',
    errorRate: 0,
    lastEventAt: AT,
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
      webhookPollMinutes: 10, webhookRoundPollMinutes: 5, hasPlayerStats: true, isEnabled: true, leagues: [league], webhookSecretSet: false,
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
});
