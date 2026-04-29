import type { FastifyReply, FastifyRequest } from 'fastify';
import { createAccountHandlers } from '../../../packages/core-api/src/modules/account/handler';

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

describe('account handlers', () => {
  const accountService = {
    reactivateOwnAccount: jest.fn(),
    updateOwnProfile: jest.fn(),
    updateOwnUsername: jest.fn(),
    updateOwnPreferences: jest.fn(),
    changeOwnPassword: jest.fn(),
    inactivateOwnAccount: jest.fn(),
    deleteOwnInactiveAccount: jest.fn(),
  } as any;
  const authService = {
    issueSessionForUser: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['reactivate', () => ({})],
    ['updateProfile', () => ({ body: { email: 'updated@example.com', firstName: 'Updated', lastName: 'User' } })],
    ['updateUsername', () => ({ body: { username: 'updated-user' } })],
    ['updatePreferences', () => ({ body: { timezone: 'America/New_York' } })],
    ['changePassword', () => ({ body: { currentPassword: 'CurrentPass123!', newPassword: 'NewPass456!', confirmNewPassword: 'NewPass456!' }, headers: {} })],
    ['inactivate', () => ({})],
    ['deleteAccount', () => ({ body: { email: 'user@example.com' } })],
  ] as const)('returns AUTH_SESSION_REQUIRED when %s is called without an authenticated user', async (handlerName, requestFactory) => {
    const handlers = createAccountHandlers(accountService, authService);
    const reply = createReply();
    const logger = createLogger();
    const request = {
      contextLogger: logger,
      log: logger,
      ...requestFactory(),
    } as unknown as FastifyRequest;

    await handlers[handlerName](request as never, reply);

    expect((reply.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect((reply.send as jest.Mock).mock.calls[0][0]).toEqual({
      error: {
        code: 'AUTH_SESSION_REQUIRED',
        message: 'Authenticated session required',
      },
    });
  });
});
