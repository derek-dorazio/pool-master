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
import { SyncRequestValidationError } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';

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
    syncEventData: jest.fn().mockResolvedValue({
      sport: 'GOLF',
      eventId: 'event-1',
      requestedFeeds: ['EVENTLIVESCORES'],
      submittedAt: new Date('2026-05-30T00:00:00.000Z'),
      syncRuns: [],
    }),
  };
}

async function buildIngestionSyncApp() {
  const app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });
  const providerService = createIngestionServiceMock();
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
  });
  await app.ready();

  return { app, providerService };
}

describe('pool-master-rop.68.4.1 ingestion sync route authorization', () => {
  it('#126: there is no sport-level sync route — a root admin submitting one gets 404 and no sync runs', async () => {
    const { app, providerService } = await buildIngestionSyncApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/sports/GOLF/sync',
      headers: authHeaders('root-admin-user', true),
      payload: {
        feeds: ['EVENTSCHEDULE'],
      },
    });

    expect(res.statusCode).toBe(404);
    expect(providerService.syncEventData).not.toHaveBeenCalled();

    await app.close();
  });

  it('pool-master-rop.68.4.1 rejects non-root users before event sync submission', async () => {
    const { app, providerService } = await buildIngestionSyncApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/sports/GOLF/events/event-1/sync',
      headers: authHeaders('member-user', false),
      payload: {
        feeds: ['EVENTLIVESCORES'],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
    expect(res.json<ErrorEnvelope>().error.code).toBe('ROOT_ADMIN_ACCESS_REQUIRED');
    expect(providerService.syncEventData).not.toHaveBeenCalled();

    await app.close();
  });

  it('pool-master-rop.68.4.1 allows root admins to submit event syncs', async () => {
    const { app, providerService } = await buildIngestionSyncApp();

    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/sports/GOLF/events/event-1/sync',
      headers: authHeaders('root-admin-user', true),
      payload: {
        feeds: ['EVENTLIVESCORES'],
      },
    });
    expect(eventRes.statusCode).toBe(202);
    expect(ProviderManualSyncSubmissionResponseSchema.safeParse(eventRes.json()).success).toBe(true);
    expect(providerService.syncEventData).toHaveBeenCalledWith({
      sport: 'GOLF',
      eventId: 'event-1',
      feeds: ['EVENTLIVESCORES'],
    }, 'root-admin-user', 'root-admin-user@example.test');

    await app.close();
  });

  it('pool-master-rop.68.2.3 maps sync request validation errors to 422 responses', async () => {
    const { app, providerService } = await buildIngestionSyncApp();
    providerService.syncEventData.mockRejectedValueOnce(
      new SyncRequestValidationError('INVALID_EVENT_ID', 'Event-scoped sync requests require a non-empty provider event ID.'),
    );

    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/sports/GOLF/events/event-1/sync',
      headers: authHeaders('root-admin-user', true),
      payload: {
        feeds: ['EVENTLIVESCORES'],
      },
    });
    expect(eventRes.statusCode).toBe(422);
    expect(eventRes.json<ErrorEnvelope>().error).toEqual({
      code: 'SYNC_REQUEST_INVALID',
      message: 'Event-scoped sync requests require a non-empty provider event ID.',
      details: { validationCode: 'INVALID_EVENT_ID' },
    });

    await app.close();
  });
});
