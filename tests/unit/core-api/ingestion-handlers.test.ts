/**
 * The ingestion route handlers (#1482), called with a stand-in ingestion service: the filters a
 * run list passes on, the status each sync refusal is sent with, and that an error the handler
 * does not own reaches the global error handler unchanged.
 */
import { expect } from '@jest/globals';
import {
  PROVIDER_LEAGUE_MINUTES_RANGE,
  PROVIDER_POLL_MINUTES_RANGE,
  PROVIDER_PRIORITY_RANGE,
  PROVIDER_REQUESTS_PER_MINUTE_RANGE,
} from '../../../packages/shared/domain';
import { ProviderSyncRunStatus, Sport } from '@poolmaster/shared/domain';
import type { EventScoreSourceService } from '../../../packages/core-api/src/modules/events/event-score-source-service';
import { EventScoreSourceError } from '../../../packages/core-api/src/modules/events/event-score-source-service';
import { SyncRequestValidationError } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import { createIngestionHandlers } from '../../../packages/core-api/src/modules/ingestion/handler';
import {
  MockEventStateUnsupportedError,
  ProviderSyncRunNotFoundError,
  SportEventSyncScopeError,
  SportProviderNotFoundError,
  type IngestionService,
} from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { ProviderSettingsError, type ProviderSettingsService } from '../../../packages/core-api/src/modules/ingestion/provider-settings-service';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';
import { BALLDONTLIE_TEST_LEAGUES, balldontlieTestProvider } from '../../support/balldontlie-provider-rows';

const AT = new Date('2026-04-10T12:00:00.000Z');
const boom = new Error('feed down');
const run = {
  id: 'run-1', providerId: 'feed', sport: Sport.GOLF, eventId: 'e1', status: ProviderSyncRunStatus.SUBMITTED,
  startedAt: null, completedAt: null, createdAt: AT, payload: {},
};

function service(overrides: Record<string, unknown> = {}) {
  return {
    listProviders: jest.fn((..._args: unknown[]) => Promise.resolve([{ providerId: 'feed', lastEventAt: null, settings: null }])),
    listSyncRuns: jest.fn((..._args: unknown[]) => Promise.resolve([run])),
    getSyncRun: jest.fn((..._args: unknown[]) => Promise.resolve({ ...run, details: null })),
    syncEventData: jest.fn((..._args: unknown[]) => Promise.resolve({ sport: Sport.GOLF, eventId: 'e1', requestedFeeds: ['SCORES'], submittedAt: AT, syncRuns: [run] })),
    ...overrides,
  };
}
const scoreSources = (listCandidateEvents: unknown) => ({ listCandidateEvents }) as unknown as EventScoreSourceService;
/** The Providers page's saves, answering with BALLDONTLIE's row unless told otherwise. */
function providerSettings(overrides: Partial<Record<'updateProvider' | 'updateLeague', jest.Mock>> = {}) {
  return {
    updateProvider: jest.fn().mockResolvedValue({ provider: balldontlieTestProvider(), webhookSecretSet: true }),
    updateLeague: jest.fn().mockResolvedValue(BALLDONTLIE_TEST_LEAGUES[0]),
    ...overrides,
  };
}
const handlersOver = (fake: ReturnType<typeof service>, sources = scoreSources(jest.fn()), settings = providerSettings()) =>
  createIngestionHandlers(fake as unknown as IngestionService, sources, settings as unknown as ProviderSettingsService);

describe('ingestion provider and run handlers', () => {
  it('lists the registered providers with the range the API holds each setting to', async () => {
    const reply = await callHandler(handlersOver(service()).listProviders, stubRequest({ contextLogger: false }));

    expect(reply.body).toMatchObject({
      providers: [{ providerId: 'feed', lastEventAt: null }],
      settingRanges: {
        requestsPerMinute: PROVIDER_REQUESTS_PER_MINUTE_RANGE,
        pollMinutes: PROVIDER_POLL_MINUTES_RANGE,
        priority: PROVIDER_PRIORITY_RANGE,
        leagueMinutes: PROVIDER_LEAGUE_MINUTES_RANGE,
      },
    });
  });

  it('saves a provider\'s settings and answers its row with whether its webhook secret is set', async () => {
    const settings = providerSettings();
    const reply = await callHandler(
      handlersOver(service(), undefined, settings).updateProvider,
      stubRequest({ params: { providerId: 'p1' }, body: { requestsPerMinute: 600 } }),
    );

    expect(settings.updateProvider).toHaveBeenCalledWith('p1', { requestsPerMinute: 600 });
    expect(reply.body).toMatchObject({ provider: { code: 'BALLDONTLIE', name: 'BALLDONTLIE', requestsPerMinute: 600, webhookSecretSet: true } });
  });

  it('sends a refused provider save with its status and code, and passes any other failure on', async () => {
    const refused = providerSettings({ updateProvider: jest.fn().mockRejectedValue(new ProviderSettingsError('Its secret is not set.', 'PROVIDER_WEBHOOK_SECRET_MISSING')) });
    const failing = providerSettings({ updateProvider: jest.fn().mockRejectedValue(boom) });
    const request = () => stubRequest({ params: { providerId: 'p1' }, body: { webhooksEnabled: true } });

    await expect(callHandler(handlersOver(service(), undefined, refused).updateProvider, request()))
      .resolves.toMatchObject({ statusCode: 422, body: { error: { code: 'PROVIDER_WEBHOOK_SECRET_MISSING' } } });
    await expect(callHandler(handlersOver(service(), undefined, failing).updateProvider, request())).rejects.toBe(boom);
  });

  it('saves a provider league\'s settings, and sends one not found as 404 PROVIDER_LEAGUE_NOT_FOUND', async () => {
    const settings = providerSettings();
    const missing = providerSettings({ updateLeague: jest.fn().mockRejectedValue(new ProviderSettingsError('Not found.', 'PROVIDER_LEAGUE_NOT_FOUND')) });
    const request = () => stubRequest({ params: { providerId: 'p1', providerLeagueId: 'l1' }, body: { typicalGameMinutes: 200 } });

    const saved = await callHandler(handlersOver(service(), undefined, settings).updateProviderLeague, request());
    const notFound = await callHandler(handlersOver(service(), undefined, missing).updateProviderLeague, request());

    expect(settings.updateLeague).toHaveBeenCalledWith('p1', 'l1', { typicalGameMinutes: 200 });
    expect(saved.body).toMatchObject({ league: { code: 'pga', name: 'PGA TOUR' } });
    expect(notFound).toMatchObject({ statusCode: 404, body: { error: { code: 'PROVIDER_LEAGUE_NOT_FOUND' } } });
  });

  it('passes any other failure saving a provider league on to the global error handler', async () => {
    const failing = providerSettings({ updateLeague: jest.fn().mockRejectedValue(boom) });

    await expect(callHandler(
      handlersOver(service(), undefined, failing).updateProviderLeague,
      stubRequest({ params: { providerId: 'p1', providerLeagueId: 'l1' }, body: {} }),
    )).rejects.toBe(boom);
  });

  it('lists sync runs with the query\'s window read as dates, and an omitted window as none', async () => {
    const fake = service();
    const handlers = handlersOver(fake);

    await callHandler(handlers.listSyncRuns, stubRequest({ query: { providerId: 'feed', from: '2026-04-01T00:00:00.000Z', to: '2026-04-30T00:00:00.000Z' } }));
    const reply = await callHandler(handlers.listSyncRuns, stubRequest({ query: {}, contextLogger: false }));

    expect(fake.listSyncRuns.mock.calls).toEqual([
      [{ providerId: 'feed', sport: undefined, status: undefined, from: new Date('2026-04-01T00:00:00.000Z'), to: new Date('2026-04-30T00:00:00.000Z') }],
      [{ providerId: undefined, sport: undefined, status: undefined, from: undefined, to: undefined }],
    ]);
    expect(reply.body).toMatchObject({ syncRuns: [{ id: 'run-1' }] });
  });

  it('answers a run with its details, and a missing run with 404 SYNC_RUN_NOT_FOUND', async () => {
    const found = await callHandler(handlersOver(service()).getSyncRun, stubRequest({ params: { syncRunId: 'run-1' }, contextLogger: false }));
    const missing = await callHandler(
      handlersOver(service({ getSyncRun: () => Promise.reject(new ProviderSyncRunNotFoundError('run-9')) })).getSyncRun,
      stubRequest({ params: { syncRunId: 'run-9' } }),
    );

    expect(found.body).toMatchObject({ id: 'run-1', details: null });
    expect(missing).toMatchObject({ statusCode: 404, body: { error: { code: 'SYNC_RUN_NOT_FOUND' } } });
  });

  it('passes any other failure reading a run on to the global error handler', async () => {
    const handlers = handlersOver(service({ getSyncRun: () => Promise.reject(boom) }));

    await expect(callHandler(handlers.getSyncRun, stubRequest({ params: { syncRunId: 'run-1' } }))).rejects.toBe(boom);
  });
});

describe('manual event sync handler', () => {
  const params = { sport: Sport.GOLF, eventId: 'e1' };
  const admin = authUser('admin', { isRootAdmin: true, email: 'admin@example.test' });

  it('submits a sync as the signed-in root admin with 202 and the runs it queued', async () => {
    const fake = service();

    const reply = await callHandler(handlersOver(fake).submitEventSync, stubRequest({
      params, body: { providerId: 'feed', feeds: ['SCORES'], mockEventState: 'LIVE' }, authUser: admin, contextLogger: false,
    }));

    expect(fake.syncEventData).toHaveBeenCalledWith({ sport: Sport.GOLF, providerId: 'feed', eventId: 'e1', feeds: ['SCORES'], mockEventState: 'LIVE' }, 'admin', 'admin@example.test');
    expect(reply).toMatchObject({ statusCode: 202, body: { eventId: 'e1', submittedAt: AT.toISOString(), syncRuns: [{ id: 'run-1' }] } });
  });

  it.each<[string, Error, number, string]>([
    ['a sport with no provider with 404 SPORT_PROVIDER_NOT_FOUND', new SportProviderNotFoundError(Sport.GOLF, 'feed'), 404, 'SPORT_PROVIDER_NOT_FOUND'],
    ['a mock state the provider cannot play with 422 MOCK_EVENT_STATE_UNSUPPORTED', new MockEventStateUnsupportedError('feed'), 422, 'MOCK_EVENT_STATE_UNSUPPORTED'],
    ['a feed the event\'s sync scope leaves out with 409 SPORT_EVENT_SYNC_SCOPE_RESTRICTED', new SportEventSyncScopeError('e1', 'SCORES_ONLY', ['FIELD']), 409, 'SPORT_EVENT_SYNC_SCOPE_RESTRICTED'],
  ])('refuses a sync for %s', async (_label, error, status, code) => {
    const handlers = handlersOver(service({ syncEventData: () => Promise.reject(error) }));

    const reply = await callHandler(handlers.submitEventSync, stubRequest({ params, body: { feeds: ['SCORES'] }, authUser: admin }));

    expect(reply).toMatchObject({ statusCode: status, body: { error: { code } } });
  });

  it('refuses a sync that fails validation with 422 SYNC_REQUEST_INVALID and the validation code', async () => {
    const handlers = handlersOver(service({ syncEventData: () => Promise.reject(new SyncRequestValidationError('EMPTY_FEED_LIST', 'No feeds')) }));

    const reply = await callHandler(handlers.submitEventSync, stubRequest({ params, body: { feeds: [] }, authUser: admin }));

    expect(reply).toMatchObject({ statusCode: 422, body: { error: { code: 'SYNC_REQUEST_INVALID', details: { validationCode: 'EMPTY_FEED_LIST' } } } });
  });

  it('passes an unexpected sync failure on to the global error handler', async () => {
    const handlers = handlersOver(service({ syncEventData: () => Promise.reject(boom) }));

    await expect(callHandler(handlers.submitEventSync, stubRequest({ params, body: { feeds: ['SCORES'] }, authUser: admin }))).rejects.toBe(boom);
  });

  it('refuses a sync with no session with 401 AUTH_SESSION_REQUIRED', async () => {
    await expect(callHandler(handlersOver(service()).submitEventSync, stubRequest({ params, body: { feeds: ['SCORES'] } })))
      .rejects.toMatchObject({ statusCode: 401, code: 'AUTH_SESSION_REQUIRED' });
  });
});

describe('provider catalog browse handler', () => {
  const masters = {
    externalId: 'ext-1', providerId: 'feed', sport: Sport.GOLF, name: 'The Masters', venue: 'Augusta National',
    startDate: new Date('2027-04-08T00:00:00.000Z'), endDate: new Date('2027-04-11T00:00:00.000Z'), status: 'SCHEDULED', fieldLocked: false, metadata: {},
  };

  it('lists a provider\'s catalog events for the query\'s window read as dates, each as a provider event', async () => {
    const listCandidateEvents = jest.fn((..._args: unknown[]) => Promise.resolve([masters]));

    const reply = await callHandler(handlersOver(service(), scoreSources(listCandidateEvents)).listProviderCatalogEvents, stubRequest({
      params: { providerId: 'feed' },
      query: { sport: Sport.GOLF, sportLeagueId: 'sl-1', from: '2027-04-05T00:00:00.000Z', to: '2027-04-14T00:00:00.000Z', search: 'masters' },
    }));

    expect(listCandidateEvents).toHaveBeenCalledWith('feed', Sport.GOLF, {
      sportLeagueId: 'sl-1', from: new Date('2027-04-05T00:00:00.000Z'), to: new Date('2027-04-14T00:00:00.000Z'), search: 'masters',
    });
    expect(reply.body).toEqual({
      events: [{
        externalId: 'ext-1', providerId: 'feed', sport: Sport.GOLF, name: 'The Masters', venue: 'Augusta National', location: null,
        startDate: '2027-04-08T00:00:00.000Z', endDate: '2027-04-11T00:00:00.000Z', status: 'SCHEDULED', rounds: null, participantCount: null, fieldLocked: false,
      }],
    });
  });

  it('passes no window, search or sport league on when the query names none', async () => {
    const listCandidateEvents = jest.fn((..._args: unknown[]) => Promise.resolve([]));

    await callHandler(handlersOver(service(), scoreSources(listCandidateEvents)).listProviderCatalogEvents, stubRequest({ params: { providerId: 'feed' }, query: { sport: Sport.GOLF } }));

    expect(listCandidateEvents).toHaveBeenCalledWith('feed', Sport.GOLF, { sportLeagueId: undefined, from: undefined, to: undefined, search: undefined });
  });

  it('answers a catalog refusal with its own status and code, and passes any other failure on', async () => {
    const request = () => stubRequest({ params: { providerId: 'feed' }, query: { sport: Sport.GOLF } });
    const refused = handlersOver(service(), scoreSources(() => Promise.reject(new EventScoreSourceError('Unknown provider', 'PROVIDER_NOT_FOUND', 404))));
    const broken = handlersOver(service(), scoreSources(() => Promise.reject(boom)));

    expect(await callHandler(refused.listProviderCatalogEvents, request())).toMatchObject({ statusCode: 404, body: { error: { code: 'PROVIDER_NOT_FOUND' } } });
    await expect(callHandler(broken.listProviderCatalogEvents, request())).rejects.toBe(boom);
  });
});
