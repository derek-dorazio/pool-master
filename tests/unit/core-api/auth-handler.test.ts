import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthError } from '../../../packages/core-api/src/modules/auth/auth-service';
import { createAuthHandlers } from '../../../packages/core-api/src/modules/auth/handler';

function createReply(): FastifyReply {
  return {
    header: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as FastifyReply;
}

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe('auth handlers', () => {
  it('returns INVALID_REFRESH_TOKEN when refresh is requested without a body or cookie token', async () => {
    const authService = {
      refresh: jest.fn(),
    } as any;

    const handlers = createAuthHandlers(authService);
    const reply = createReply();
    const logger = createLogger();
    const request = {
      body: {},
      headers: {},
      contextLogger: logger,
      log: logger,
    } as unknown as FastifyRequest;

    await handlers.refresh(request as never, reply);

    expect(authService.refresh).not.toHaveBeenCalled();
    expect((reply.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect((reply.send as jest.Mock).mock.calls[0][0]).toEqual({
      error: {
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Missing refresh token',
      },
    });
  });

  it('treats logout without a refresh token as a successful no-op', async () => {
    const authService = {
      logout: jest.fn(),
    } as any;

    const handlers = createAuthHandlers(authService);
    const reply = createReply();
    const logger = createLogger();
    const request = {
      body: {},
      headers: {},
      contextLogger: logger,
      log: logger,
    } as unknown as FastifyRequest;

    await handlers.logout(request as never, reply);

    expect(authService.logout).not.toHaveBeenCalled();
    expect(reply.header).toHaveBeenCalledWith('Set-Cookie', expect.any(Array));
    expect(reply.send).toHaveBeenCalledWith({ success: true });
  });

  it('returns AUTH_SESSION_REQUIRED when /me is called without an authenticated user', async () => {
    const authService = {
      getProfile: jest.fn(),
    } as any;

    const handlers = createAuthHandlers(authService);
    const reply = createReply();
    const logger = createLogger();
    const request = {
      contextLogger: logger,
      log: logger,
    } as unknown as FastifyRequest;

    await handlers.me(request, reply);

    expect(authService.getProfile).not.toHaveBeenCalled();
    expect((reply.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect((reply.send as jest.Mock).mock.calls[0][0]).toEqual({
      error: {
        code: 'AUTH_SESSION_REQUIRED',
        message: 'Authenticated session required',
      },
    });
  });

  it('maps AuthError branches from login into the standard error envelope', async () => {
    const authService = {
      login: jest.fn().mockRejectedValue(new AuthError('Invalid username, email, or password', 'INVALID_CREDENTIALS')),
    } as any;

    const handlers = createAuthHandlers(authService);
    const reply = createReply();
    const logger = createLogger();
    const request = {
      body: {
        identifier: 'user@example.com',
        password: 'WrongPass123!',
      },
      contextLogger: logger,
      log: logger,
    } as unknown as FastifyRequest;

    await handlers.login(request as never, reply);

    expect((reply.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect((reply.send as jest.Mock).mock.calls[0][0]).toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username, email, or password',
      },
    });
  });
});
