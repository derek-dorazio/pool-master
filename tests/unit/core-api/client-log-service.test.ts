import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { authGuard } from '../../../packages/core-api/src/plugins/auth-guard';
import { requestLoggingContext } from '../../../packages/core-api/src/plugins/request-logging-context';
import {
  ClientLogBatchTooLargeError,
  ClientLogRateLimitError,
  ClientLogService,
} from '../../../packages/core-api/src/modules/client-logs/service';

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
}

describe('client log service', () => {
  it('re-emits client log entries at their original levels', () => {
    const logger = createLogger();
    const service = new ClientLogService({ logger: logger as any });

    service.ingestBatch({
      ip: '127.0.0.1',
      requestLogger: logger as any,
      batch: {
        schemaVersion: 1,
        clientTraceId: 'trace-123',
        webappVersion: '1.2.3',
        userAgent: 'vitest',
        entries: [
          {
            level: 'warn',
            action: 'league.load.empty',
            msg: 'League list empty',
            ts: '2026-04-22T16:00:00.000Z',
            route: '/my-leagues',
            sessionId: null,
            userId: null,
            clientRequestId: '11111111-1111-4111-8111-111111111111',
            data: {
              page: 'my-leagues',
            },
          },
          {
            level: 'error',
            action: 'contest.create.failed',
            ts: '2026-04-22T16:00:01.000Z',
            clientRequestId: null,
            sessionId: '22222222-2222-4222-8222-222222222222',
            userId: '33333333-3333-4333-8333-333333333333',
            err: {
              message: 'boom',
            },
          },
        ],
      },
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'league.load.empty',
        data: expect.objectContaining({
          source: 'client',
          clientTraceId: 'trace-123',
          clientRequestId: '11111111-1111-4111-8111-111111111111',
          clientRoute: '/my-leagues',
          webappVersion: '1.2.3',
        }),
      }),
      'League list empty',
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contest.create.failed',
        err: {
          message: 'boom',
        },
        data: expect.objectContaining({
          source: 'client',
          clientSessionId: '22222222-2222-4222-8222-222222222222',
          clientUserId: '33333333-3333-4333-8333-333333333333',
        }),
      }),
      'Client log entry',
    );
  });

  it('rejects oversized batches', () => {
    const logger = createLogger();
    const service = new ClientLogService({
      logger: logger as any,
      maxBatchBytes: 64,
    });

    expect(() =>
      service.ingestBatch({
        ip: '127.0.0.1',
        requestLogger: logger as any,
        batch: {
          schemaVersion: 1,
          clientTraceId: 'trace-123',
          webappVersion: '1.2.3',
          userAgent: 'vitest',
          entries: [
            {
              level: 'info',
              action: 'app.loaded',
              ts: '2026-04-22T16:00:00.000Z',
              data: {
                large: 'x'.repeat(200),
              },
            },
          ],
        },
      }),
    ).toThrow(ClientLogBatchTooLargeError);
  });

  it('rate limits repeated batches from the same ip', () => {
    const logger = createLogger();
    const service = new ClientLogService({
      logger: logger as any,
      rateLimitPerMinute: 1,
      now: (() => {
        let current = 1_000;
        return () => current++;
      })(),
    });
    const batch = {
      schemaVersion: 1 as const,
      clientTraceId: 'trace-123',
      webappVersion: '1.2.3',
      userAgent: 'vitest',
      entries: [
        {
          level: 'info' as const,
          action: 'app.loaded',
          ts: '2026-04-22T16:00:00.000Z',
        },
      ],
    };

    service.ingestBatch({
      ip: '127.0.0.1',
      requestLogger: logger as any,
      batch,
    });

    expect(() =>
      service.ingestBatch({
        ip: '127.0.0.1',
        requestLogger: logger as any,
        batch,
      }),
    ).toThrow(ClientLogRateLimitError);
  });
});

describe('auth guard optional auth binding for client logs', () => {
  it('binds authUser on the public client-logs route when a valid cookie is present', async () => {
    const app = Fastify({ logger: false });

    app.register(authGuard);
    app.register(requestLoggingContext);
    app.post('/api/v1/client-logs', async (request) => ({
      authUser: request.authUser ?? null,
      contextBindings: request.contextLogger ? 'present' : 'missing',
    }));

    await app.ready();

    const accessToken = jwt.sign(
      {
        sub: '44444444-4444-4444-8444-444444444444',
        email: 'member@example.com',
        sid: '55555555-5555-4555-8555-555555555555',
      },
      'poolmaster-dev-secret-change-in-production',
      { expiresIn: '15m' },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/client-logs',
      headers: {
        cookie: `poolmaster_access=${encodeURIComponent(accessToken)}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authUser: {
        userId: '44444444-4444-4444-8444-444444444444',
        email: 'member@example.com',
        isRootAdmin: false,
        sessionId: '55555555-5555-4555-8555-555555555555',
      },
      contextBindings: 'present',
    });

    await app.close();
  });
});
