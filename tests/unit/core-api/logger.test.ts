import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  buildRequestLogBindings,
  createFastifyLoggerOptions,
} from '../../../packages/core-api/src/core/logger';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';

describe('core-api logging foundation', () => {
  describe('createFastifyLoggerOptions', () => {
    it('creates structured logger config with service metadata and redaction', () => {
      const loggerOptions = createFastifyLoggerOptions('core-api') as Record<string, unknown>;

      expect(loggerOptions.level).toBeDefined();
      expect(loggerOptions.base).toEqual(
        expect.objectContaining({
          service: 'core-api',
          env: expect.any(String),
        }),
      );
      expect(loggerOptions.redact).toEqual(
        expect.objectContaining({
          paths: expect.arrayContaining([
            'req.headers.authorization',
            'req.headers.cookie',
            'accessToken',
            'refreshToken',
            'password',
            'passwordHash',
          ]),
          censor: '[REDACTED]',
        }),
      );
    });
  });

  describe('buildRequestLogBindings', () => {
    it('includes authenticated request context when a member session is present', () => {
      const request = {
        id: 'req-123',
        method: 'POST',
        url: '/api/v1/leagues/league-1/contests?draft=true',
        ip: '127.0.0.1',
        headers: {
          'x-client-trace-id': 'trace-123',
          'x-client-request-id': 'client-request-123',
        },
        routeOptions: { url: '/api/v1/leagues/:id/contests' },
        authUser: {
          userId: 'user-123',
          email: 'member@example.com',
          isRootAdmin: false,
          sessionId: 'session-123',
        },
      } as unknown as FastifyRequest;

      expect(buildRequestLogBindings(request)).toEqual({
        reqId: 'req-123',
        sessionId: 'session-123',
        userId: 'user-123',
        isRootAdmin: false,
        clientTraceId: 'trace-123',
        clientRequestId: 'client-request-123',
        ip: '127.0.0.1',
        method: 'POST',
        route: '/api/v1/leagues/:id/contests',
      });
    });

    it('falls back to root-admin context when auth user is not present', () => {
      const request = {
        id: 'req-admin',
        method: 'POST',
        url: '/api/v1/admin/providers/sync/GOLF',
        ip: '10.0.0.10',
        headers: {},
        routeOptions: { url: '/api/v1/admin/providers/sync/:sport' },
        rootAdminContext: {
          rootAdminUser: {
            id: 'admin-1',
            email: 'admin@example.com',
            name: 'Admin User',
            isRootAdmin: true,
          },
        },
      } as unknown as FastifyRequest;

      expect(buildRequestLogBindings(request)).toEqual({
        reqId: 'req-admin',
        sessionId: null,
        userId: 'admin-1',
        isRootAdmin: true,
        clientTraceId: null,
        clientRequestId: null,
        ip: '10.0.0.10',
        method: 'POST',
        route: '/api/v1/admin/providers/sync/:sport',
      });
    });
  });

  describe('globalErrorHandler', () => {
    it('logs expected 4xx paths at warn', () => {
      const warn = jest.fn();
      const error = jest.fn();
      const request = {
        id: 'req-warn',
        method: 'GET',
        url: '/api/v1/leagues/missing',
        ip: '127.0.0.1',
        routeOptions: { url: '/api/v1/leagues/:id' },
        log: { warn, error },
      } as unknown as FastifyRequest;
      const reply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as FastifyReply;
      const missingLeagueError = Object.assign(new Error('League not found'), {
        name: 'LeagueNotFoundError',
      });

      globalErrorHandler(missingLeagueError as any, request, reply);

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'http.request.failed.expected',
          statusCode: 404,
          errorCode: 'LEAGUE_NOT_FOUND',
          err: missingLeagueError,
        }),
        'Request completed with expected error',
      );
      expect(error).not.toHaveBeenCalled();
      expect((reply.status as jest.Mock).mock.calls[0][0]).toBe(404);
    });

    it('logs unexpected 5xx paths at error', () => {
      const warn = jest.fn();
      const error = jest.fn();
      const request = {
        id: 'req-error',
        method: 'POST',
        url: '/api/v1/admin/providers/sync/GOLF',
        ip: '127.0.0.1',
        routeOptions: { url: '/api/v1/admin/providers/sync/:sport' },
        contextLogger: { warn, error },
        log: { warn: jest.fn(), error: jest.fn() },
      } as unknown as FastifyRequest;
      const reply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as FastifyReply;
      const unexpectedError = new Error('Provider timed out');

      globalErrorHandler(unexpectedError as any, request, reply);

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'http.request.failed.unexpected',
          statusCode: 500,
          errorCode: 'INTERNAL_ERROR',
          err: unexpectedError,
        }),
        'Unhandled request error',
      );
      expect(warn).not.toHaveBeenCalled();
      expect((reply.status as jest.Mock).mock.calls[0][0]).toBe(500);
    });
  });
});
