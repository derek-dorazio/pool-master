/**
 * #847 — password reset links against Postgres.
 *
 * The rules that matter here are database rules: a link is claimed by one conditional update so
 * two clicks cannot both set a password, a reset signs every session out in the same transaction,
 * and a newer link or any password change leaves the older ones dead. A Prisma double would only
 * restate the queries, so these run the real service against the real tables. Email goes to a
 * recording delivery, which is the one thing faked.
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
  createTestUser,
} from '../helpers';
import { expectDefined } from '../../support/expect-defined';
import { emailServiceOver } from '../../support/email-service';
import {
  PASSWORD_RESET_LINK_MINUTES,
  PasswordResetService,
  hashResetToken,
} from '../../../packages/core-api/src/modules/auth/password-reset-service';
import { UserService } from '../../../packages/core-api/src/modules/users/user-service';
import { PrismaUserRepository } from '../../../packages/core-api/src/adapters';
import type {
  MailDeliveryMessage,
  MailDeliveryProvider,
  MailDeliveryResult,
} from '../../../packages/core-api/src/modules/email';

const APP_BASE_URL = 'https://app.example.test';
const MINUTE_MS = 60_000;

class RecordingMailDelivery implements MailDeliveryProvider {
  readonly providerName = 'smtp' as const;
  readonly sent: MailDeliveryMessage[] = [];

  send(message: MailDeliveryMessage): Promise<MailDeliveryResult> {
    this.sent.push(message);
    return Promise.resolve({ provider: this.providerName });
  }

  to(address: string): MailDeliveryMessage[] {
    return this.sent.filter((message) => message.to === address);
  }
}

/** The token from the link in a reset email's plain text. */
function tokenFrom(message: MailDeliveryMessage): string {
  const match = /\/reset-password#token=([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match?.[1]) throw new Error('The reset email carries no reset link');
  return match[1];
}

function buildService(options: { now?: () => Date } = {}) {
  const prisma = getPrisma();
  const mail = new RecordingMailDelivery();
  const service = new PasswordResetService({
    users: new PrismaUserRepository(prisma),
    prisma,
    email: emailServiceOver(mail),
    appBaseUrl: APP_BASE_URL,
    now: options.now,
  });
  return { service, mail };
}

async function issueRefreshToken(userId: string): Promise<string> {
  const token = `reset-it-${randomUUID()}`;
  await getPrisma().refreshToken.create({
    data: { token, userId, expiresAt: new Date(Date.now() + 60 * MINUTE_MS) },
  });
  return token;
}

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('password reset request (#847)', () => {
  it('emails the account a link whose token is stored only as its SHA-256, live for 10 minutes', async () => {
    const issuedAt = new Date('2026-10-22T12:00:00.000Z');
    const { service, mail } = buildService({ now: () => issuedAt });
    const { user } = await createTestUser({ firstName: 'Riley' });

    await service.requestReset(user.email);

    const message = expectDefined(mail.to(user.email)[0]);
    expect(message.subject).toBe('Reset your Prime Time Commissioner password');
    expect(message.text).toContain('Hi Riley,');
    expect(message.text).toContain(`${APP_BASE_URL}/reset-password#token=`);
    const token = tokenFrom(message);
    const rows = await getPrisma().passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    const row = expectDefined(rows[0]);
    expect(row.tokenHash).toBe(hashResetToken(token));
    expect(row.tokenHash).not.toContain(token);
    expect(row.expiresAt.getTime()).toBe(issuedAt.getTime() + PASSWORD_RESET_LINK_MINUTES * MINUTE_MS);
  });

  it('finds the account by username as well as by email, and mails the account email', async () => {
    const { service, mail } = buildService();
    const { user } = await createTestUser({ username: `reset-${randomUUID().slice(0, 8)}` });

    await service.requestReset(user.username);

    expect(mail.to(user.email)).toHaveLength(1);
  });

  it('writes nothing and sends nothing when no account matches', async () => {
    const { service, mail } = buildService();
    const before = await getPrisma().passwordResetToken.count();

    await service.requestReset(`nobody-${randomUUID()}@integration.test`);

    expect(mail.sent).toHaveLength(0);
    await expect(getPrisma().passwordResetToken.count()).resolves.toBe(before);
  });

  it('cancels the earlier link when a newer one is requested, so only the newest works', async () => {
    const { service, mail } = buildService();
    const { user } = await createTestUser();

    await service.requestReset(user.email);
    await service.requestReset(user.email);

    const [first, second] = mail.to(user.email).map(tokenFrom);
    await expect(service.confirmReset(expectDefined(first), 'NewPass-1234', 'NewPass-1234'))
      .rejects.toMatchObject({ code: 'PASSWORD_RESET_LINK_INVALID', statusCode: 400 });
    await expect(service.confirmReset(expectDefined(second), 'NewPass-1234', 'NewPass-1234')).resolves.toBeUndefined();
  });

  it('sends at most three reset emails per account per hour, then answers without sending', async () => {
    const { service, mail } = buildService();
    const { user } = await createTestUser();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await service.requestReset(user.email);
    }

    expect(mail.to(user.email)).toHaveLength(3);
    await expect(getPrisma().passwordResetToken.count({ where: { userId: user.id } })).resolves.toBe(3);
  });

  it('deletes the account\'s reset rows older than 30 days on its next request', async () => {
    const { service } = buildService();
    const { user } = await createTestUser();
    const old = await getPrisma().passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(randomUUID()),
        expiresAt: new Date(Date.now() - 31 * 24 * 60 * MINUTE_MS),
        createdAt: new Date(Date.now() - 31 * 24 * 60 * MINUTE_MS),
      },
    });

    await service.requestReset(user.email);

    await expect(getPrisma().passwordResetToken.findUnique({ where: { id: old.id } })).resolves.toBeNull();
  });
});

describe('password reset confirm (#847)', () => {
  it('sets the new password, uses the link and signs out every session', async () => {
    const { service, mail } = buildService();
    const { user } = await createTestUser({ password: 'OldPass-1234' });
    const refreshToken = await issueRefreshToken(user.id);
    await service.requestReset(user.email);
    const token = tokenFrom(expectDefined(mail.to(user.email)[0]));

    await service.confirmReset(token, 'NewPass-1234', 'NewPass-1234');

    const stored = await getPrisma().user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(bcrypt.compare('NewPass-1234', expectDefined(stored.passwordHash))).resolves.toBe(true);
    await expect(bcrypt.compare('OldPass-1234', expectDefined(stored.passwordHash))).resolves.toBe(false);
    const session = await getPrisma().refreshToken.findUniqueOrThrow({ where: { token: refreshToken } });
    expect(session.revokedAt).not.toBeNull();
    const link = await getPrisma().passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashResetToken(token) },
    });
    expect(link.usedAt).not.toBeNull();
  });

  it('refuses a link the second time it is used', async () => {
    const { service, mail } = buildService();
    const { user } = await createTestUser();
    await service.requestReset(user.email);
    const token = tokenFrom(expectDefined(mail.to(user.email)[0]));
    await service.confirmReset(token, 'NewPass-1234', 'NewPass-1234');

    await expect(service.confirmReset(token, 'Other-Pass-99', 'Other-Pass-99'))
      .rejects.toMatchObject({ code: 'PASSWORD_RESET_LINK_INVALID', statusCode: 400 });
  });

  it('lets exactly one of two simultaneous clicks on the same link set a password', async () => {
    const { service, mail } = buildService();
    const { user } = await createTestUser();
    await service.requestReset(user.email);
    const token = tokenFrom(expectDefined(mail.to(user.email)[0]));

    const outcomes = await Promise.allSettled([
      service.confirmReset(token, 'First-Pass-11', 'First-Pass-11'),
      service.confirmReset(token, 'Second-Pass-22', 'Second-Pass-22'),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(expectDefined(rejected[0]).reason).toMatchObject({ code: 'PASSWORD_RESET_LINK_INVALID' });
  });

  it('refuses a link once its 10 minutes are up', async () => {
    let now = new Date('2026-10-22T12:00:00.000Z');
    const { service, mail } = buildService({ now: () => now });
    const { user } = await createTestUser();
    await service.requestReset(user.email);
    const token = tokenFrom(expectDefined(mail.to(user.email)[0]));

    now = new Date(now.getTime() + PASSWORD_RESET_LINK_MINUTES * MINUTE_MS);

    await expect(service.confirmReset(token, 'NewPass-1234', 'NewPass-1234'))
      .rejects.toMatchObject({ code: 'PASSWORD_RESET_LINK_INVALID' });
  });

  it('refuses a token that was never issued with the same code as a used one', async () => {
    const { service } = buildService();

    await expect(service.confirmReset('not-a-real-token', 'NewPass-1234', 'NewPass-1234'))
      .rejects.toMatchObject({ code: 'PASSWORD_RESET_LINK_INVALID', statusCode: 400 });
  });

  it('refuses mismatched passwords without using up the link', async () => {
    const { service, mail } = buildService();
    const { user } = await createTestUser();
    await service.requestReset(user.email);
    const token = tokenFrom(expectDefined(mail.to(user.email)[0]));

    await expect(service.confirmReset(token, 'NewPass-1234', 'NewPass-5678'))
      .rejects.toMatchObject({ code: 'PASSWORD_CONFIRMATION_MISMATCH', statusCode: 400 });
    await expect(service.confirmReset(token, 'NewPass-1234', 'NewPass-1234')).resolves.toBeUndefined();
  });
});

describe('password changes cancel open reset links (#847)', () => {
  it('kills an open reset link when the user changes their own password', async () => {
    const { service, mail } = buildService();
    const { user } = await createTestUser({ password: 'OldPass-1234' });
    await service.requestReset(user.email);
    const token = tokenFrom(expectDefined(mail.to(user.email)[0]));
    const users = new UserService(new PrismaUserRepository(getPrisma()), getPrisma());

    await users.changeOwnPassword(
      { userId: user.id, isRootAdmin: false },
      user.id,
      { currentPassword: 'OldPass-1234', newPassword: 'Changed-1234', confirmNewPassword: 'Changed-1234' },
    );

    await expect(service.confirmReset(token, 'NewPass-1234', 'NewPass-1234'))
      .rejects.toMatchObject({ code: 'PASSWORD_RESET_LINK_INVALID' });
  });

  it('kills an open reset link when a root admin resets the password', async () => {
    const { service, mail } = buildService();
    const { user } = await createTestUser();
    const { user: admin } = await createTestUser({ isRootAdmin: true });
    await service.requestReset(user.email);
    const token = tokenFrom(expectDefined(mail.to(user.email)[0]));
    const users = new UserService(new PrismaUserRepository(getPrisma()), getPrisma());

    await users.resetPassword({ userId: admin.id, isRootAdmin: true }, user.id);

    await expect(service.confirmReset(token, 'NewPass-1234', 'NewPass-1234'))
      .rejects.toMatchObject({ code: 'PASSWORD_RESET_LINK_INVALID' });
  });
});
