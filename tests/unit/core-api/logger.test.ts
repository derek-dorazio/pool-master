import { expect } from '@jest/globals';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  buildRequestLogBindings,
  createFastifyLoggerOptions,
} from '../../../packages/core-api/src/core/logger';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import { LeagueNotFoundError } from '../../../packages/core-api/src/modules/leagues/service';

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
      // A domain not-found error declares its own code and 404; the handler reads them as given.
      const missingLeagueError = new LeagueNotFoundError('missing');

      globalErrorHandler(missingLeagueError, request, reply);

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
      expect(reply.status).toHaveBeenNthCalledWith(1, 404);
    });

    it('logs unexpected 5xx paths at error', () => {
      const warn = jest.fn();
      const error = jest.fn();
      const request = {
        id: 'req-error',
        method: 'POST',
        url: '/api/v1/ingestion/sports/GOLF/events/event-1/sync',
        ip: '127.0.0.1',
        routeOptions: { url: '/api/v1/ingestion/sports/:sport/events/:eventId/sync' },
        contextLogger: { warn, error },
        log: { warn: jest.fn(), error: jest.fn() },
      } as unknown as FastifyRequest;
      const reply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as FastifyReply;
      const unexpectedError = new Error('Provider timed out');

      globalErrorHandler(unexpectedError, request, reply);

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
      expect(reply.status).toHaveBeenNthCalledWith(1, 500);
    });
  });
});
