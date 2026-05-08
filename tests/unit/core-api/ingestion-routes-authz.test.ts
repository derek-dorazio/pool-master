import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { ErrorEnvelopeSchema, IngestionJobsResponseSchema } from '@poolmaster/shared/dto';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import { ingestionModule } from '../../../packages/core-api/src/modules/ingestion/routes';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import type { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { OddsApiAdapter } from '../../../packages/core-api/src/modules/ingestion/adapters/odds-api-adapter';

const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';
// pool-master-rop.76.1 — set BEFORE the auth-guard plugin registers in
// buildRouteApp(); the bootstrap throws if JWT_SECRET is unset.
process.env.JWT_SECRET = JWT_SECRET;

function authHeaders(userId: string, email: string): Record<string, string> {
  const token = jwt.sign({ sub: userId, email }, JWT_SECRET, { expiresIn: '15m' });

  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function createScheduler() {
  return {
    runSportSync: jest.fn().mockResolvedValue([{
      jobType: 'EVENT_SCHEDULE_SYNC',
      providerId: 'contract-provider',
      sport: 'GOLF',
      status: 'COMPLETED',
      startedAt: new Date('2026-04-09T10:00:00.000Z'),
      completedAt: new Date('2026-04-09T10:00:01.000Z'),
      recordsProcessed: 2,
      errors: 0,
      errorLog: [],
    }]),
  };
}

async function buildRouteApp(isRootAdmin: boolean) {
  const app = Fastify({ logger: false });
  const scheduler = createScheduler();
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: isRootAdmin ? 'root-admin-user' : 'member-user',
        email: isRootAdmin ? 'root@example.test' : 'member@example.test',
        firstName: isRootAdmin ? 'Root' : 'Member',
        lastName: 'User',
        isRootAdmin,
      }),
    },
  } as unknown as PrismaClient;

  app.decorate('prisma', prisma);
  app.setErrorHandler(globalErrorHandler);

  await app.register(ingestionModule, {
    prefix: '/api/v1/ingestion',
    registry: new ProviderRegistry(),
    scheduler: scheduler as unknown as IngestionScheduler,
    oddsAdapter: {
      getOdds: jest.fn().mockResolvedValue([]),
    } as unknown as OddsApiAdapter,
  });
  await app.ready();

  return { app, scheduler };
}

describe('pool-master-rop.2: ingestion mutating route authorization', () => {
  it('pool-master-rop.2: rejects authenticated non-root users before mutating ingestion', async () => {
    const { app, scheduler } = await buildRouteApp(false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/sync/GOLF',
      headers: authHeaders('member-user', 'member@example.test'),
      payload: {
        feeds: ['EVENTSCHEDULE'],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
    expect(res.json().error.code).toBe('ROOT_ADMIN_ACCESS_REQUIRED');
    expect(scheduler.runSportSync).not.toHaveBeenCalled();

    await app.close();
  });

  it('pool-master-rop.2: allows root-admin users to trigger mutating ingestion', async () => {
    const { app, scheduler } = await buildRouteApp(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingestion/sync/GOLF',
      headers: authHeaders('root-admin-user', 'root@example.test'),
      payload: {
        feeds: ['EVENTSCHEDULE'],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(IngestionJobsResponseSchema.safeParse(res.json()).success).toBe(true);
    expect(scheduler.runSportSync).toHaveBeenCalledWith({
      sport: 'GOLF',
      feeds: ['EVENTSCHEDULE'],
      from: undefined,
      to: undefined,
    });

    await app.close();
  });
});
