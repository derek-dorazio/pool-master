import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { authGuard } from '../../../packages/core-api/src/plugins/auth-guard';
import { requestLoggingContext } from '../../../packages/core-api/src/plugins/request-logging-context';
import {
  ClientLogBatchTooLargeError,
  ClientLogRateLimitError,
  ClientLogService,
} from '../../../packages/core-api/src/modules/client-logs/service';
import { createClientLogHandlers } from '../../../packages/core-api/src/modules/client-logs/handler';

// pool-master-rop.76.1 — auth-guard registers in one of the test cases
// below; the bootstrap throws if JWT_SECRET is unset.
process.env.JWT_SECRET = 'poolmaster-dev-secret-change-in-production';

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
      sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
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
          clientSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          clientUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
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
        sessionId: null,
        userId: null,
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
      sessionId: null,
      userId: null,
      batch,
    });

    expect(() =>
      service.ingestBatch({
        ip: '127.0.0.1',
        requestLogger: logger as any,
        sessionId: null,
        userId: null,
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

  // #206 — the planted violation. Before this change the service read identity out of
  // the batch body, so a caller could attribute log lines to any session or user. The
  // body below deliberately claims someone else's identity; the emitted log line must
  // carry the JWT's values and ignore the body entirely.
  it('stamps log lines with the JWT identity, not the identity the batch claims', async () => {
    const logger = createLogger();
    const service = new ClientLogService({ logger: logger as any });
    const handler = createClientLogHandlers(service);

    const app = Fastify({ logger: false });
    app.register(authGuard);
    app.register(requestLoggingContext);
    // The service re-emits each entry through the request-scoped logger, so that is
    // what has to be captured here — not the service's own construction logger.
    app.addHook('preHandler', async (request) => {
      request.contextLogger = logger as any;
    });
    // Registered without a body schema on purpose, so the forged fields survive
    // validation and reach the handler. This asserts the handler ignores them, not
    // that the schema strips them.
    app.post('/api/v1/client-logs', handler.ingest);

    await app.ready();

    const accessToken = jwt.sign(
      {
        sub: 'a0000000-0000-4000-8000-000000000001',
        email: 'member@example.com',
        sid: 'b0000000-0000-4000-8000-000000000002',
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
      payload: {
        schemaVersion: 1,
        clientTraceId: 'trace-forged',
        webappVersion: '1.2.3',
        userAgent: 'vitest',
        entries: [
          {
            level: 'error',
            action: 'forged.attribution',
            ts: '2026-04-22T16:00:00.000Z',
            sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            userId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(204);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'forged.attribution',
        data: expect.objectContaining({
          clientSessionId: 'b0000000-0000-4000-8000-000000000002',
          clientUserId: 'a0000000-0000-4000-8000-000000000001',
        }),
      }),
      expect.any(String),
    );

    await app.close();
  });

  it('leaves identity null for an anonymous caller', async () => {
    const logger = createLogger();
    const service = new ClientLogService({ logger: logger as any });
    const handler = createClientLogHandlers(service);

    const app = Fastify({ logger: false });
    app.register(authGuard);
    app.register(requestLoggingContext);
    app.addHook('preHandler', async (request) => {
      request.contextLogger = logger as any;
    });
    app.post('/api/v1/client-logs', handler.ingest);

    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/client-logs',
      payload: {
        schemaVersion: 1,
        clientTraceId: 'trace-anon',
        webappVersion: '1.2.3',
        userAgent: 'vitest',
        entries: [
          {
            level: 'error',
            action: 'anonymous.failure',
            ts: '2026-04-22T16:00:00.000Z',
            sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            userId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(204);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientSessionId: null,
          clientUserId: null,
        }),
      }),
      expect.any(String),
    );

    await app.close();
  });
});
