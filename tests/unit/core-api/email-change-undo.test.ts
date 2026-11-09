/**
 * #903 A5 — the email an account's old address gets when its email changes: what it says and
 * where its link goes, and the per-address limit on using the link. What the link does is tested
 * against Postgres in `tests/integration/core-api/email-change-undo.integration.ts`.
 */
import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { EmailMessageStatus, type User } from '@poolmaster/shared/domain';
import { EmailChangedBy, renderSystemEmailTemplate, type EmailChangedEmailData } from '../../../packages/core-api/src/modules/email';
import { EmailChangeUndoService } from '../../../packages/core-api/src/modules/auth/email-change-undo-service';
import { AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';
import { PasswordResetService } from '../../../packages/core-api/src/modules/auth/password-reset-service';
import { createAuthHandlers } from '../../../packages/core-api/src/modules/auth/handler';
import { asPrismaClient } from '../../support/prisma-double';
import { fakeUserRepo } from '../../support/repo-fakes';
import { fakeLogger } from '../../support/fake-logger';
import { stubInstance } from '../../support/stub-instance';
import { emailServiceOver } from '../../support/email-service';

const DATA: EmailChangedEmailData = {
  firstName: 'Riley',
  username: 'riley',
  newEmail: 'riley.new@example.test',
  changedAt: new Date('2026-10-22T14:05:00.000Z'),
  changedBy: EmailChangedBy.ACCOUNT_OWNER,
  undoUrl: 'https://app.example.test/undo-email-change#token=abc',
  undoDays: 7,
};

describe('EMAIL_CHANGED email', () => {
  it('tells the old address the new one and when, that it gets no more email, and links to put it back', () => {
    const message = renderSystemEmailTemplate('EMAIL_CHANGED', DATA, { timeZone: 'UTC' });

    expect(message.templateKey).toBe('EMAIL_CHANGED');
    expect(message.subject).toBe('Your Primetime Commissioner email address was changed');
    expect(message.text).toContain([
      'Hi Riley,',
      '',
      'The email address for your Primetime Commissioner account (riley) was changed to riley.new@example.test on Oct 22, 2026, 2:05 PM UTC.',
      '',
      'Primetime Commissioner sends everything to the new address now, so this is the last email to this one.',
      '',
      "If this was you, there's nothing else to do. If this wasn't you, put this address back. The link works for 7 days. It signs everyone out of your account and clears its password, and then you set a new one. Put your address back:",
      'https://app.example.test/undo-email-change#token=abc',
    ].join('\n'));
    expect(message.html).toContain('href="https://app.example.test/undo-email-change#token=abc"');
    expect(message.html).toContain('Put my address back');
  });

  it('says an admin made the change when a root admin changed the address', () => {
    const message = renderSystemEmailTemplate('EMAIL_CHANGED', { ...DATA, changedBy: EmailChangedBy.ROOT_ADMIN }, { timeZone: 'UTC' });

    expect(message.text).toContain('A Primetime Commissioner admin changed the email address for your account (riley) to riley.new@example.test on Oct 22, 2026, 2:05 PM UTC.');
  });

  it("shows the change time in the account's own time zone and escapes the names in the HTML", () => {
    const message = renderSystemEmailTemplate('EMAIL_CHANGED', { ...DATA, firstName: '<b>Riley</b>' }, { timeZone: 'America/New_York' });

    expect(message.text).toContain('on Oct 22, 2026, 10:05 AM EDT.');
    expect(message.html).not.toContain('<b>Riley</b>');
  });
});

describe('undo link rate limit', () => {
  function undoService() {
    const undo = jest.fn(() => Promise.resolve());
    const service = new EmailChangeUndoService({
      users: fakeUserRepo(),
      prisma: asPrismaClient({}),
      email: emailServiceOver({ providerName: 'smtp', send: () => Promise.resolve({ provider: 'smtp' }) }),
      appBaseUrl: 'https://app.example.test',
      undosPerMinute: 2,
    });
    service.undo = undo;
    return { service, undo };
  }

  function request(): FastifyRequest {
    const logger = fakeLogger();
    return { body: { token: 'abc' }, ip: '203.0.113.7', headers: {}, contextLogger: logger, log: logger } as unknown as FastifyRequest;
  }

  function reply(): FastifyReply {
    return { header: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() } as unknown as FastifyReply;
  }

  it('answers 429 and tries no link once an address has tried too many in a minute', async () => {
    const { service, undo } = undoService();
    const handlers = createAuthHandlers(stubInstance(AuthService, {}), stubInstance(PasswordResetService, {}), service);

    await handlers.undoEmailChange(request() as never, reply());
    await handlers.undoEmailChange(request() as never, reply());
    const third = reply();
    await handlers.undoEmailChange(request() as never, third);

    expect(undo).toHaveBeenCalledTimes(2);
    expect(third.status).toHaveBeenCalledWith(429);
    expect(third.send).toHaveBeenCalledWith({
      error: { code: 'EMAIL_CHANGE_UNDO_RATE_LIMITED', message: 'Too many tries. Wait a minute and try again.' },
    });
  });
});

describe('undo race for the old address', () => {
  it('answers EMAIL_CHANGE_UNDO_ADDRESS_TAKEN, not a server error, when another account takes the address between the check and the write', async () => {
    const takenMeanwhile = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
      code: 'P2002',
      clientVersion: Prisma.prismaVersion.client,
    });
    const tx = {
      emailChangeUndoToken: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: jest.fn(() => Promise.resolve({ createdAt: new Date('2026-10-24T12:00:00.000Z') })),
      },
      user: { update: jest.fn(() => Promise.reject(takenMeanwhile)) },
    };
    const service = new EmailChangeUndoService({
      // Nobody holds the address when it is checked; another account takes it before the write.
      users: fakeUserRepo(),
      prisma: asPrismaClient({
        emailChangeUndoToken: { findFirst: jest.fn(() => Promise.resolve({ userId: 'user-1', oldEmail: 'old@example.test' })) },
        $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
      }),
      email: emailServiceOver({ providerName: 'smtp', send: () => Promise.resolve({ provider: 'smtp' }) }),
      appBaseUrl: 'https://app.example.test',
    });

    await expect(service.undo('abc')).rejects.toMatchObject({ code: 'EMAIL_CHANGE_UNDO_ADDRESS_TAKEN', statusCode: 409 });
  });
});

describe('telling the old address of an email change', () => {
  const user = { id: 'user-1', email: 'riley.new@example.test', firstName: 'Riley', lastName: 'Q', username: 'riley' } as User;
  const change = { user, oldEmail: 'riley@example.test', changedBy: EmailChangedBy.ACCOUNT_OWNER, changedAt: new Date('2026-10-22T14:05:00.000Z') };

  function tellingService(send: jest.Mock, transactionFails = false) {
    const tx = { emailChangeUndoToken: { deleteMany: jest.fn(async () => ({ count: 0 })), create: jest.fn(async () => ({ id: 'undo-1' })) } };
    const logger = fakeLogger();
    const service = new EmailChangeUndoService({
      users: fakeUserRepo(),
      prisma: asPrismaClient({
        $transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => {
          if (transactionFails) throw new Error('database unavailable');
          return run(tx);
        }),
      }),
      email: { send },
      appBaseUrl: 'https://app.example.test',
      logger,
    });
    return { service, tx, logger };
  }

  it('stores a hashed undo link and emails it to the old address about that link, logging it queued', async () => {
    const send = jest.fn(async () => ({ status: EmailMessageStatus.QUEUED }));
    const { service, tx, logger } = tellingService(send);

    await service.tellOldAddress(change);

    expect(tx.emailChangeUndoToken.create).toHaveBeenCalledTimes(1);
    const [[key, mail]] = send.mock.calls as unknown as Array<[string, { to: { email: string }; about: string }]>;
    expect(key).toBe('EMAIL_CHANGED');
    expect(mail.to.email).toBe('riley@example.test');
    expect(mail.about).toBe('undo-1');
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ action: 'userService.emailChanged.emailQueued' }), expect.any(String));
  });

  it('logs an email skipped by email settings as skipped, and a failed write as failed, never throwing', async () => {
    const skipped = tellingService(jest.fn(async () => ({ status: EmailMessageStatus.SKIPPED, skipReason: 'DISABLED' })));
    const failing = tellingService(jest.fn(), true);

    await skipped.service.tellOldAddress(change);
    await expect(failing.service.tellOldAddress(change)).resolves.toBeUndefined();

    expect(skipped.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'userService.emailChanged.emailSkipped' }), expect.any(String));
    expect(failing.logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'userService.emailChanged.emailFailed' }), expect.any(String));
  });
});

describe('using an undo link', () => {
  const link = { userId: 'user-1', oldEmail: 'riley@example.test' };

  function undoing(options: { found?: typeof link | null; holder?: boolean; claimed?: number; writeFails?: Error } = {}) {
    const tx = {
      emailChangeUndoToken: {
        updateMany: jest.fn(async () => ({ count: options.claimed ?? 1 })),
        findUniqueOrThrow: jest.fn(async () => ({ createdAt: new Date('2026-10-24T12:00:00.000Z') })),
      },
      user: {
        update: jest.fn(async () => { if (options.writeFails) throw options.writeFails; return {}; }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      passwordResetToken: { updateMany: jest.fn(async () => ({ count: 0 })) },
      refreshToken: { updateMany: jest.fn(async () => ({ count: 2 })) },
    };
    const logger = fakeLogger();
    const service = new EmailChangeUndoService({
      users: fakeUserRepo({ findHolderOtherThan: jest.fn(async () => (options.holder ? ({ id: 'someone-else' } as User) : null)) }),
      prisma: asPrismaClient({
        emailChangeUndoToken: { findFirst: jest.fn(async () => (options.found === undefined ? link : options.found)) },
        $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
      }),
      email: { send: jest.fn() },
      appBaseUrl: 'https://app.example.test',
      logger,
    });
    return { service, tx, logger };
  }

  it('puts the old address back, replaces the password, cancels the later links and the reset links, and signs the account out', async () => {
    const { service, tx, logger } = undoing();

    await service.undo('abc');

    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { email: 'riley@example.test' } });
    expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1', passwordHash: { not: null } } }));
    expect(tx.emailChangeUndoToken.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ action: 'authService.emailChangeUndo.confirmed' }), expect.any(String));
  });

  it('answers EMAIL_CHANGE_UNDO_LINK_INVALID for a dead link, and for a live one another click claimed first, changing nothing', async () => {
    const dead = undoing({ found: null });
    const raced = undoing({ claimed: 0 });

    await expect(dead.service.undo('abc')).rejects.toMatchObject({ code: 'EMAIL_CHANGE_UNDO_LINK_INVALID', statusCode: 400 });
    await expect(raced.service.undo('abc')).rejects.toMatchObject({ code: 'EMAIL_CHANGE_UNDO_LINK_INVALID', statusCode: 400 });
    expect(raced.tx.user.update).not.toHaveBeenCalled();
  });

  it('answers EMAIL_CHANGE_UNDO_ADDRESS_TAKEN when another account holds the old address, before writing anything', async () => {
    const { service, tx } = undoing({ holder: true });

    await expect(service.undo('abc')).rejects.toMatchObject({ code: 'EMAIL_CHANGE_UNDO_ADDRESS_TAKEN', statusCode: 409 });
    expect(tx.emailChangeUndoToken.updateMany).not.toHaveBeenCalled();
  });

  it('lets any other failed write through, as it is', async () => {
    const { service } = undoing({ writeFails: new Error('connection reset') });

    await expect(service.undo('abc')).rejects.toThrow('connection reset');
  });
});
