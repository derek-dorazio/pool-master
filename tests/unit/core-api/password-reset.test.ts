/**
 * #847 — the parts of password recovery that need no database: the per-address limits, the
 * reply-before-lookup order of the request handler, the reset email, and that a failure after
 * the reply never reaches the caller. Link issue, claim, expiry and cancel run against Postgres
 * in tests/integration/core-api/password-reset.integration.ts.
 */
import { expect } from '@jest/globals';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SlidingWindowRateLimiter } from '../../../packages/core-api/src/core/sliding-window-rate-limiter';
import {
  PasswordResetError,
  PasswordResetService,
} from '../../../packages/core-api/src/modules/auth/password-reset-service';
import { AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';
import { createAuthHandlers } from '../../../packages/core-api/src/modules/auth/handler';
import {
  EMAIL_SETTINGS,
  EmailService,
  renderSystemEmailTemplate,
} from '../../../packages/core-api/src/modules/email';
import type { EmailConfig } from '../../../packages/shared/dto';
import { PasswordChangedNotifier } from '../../../packages/core-api/src/modules/auth/password-changed-notifier';
import { AuthProvider, type User } from '../../../packages/shared/domain';
import { fakeUserRepo } from '../../support/repo-fakes';
import { asPrismaClient } from '../../support/prisma-double';
import { fakeLogger } from '../../support/fake-logger';
import { stubInstance } from '../../support/stub-instance';

const USER: User = {
  id: 'user-1',
  email: 'riley@example.com',
  username: 'riley',
  firstName: 'Riley',
  lastName: 'Reset',
  isActive: true,
  isRootAdmin: false,
  authProvider: AuthProvider.EMAIL,
  createdAt: new Date('2026-04-21T00:00:00.000Z'),
  updatedAt: new Date('2026-04-21T00:00:00.000Z'),
};

function buildService(overrides: {
  send?: jest.Mock;
  emailConfig?: EmailConfig;
  limits?: { requestsPerMinute?: number; confirmsPerMinute?: number };
  now?: () => Date;
} = {}) {
  const tx = {
    passwordResetToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ passwordHash: 'stored-hash' }) },
    passwordResetToken: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn().mockImplementation(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const send = overrides.send ?? jest.fn().mockResolvedValue({ provider: 'smtp' });
  const logger = fakeLogger();
  const service = new PasswordResetService({
    users: fakeUserRepo({ findByIdentifier: jest.fn().mockResolvedValue(USER) }),
    prisma: asPrismaClient(prisma),
    email: new EmailService({
      transport: { providerName: 'smtp', send },
      readConfig: () => overrides.emailConfig ?? EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }),
      senderAddress: 'noreply@poolmaster.test',
    }),
    appBaseUrl: 'https://app.example.test',
    logger,
    now: overrides.now,
    ...overrides.limits,
  });
  return { service, prisma, send, logger };
}

describe('SlidingWindowRateLimiter', () => {
  it('allows hits up to the limit inside the window and refuses the next one', () => {
    const limiter = new SlidingWindowRateLimiter(2, 60_000, () => 1_000);

    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a')).toEqual({ allowed: false, count: 2 });
  });

  it('counts each key on its own', () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000, () => 1_000);

    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('b').allowed).toBe(true);
  });

  it('lets a refused key back in once its oldest hit leaves the window', () => {
    let now = 1_000;
    const limiter = new SlidingWindowRateLimiter(1, 60_000, () => now);
    limiter.hit('a');
    expect(limiter.hit('a').allowed).toBe(false);

    now += 60_000;

    expect(limiter.hit('a').allowed).toBe(true);
  });
});

describe('PasswordResetService address limits', () => {
  it('refuses the sixth reset request from one address in a minute with PASSWORD_RESET_RATE_LIMITED 429', () => {
    const { service } = buildService({ now: () => new Date('2026-10-22T12:00:00.000Z') });
    for (let attempt = 0; attempt < 5; attempt += 1) service.assertRequestAllowed('203.0.113.7');

    let refusal: unknown;
    try {
      service.assertRequestAllowed('203.0.113.7');
    } catch (err) {
      refusal = err;
    }
    expect(refusal).toMatchObject({ code: 'PASSWORD_RESET_RATE_LIMITED', statusCode: 429 });
    expect(() => service.assertRequestAllowed('198.51.100.1')).not.toThrow();
  });

  it('refuses the eleventh confirm from one address in a minute', () => {
    const { service } = buildService({ now: () => new Date('2026-10-22T12:00:00.000Z') });
    for (let attempt = 0; attempt < 10; attempt += 1) service.assertConfirmAllowed('203.0.113.7');

    expect(() => service.assertConfirmAllowed('203.0.113.7')).toThrow(PasswordResetError);
  });
});

describe('PasswordResetService.requestReset', () => {
  it('resolves without reporting anything when the email cannot be sent', async () => {
    const { service, logger } = buildService({ send: jest.fn().mockRejectedValue(new Error('SMTP down')) });

    await expect(service.requestReset('riley@example.com')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('logs the email as skipped, not sent, when email is switched off in settings', async () => {
    const { service, logger } = buildService({
      emailConfig: { ...EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }), enabled: false },
    });

    await service.requestReset('riley@example.com');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authService.passwordReset.emailSkipped' }),
      expect.any(String),
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authService.passwordReset.emailSent' }),
      expect.any(String),
    );
  });

  it('sends nothing for an account that signs in without a password', async () => {
    const { service, prisma, send } = buildService();
    prisma.user.findUnique.mockResolvedValue({ passwordHash: null });

    await service.requestReset('riley@example.com');

    expect(send).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('PasswordResetService.confirmReset', () => {
  it('refuses mismatched passwords before it touches any link', async () => {
    const { service, prisma } = buildService();

    await expect(service.confirmReset('token', 'NewPass-1234', 'NewPass-5678'))
      .rejects.toMatchObject({ code: 'PASSWORD_CONFIRMATION_MISMATCH', statusCode: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a dead link with PASSWORD_RESET_LINK_INVALID before hashing or opening a transaction', async () => {
    const { service, prisma } = buildService();

    await expect(service.confirmReset('dead-token', 'NewPass-1234', 'NewPass-1234'))
      .rejects.toMatchObject({ code: 'PASSWORD_RESET_LINK_INVALID', statusCode: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('password reset request handler', () => {
  function createReply(order: string[]): FastifyReply {
    const reply = {
      header: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockImplementation(() => {
        order.push('reply');
        return reply;
      }),
    };
    return reply as unknown as FastifyReply;
  }

  function createRequest(): FastifyRequest {
    const logger = fakeLogger();
    return {
      body: { identifier: 'riley@example.com' },
      ip: '203.0.113.7',
      headers: {},
      contextLogger: logger,
      log: logger,
    } as unknown as FastifyRequest;
  }

  it('answers 202 before it looks the account up, so a match is not slower than no match', async () => {
    const order: string[] = [];
    const passwordResets = stubInstance(PasswordResetService, {
      assertRequestAllowed: jest.fn(),
      requestReset: jest.fn().mockImplementation(() => {
        order.push('lookup');
        return Promise.resolve();
      }),
    });
    const handlers = createAuthHandlers(stubInstance(AuthService, {}), passwordResets);
    const reply = createReply(order);

    await handlers.requestPasswordReset(createRequest() as never, reply);

    expect(reply.status).toHaveBeenCalledWith(202);
    expect(reply.send).toHaveBeenCalledWith({ success: true });
    expect(order).toEqual(['reply', 'lookup']);
  });

  it('answers 429 and looks nothing up when the address is over its limit', async () => {
    const passwordResets = stubInstance(PasswordResetService, {
      assertRequestAllowed: jest.fn().mockImplementation(() => {
        throw new PasswordResetError('Too many tries. Wait a minute and try again.', 'PASSWORD_RESET_RATE_LIMITED', 429);
      }),
      requestReset: jest.fn(),
    });
    const handlers = createAuthHandlers(stubInstance(AuthService, {}), passwordResets);
    const reply = createReply([]);

    await handlers.requestPasswordReset(createRequest() as never, reply);

    expect(reply.status).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith({
      error: { code: 'PASSWORD_RESET_RATE_LIMITED', message: 'Too many tries. Wait a minute and try again.' },
    });
    expect(passwordResets.requestReset).not.toHaveBeenCalled();
  });
});

describe('PASSWORD_RESET email', () => {
  it('greets by first name, names the username, links to the reset page and states the expiry', () => {
    const message = renderSystemEmailTemplate('PASSWORD_RESET', {
      firstName: 'Riley',
      username: 'riley',
      resetUrl: 'https://app.example.test/reset-password#token=abc',
      expiresInMinutes: 10,
    }, { timeZone: 'UTC' });

    expect(message.templateKey).toBe('PASSWORD_RESET');
    expect(message.subject).toBe('Reset your Prime Time Commissioner password');
    expect(message.text).toContain('Hi Riley,');
    expect(message.text).toContain('your Prime Time Commissioner account (riley)');
    expect(message.text).toContain('Choose a new password: https://app.example.test/reset-password#token=abc');
    expect(message.text).toContain('This link works once and expires in 10 minutes.');
    expect(message.text).toContain("If you didn't ask for this, you can ignore this email. Your password won't change.");
    expect(message.html).toContain('href="https://app.example.test/reset-password#token=abc"');
  });

  it('escapes a first name that contains markup', () => {
    const message = renderSystemEmailTemplate('PASSWORD_RESET', {
      firstName: '<b>Riley</b>',
      username: 'riley',
      resetUrl: 'https://app.example.test/reset-password#token=abc',
      expiresInMinutes: 10,
    }, { timeZone: 'UTC' });

    expect(message.html).toContain('Hi &lt;b&gt;Riley&lt;/b&gt;,');
    expect(message.html).not.toContain('<b>Riley</b>');
  });
});


describe('PASSWORD_CHANGED email', () => {
  it('says when the password changed and links to reset it again', () => {
    const message = renderSystemEmailTemplate('PASSWORD_CHANGED', {
      firstName: 'Riley',
      username: 'riley',
      changedAt: new Date('2026-10-22T14:05:00.000Z'),
      forgotPasswordUrl: 'https://app.example.test/forgot-password',
    }, { timeZone: 'UTC' });

    expect(message.templateKey).toBe('PASSWORD_CHANGED');
    expect(message.subject).toBe('Your Prime Time Commissioner password was changed');
    expect(message.text).toContain('Hi Riley,');
    expect(message.text).toContain('account (riley) was changed on Oct 22, 2026, 2:05 PM UTC.');
    expect(message.text).toContain("If this wasn't you, reset your password now");
    expect(message.text).toContain('https://app.example.test/forgot-password');
    expect(message.html).toContain('href="https://app.example.test/forgot-password"');
  });

  it("shows the change time in the recipient's own time zone", () => {
    const message = renderSystemEmailTemplate('PASSWORD_CHANGED', {
      firstName: 'Riley',
      username: 'riley',
      changedAt: new Date('2026-10-22T14:05:00.000Z'),
      forgotPasswordUrl: 'https://app.example.test/forgot-password',
    }, { timeZone: 'America/New_York' });

    expect(message.text).toContain('was changed on Oct 22, 2026, 10:05 AM EDT.');
  });
});

describe('PasswordChangedNotifier', () => {
  it('logs the password changed email as skipped, not sent, when email is switched off in settings', async () => {
    const logger = fakeLogger();
    const notifier = new PasswordChangedNotifier(
      fakeUserRepo({ findById: jest.fn().mockResolvedValue(USER) }),
      new EmailService({
        transport: { providerName: 'smtp', send: jest.fn() },
        readConfig: () => ({ ...EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }), enabled: false }),
        senderAddress: 'noreply@poolmaster.test',
      }),
      'https://app.example.test',
      logger,
    );

    await notifier.notify(USER.id, new Date('2026-10-22T12:00:00.000Z'));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authService.passwordChanged.emailSkipped' }),
      expect.any(String),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });
});
