import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';
import { createAuthHandlers } from '../../../packages/core-api/src/modules/auth/handler';
import { fakeLogger } from '../../support/fake-logger';
import { stubInstance } from '../../support/stub-instance';

function createReply(): FastifyReply {
  return {
    header: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as FastifyReply;
}

describe('auth handlers', () => {
  it('returns INVALID_REFRESH_TOKEN when refresh is requested without a body or cookie token', async () => {
    const authService = stubInstance(AuthService, {
      refresh: jest.fn(),
    });

    const handlers = createAuthHandlers(authService);
    const reply = createReply();
    const logger = fakeLogger();
    const request = {
      body: {},
      headers: {},
      contextLogger: logger,
      log: logger,
    } as unknown as FastifyRequest;

    await handlers.refresh(request as never, reply);

    expect(authService.refresh).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenNthCalledWith(1, 401);
    expect(reply.send).toHaveBeenNthCalledWith(1, {
      error: {
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Missing refresh token',
      },
    });
  });

  it('treats logout without a refresh token as a successful no-op', async () => {
    const authService = stubInstance(AuthService, {
      logout: jest.fn(),
    });

    const handlers = createAuthHandlers(authService);
    const reply = createReply();
    const logger = fakeLogger();
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


  it('maps AuthError branches from login into the standard error envelope', async () => {
    const authService = stubInstance(AuthService, {
      login: jest.fn().mockRejectedValue(new AuthError('Invalid username, email, or password', 'INVALID_CREDENTIALS')),
    });

    const handlers = createAuthHandlers(authService);
    const reply = createReply();
    const logger = fakeLogger();
    const request = {
      body: {
        identifier: 'user@example.com',
        password: 'WrongPass123!',
      },
      contextLogger: logger,
      log: logger,
    } as unknown as FastifyRequest;

    await handlers.login(request as never, reply);

    expect(reply.status).toHaveBeenNthCalledWith(1, 401);
    expect(reply.send).toHaveBeenNthCalledWith(1, {
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username, email, or password',
      },
    });
  });
});
