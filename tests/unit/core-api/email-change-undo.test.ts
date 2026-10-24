/**
 * #903 A5 — the email an account's old address gets when its email changes: what it says and
 * where its link goes, and the per-address limit on using the link. What the link does is tested
 * against Postgres in `tests/integration/core-api/email-change-undo.integration.ts`.
 */
import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { EmailChangedBy, renderSystemEmailTemplate, type EmailChangedEmailData } from '../../../packages/core-api/src/modules/email';
import { EmailChangeUndoService } from '../../../packages/core-api/src/modules/auth/email-change-undo-service';
import { AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';
import { PasswordResetService } from '../../../packages/core-api/src/modules/auth/password-reset-service';
import { createAuthHandlers } from '../../../packages/core-api/src/modules/auth/handler';
import { asPrismaClient } from '../../support/prisma-double';
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
    expect(message.subject).toBe('Your Prime Time Commissioner email address was changed');
    expect(message.text).toContain([
      'Hi Riley,',
      '',
      'The email address for your Prime Time Commissioner account (riley) was changed to riley.new@example.test on Oct 22, 2026, 2:05 PM UTC.',
      '',
      'Prime Time Commissioner sends everything to the new address now, so this is the last email to this one.',
      '',
      "If this was you, there's nothing else to do. If this wasn't you, put this address back. The link works for 7 days. It signs everyone out of your account and clears its password, and then you set a new one. Put your address back:",
      'https://app.example.test/undo-email-change#token=abc',
    ].join('\n'));
    expect(message.html).toContain('href="https://app.example.test/undo-email-change#token=abc"');
    expect(message.html).toContain('Put my address back');
  });

  it('says an admin made the change when a root admin changed the address', () => {
    const message = renderSystemEmailTemplate('EMAIL_CHANGED', { ...DATA, changedBy: EmailChangedBy.ROOT_ADMIN }, { timeZone: 'UTC' });

    expect(message.text).toContain('A Prime Time Commissioner admin changed the email address for your account (riley) to riley.new@example.test on Oct 22, 2026, 2:05 PM UTC.');
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
      prisma: asPrismaClient({
        emailChangeUndoToken: { findFirst: jest.fn(() => Promise.resolve({ userId: 'user-1', oldEmail: 'old@example.test' })) },
        user: { count: jest.fn(() => Promise.resolve(0)) },
        $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
      }),
      email: emailServiceOver({ providerName: 'smtp', send: () => Promise.resolve({ provider: 'smtp' }) }),
      appBaseUrl: 'https://app.example.test',
    });

    await expect(service.undo('abc')).rejects.toMatchObject({ code: 'EMAIL_CHANGE_UNDO_ADDRESS_TAKEN', statusCode: 409 });
  });
});
