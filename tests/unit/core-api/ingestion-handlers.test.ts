/**
 * The ingestion route handlers (#1482), called with a stand-in ingestion service: the filters a
 * run list passes on, the status each sync refusal is sent with, and that an error the handler
 * does not own reaches the global error handler unchanged.
 */
import { expect } from '@jest/globals';
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
  SportSyncNotConfiguredError,
  type IngestionService,
} from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';

const AT = new Date('2026-04-10T12:00:00.000Z');
const boom = new Error('feed down');
const run = {
  id: 'run-1', providerId: 'feed', sport: Sport.GOLF, eventId: 'e1', status: ProviderSyncRunStatus.SUBMITTED,
  startedAt: null, completedAt: null, createdAt: AT, payload: {},
};

function service(overrides: Record<string, unknown> = {}) {
  return {
    listProviders: jest.fn((..._args: unknown[]) => Promise.resolve([{ providerId: 'feed', lastEventAt: null }])),
    listSyncRuns: jest.fn((..._args: unknown[]) => Promise.resolve([run])),
    getSyncRun: jest.fn((..._args: unknown[]) => Promise.resolve({ ...run, details: null })),
    syncEventData: jest.fn((..._args: unknown[]) => Promise.resolve({ sport: Sport.GOLF, eventId: 'e1', requestedFeeds: ['SCORES'], submittedAt: AT, syncRuns: [run] })),
    getUnmappedParticipants: jest.fn((..._args: unknown[]) => Promise.resolve([{ providerId: 'feed', providerName: 'Feed', externalId: 'x1', externalName: 'One', sport: Sport.GOLF }])),
    ...overrides,
  };
}
const scoreSources = (listCandidateEvents: unknown) => ({ listCandidateEvents }) as unknown as EventScoreSourceService;
const handlersOver = (fake: ReturnType<typeof service>, sources = scoreSources(jest.fn())) => createIngestionHandlers(fake as unknown as IngestionService, sources);

describe('ingestion provider and run handlers', () => {
  it('lists the registered providers', async () => {
    const reply = await callHandler(handlersOver(service()).listProviders, stubRequest({ contextLogger: false }));

    expect(reply.body).toMatchObject({ providers: [{ providerId: 'feed', lastEventAt: null }] });
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

  it('lists the unmapped provider participants the query filters to', async () => {
    const fake = service();

    const reply = await callHandler(handlersOver(fake).listUnmappedParticipants, stubRequest({ query: { providerId: 'feed' }, contextLogger: false }));

    expect(fake.getUnmappedParticipants).toHaveBeenCalledWith({ providerId: 'feed' });
    expect(reply.body).toMatchObject({ participants: [{ externalId: 'x1' }] });
  });
});

describe('manual event sync handler', () => {
  const params = { sport: Sport.GOLF, eventId: 'e1' };
  const admin = authUser('admin', { isRootAdmin: true, email: 'admin@example.test' });

  it('submits a sync as the signed-in root admin with 202 and the runs it queued', async () => {
    const fake = service();

    const reply = await callHandler(handlersOver(fake).submitEventSync, stubRequest({
      params, body: { feeds: ['SCORES'], mockEventState: 'LIVE' }, authUser: admin, contextLogger: false,
    }));

    expect(fake.syncEventData).toHaveBeenCalledWith({ sport: Sport.GOLF, eventId: 'e1', feeds: ['SCORES'], mockEventState: 'LIVE' }, 'admin', 'admin@example.test');
    expect(reply).toMatchObject({ statusCode: 202, body: { eventId: 'e1', submittedAt: AT.toISOString(), syncRuns: [{ id: 'run-1' }] } });
  });

  it.each([
    ['a sport with no provider with 404 SPORT_PROVIDER_NOT_FOUND', new SportProviderNotFoundError(Sport.GOLF), 404, 'SPORT_PROVIDER_NOT_FOUND'],
    ['a sport ingestion is not set up for with 422 SPORT_SYNC_NOT_CONFIGURED', new SportSyncNotConfiguredError(Sport.GOLF), 422, 'SPORT_SYNC_NOT_CONFIGURED'],
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

describe('provider catalog browse errors', () => {
  it('answers a catalog refusal with its own status and code, and passes any other failure on', async () => {
    const request = () => stubRequest({ params: { providerId: 'feed' }, query: { sport: Sport.GOLF } });
    const refused = handlersOver(service(), scoreSources(() => Promise.reject(new EventScoreSourceError('Unknown provider', 'PROVIDER_NOT_FOUND', 404))));
    const broken = handlersOver(service(), scoreSources(() => Promise.reject(boom)));

    expect(await callHandler(refused.listProviderCatalogEvents, request())).toMatchObject({ statusCode: 404, body: { error: { code: 'PROVIDER_NOT_FOUND' } } });
    await expect(callHandler(broken.listProviderCatalogEvents, request())).rejects.toBe(boom);
  });
});
