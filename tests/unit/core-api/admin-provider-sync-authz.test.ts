import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { ErrorEnvelopeSchema, ProviderManualSyncSubmissionResponseSchema } from '@poolmaster/shared/dto';
import { adminModule } from '../../../packages/core-api/src/modules/admin/routes';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import type { ProviderService } from '../../../packages/core-api/src/modules/admin/provider-service';
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

function createProviderServiceMock() {
  return {
    prepareSportSync: jest.fn().mockResolvedValue({
      sport: 'GOLF',
      eventId: null,
      requestedFeeds: ['EVENTSCHEDULE'],
      submittedAt: new Date('2026-05-30T00:00:00.000Z'),
      syncRuns: [],
    }),
    syncEventData: jest.fn().mockResolvedValue({
      sport: 'GOLF',
      eventId: 'event-1',
      requestedFeeds: ['EVENTLIVESCORES'],
      submittedAt: new Date('2026-05-30T00:00:00.000Z'),
      syncRuns: [],
    }),
  };
}

async function buildAdminSyncApp() {
  const app = Fastify({ logger: false });
  const providerService = createProviderServiceMock();
  // No `user.findUnique` stub: authorization reads the token claim and never the row (A10).
  // The decoration stays because the module expects the instance to carry a Prisma client.
  const prisma = {} as unknown as PrismaClient;

  app.decorate('prisma', prisma);
  app.setErrorHandler(globalErrorHandler);
  await app.register(adminModule, {
    prefix: '/api/v1/admin',
    providerService: providerService as unknown as ProviderService,
  });
  await app.ready();

  return { app, providerService };
}

describe('pool-master-rop.68.4.1 retained admin provider sync route authorization', () => {
  it('pool-master-rop.68.4.1 rejects non-root users before sport sync submission', async () => {
    const { app, providerService } = await buildAdminSyncApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/providers/sync/GOLF',
      headers: authHeaders('member-user', false),
      payload: {
        feeds: ['EVENTSCHEDULE'],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
    expect(res.json().error.code).toBe('ROOT_ADMIN_ACCESS_REQUIRED');
    expect(providerService.prepareSportSync).not.toHaveBeenCalled();

    await app.close();
  });

  it('pool-master-rop.68.4.1 rejects non-root users before event sync submission', async () => {
    const { app, providerService } = await buildAdminSyncApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/providers/events/GOLF/event-1/sync',
      headers: authHeaders('member-user', false),
      payload: {
        feeds: ['EVENTLIVESCORES'],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
    expect(res.json().error.code).toBe('ROOT_ADMIN_ACCESS_REQUIRED');
    expect(providerService.syncEventData).not.toHaveBeenCalled();

    await app.close();
  });

  it('pool-master-rop.68.4.1 allows root admins to submit the retained sync endpoints', async () => {
    const { app, providerService } = await buildAdminSyncApp();

    const sportRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/providers/sync/GOLF',
      headers: authHeaders('root-admin-user', true),
      payload: {
        feeds: ['EVENTSCHEDULE'],
      },
    });
    expect(sportRes.statusCode).toBe(202);
    expect(ProviderManualSyncSubmissionResponseSchema.safeParse(sportRes.json()).success).toBe(true);
    expect(providerService.prepareSportSync).toHaveBeenCalledWith({
      sport: 'GOLF',
      feeds: ['EVENTSCHEDULE'],
    }, 'root-admin-user', 'root-admin-user@example.test');

    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/providers/events/GOLF/event-1/sync',
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
    const { app, providerService } = await buildAdminSyncApp();
    providerService.prepareSportSync.mockRejectedValueOnce(
      new SyncRequestValidationError('INVALID_SYNC_WINDOW', 'Sync request window end must be greater than or equal to its start.'),
    );
    providerService.syncEventData.mockRejectedValueOnce(
      new SyncRequestValidationError('INVALID_EVENT_ID', 'Event-scoped sync requests require a non-empty provider event ID.'),
    );

    const sportRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/providers/sync/GOLF',
      headers: authHeaders('root-admin-user', true),
      payload: {
        feeds: ['EVENTSCHEDULE'],
        from: '2026-06-15T00:00:00.000Z',
        to: '2026-06-01T00:00:00.000Z',
      },
    });
    expect(sportRes.statusCode).toBe(422);
    expect(sportRes.json().error).toEqual({
      code: 'SYNC_REQUEST_INVALID',
      message: 'Sync request window end must be greater than or equal to its start.',
      details: { validationCode: 'INVALID_SYNC_WINDOW' },
    });

    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/providers/events/GOLF/event-1/sync',
      headers: authHeaders('root-admin-user', true),
      payload: {
        feeds: ['EVENTLIVESCORES'],
      },
    });
    expect(eventRes.statusCode).toBe(422);
    expect(eventRes.json().error).toEqual({
      code: 'SYNC_REQUEST_INVALID',
      message: 'Event-scoped sync requests require a non-empty provider event ID.',
      details: { validationCode: 'INVALID_EVENT_ID' },
    });

    await app.close();
  });
});
