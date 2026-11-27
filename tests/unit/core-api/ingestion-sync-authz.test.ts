import Fastify from 'fastify';
import { FASTIFY_AJV_OPTIONS } from '../../../packages/core-api/src/plugins/string-transforms';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import {
  ErrorEnvelopeSchema,
  ProviderManualSyncSubmissionResponseSchema,
  type ErrorEnvelope,
} from '@poolmaster/shared/dto';
import { ingestionModule } from '../../../packages/core-api/src/modules/ingestion/routes';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import { authGuard } from '../../../packages/core-api/src/plugins/auth-guard';
import type { IngestionService } from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import type { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import type { ProviderSettingsService } from '../../../packages/core-api/src/modules/ingestion/provider-settings-service';
import { SyncRequestValidationError } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';

const EVENT_ID = '00000000-0000-4000-8000-0000000000e1';
const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';
process.env.JWT_SECRET = JWT_SECRET;

/**
 * #213 (access rule A10) — root-admin authority is a signed claim, so the token carries it. It
 * used to come from a mocked `user.findUnique` row while the token said nothing, which is the
 * arrangement the rule replaced.
 */
function authHeaders(userId: string, isRootAdmin: boolean): Record<string, string> {
  const token = jwt.sign(
    { sub: userId, email: `${userId}@example.test`, isRootAdmin },
    JWT_SECRET,
    { expiresIn: '15m' },
  );

  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function createIngestionServiceMock() {
  return {
    syncSportEvent: jest.fn().mockResolvedValue({
      sport: 'GOLF',
      eventId: EVENT_ID,
      requestedKinds: ['SCORES'],
      submittedAt: new Date('2026-05-30T00:00:00.000Z'),
      syncRuns: [],
    }),
  };
}

async function buildIngestionSyncApp() {
  const app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });
  const providerService = createIngestionServiceMock();
  const providerSettings = { updateProvider: jest.fn(), updateLeague: jest.fn() };
  // No `user.findUnique` stub: authorization reads the token claim and never the row (A10).
  // The decoration stays because the module expects the instance to carry a Prisma client.
  const prisma = {} as unknown as PrismaClient;

  app.decorate('prisma', prisma);
  app.setErrorHandler(globalErrorHandler);
  // Registered as the app registers it: the module's `requireRootAdmin` hook runs at
  // onRequest, and the auth guard's preHandler sets the user the handlers read.
  await app.register(authGuard);
  await app.register(ingestionModule, {
    prefix: '/api/v1/ingestion',
    ingestionService: providerService as unknown as IngestionService,
    providerRegistry: {} as unknown as ProviderRegistry,
    leagueEventsSync: { syncNow: jest.fn() },
    activity: { present: jest.fn() },
    providerSettings: providerSettings as unknown as ProviderSettingsService,
  });
  await app.ready();

  return { app, providerService, providerSettings };
}

describe('pool-master-rop.68.4.1 ingestion sync route authorization', () => {
  it('#126: there is no sport-level sync route — a root admin submitting one gets 404 and no sync runs', async () => {
    const { app, providerService } = await buildIngestionSyncApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/sports/GOLF/sync',
      headers: authHeaders('root-admin-user', true),
      payload: {
        kinds: ['EVENTSCHEDULE'],
      },
    });

    expect(res.statusCode).toBe(404);
    expect(providerService.syncSportEvent).not.toHaveBeenCalled();

    await app.close();
  });

  it('pool-master-rop.68.4.1 refuses a member\'s event sync with 403 ROOT_ADMIN_ACCESS_REQUIRED before it is submitted', async () => {
    const { app, providerService } = await buildIngestionSyncApp();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/ingestion/events/${EVENT_ID}/sync`,
      headers: authHeaders('member-user', false),
      payload: { kinds: ['SCORES'] },
    });

    expect(res.statusCode).toBe(403);
    expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
    expect(res.json<ErrorEnvelope>().error.code).toBe('ROOT_ADMIN_ACCESS_REQUIRED');
    expect(providerService.syncSportEvent).not.toHaveBeenCalled();

    await app.close();
  });

  it('pool-master-rop.68.4.1 accepts a root admin\'s event sync by the event\'s own id with 202 and submits it as that admin', async () => {
    const { app, providerService } = await buildIngestionSyncApp();

    const eventRes = await app.inject({
      method: 'POST',
      url: `/api/v1/ingestion/events/${EVENT_ID}/sync`,
      headers: authHeaders('root-admin-user', true),
      payload: { kinds: ['SCORES'] },
    });
    expect(eventRes.statusCode).toBe(202);
    expect(ProviderManualSyncSubmissionResponseSchema.safeParse(eventRes.json()).success).toBe(true);
    expect(providerService.syncSportEvent).toHaveBeenCalledWith(EVENT_ID, ['SCORES'], 'root-admin-user', 'root-admin-user@example.test');

    await app.close();
  });

  it('refuses with 400 an event sync whose event id is not a uuid, before any sync is submitted', async () => {
    const { app, providerService } = await buildIngestionSyncApp();

    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/events/event-1/sync',
      headers: authHeaders('root-admin-user', true),
      payload: { kinds: ['SCORES'] },
    });

    expect(eventRes.statusCode).toBe(400);
    expect(providerService.syncSportEvent).not.toHaveBeenCalled();

    await app.close();
  });

  it('pool-master-rop.68.2.3 maps sync request validation errors to 422 responses', async () => {
    const { app, providerService } = await buildIngestionSyncApp();
    providerService.syncSportEvent.mockRejectedValueOnce(
      new SyncRequestValidationError('INVALID_EVENT_ID', 'Event-scoped sync requests require a non-empty provider event ID.'),
    );

    const eventRes = await app.inject({
      method: 'POST',
      url: `/api/v1/ingestion/events/${EVENT_ID}/sync`,
      headers: authHeaders('root-admin-user', true),
      payload: { kinds: ['SCORES'] },
    });
    expect(eventRes.statusCode).toBe(422);
    expect(eventRes.json<ErrorEnvelope>().error).toEqual({
      code: 'SYNC_REQUEST_INVALID',
      message: 'Event-scoped sync requests require a non-empty provider event ID.',
      details: { validationCode: 'INVALID_EVENT_ID' },
    });

    await app.close();
  });

  it('refuses a member\'s provider settings and provider league saves with 403 before either is saved (#1997)', async () => {
    const { app, providerSettings } = await buildIngestionSyncApp();

    const provider = await app.inject({ method: 'PATCH', url: '/api/v1/ingestion/provider-settings/00000000-0000-4000-8000-000000000001', headers: authHeaders('member-user', false), payload: { requestsPerMinute: 600 } });
    const league = await app.inject({ method: 'PATCH', url: '/api/v1/ingestion/provider-settings/00000000-0000-4000-8000-000000000001/leagues/00000000-0000-4000-8000-000000000002', headers: authHeaders('member-user', false), payload: { typicalGameMinutes: 200 } });

    expect([provider.statusCode, league.statusCode]).toEqual([403, 403]);
    expect(providerSettings.updateProvider).not.toHaveBeenCalled();
    expect(providerSettings.updateLeague).not.toHaveBeenCalled();

    await app.close();
  });

  it('refuses with 400 a provider rate outside the range a provider may be set to, before it is saved', async () => {
    const { app, providerSettings } = await buildIngestionSyncApp();

    const res = await app.inject({ method: 'PATCH', url: '/api/v1/ingestion/provider-settings/00000000-0000-4000-8000-000000000001', headers: authHeaders('root-admin-user', true), payload: { requestsPerMinute: 0 } });

    expect(res.statusCode).toBe(400);
    expect(providerSettings.updateProvider).not.toHaveBeenCalled();

    await app.close();
  });
});
