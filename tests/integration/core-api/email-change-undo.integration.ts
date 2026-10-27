/**
 * #903 A5 — the email an account's old address gets when its email changes, and its undo link,
 * against Postgres.
 *
 * The rules that matter are database rules: the link is claimed by one conditional update, the
 * undo puts the address back and signs every session out in one transaction, and using a link
 * cancels the links from later changes but not from earlier ones. So these run the real services
 * against the real tables. Email goes to a recording delivery, which is the one thing faked.
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { setupIntegrationTests, teardownIntegrationTests, getPrisma, createTestUser } from '../helpers';
import { expectDefined } from '../../support/expect-defined';
import { deliverQueuedEmail, emailServiceOver } from '../../support/email-service';
import { inMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { UserService } from '../../../packages/core-api/src/modules/users/user-service';
import { PasswordChangedNotifier } from '../../../packages/core-api/src/modules/auth/password-changed-notifier';
import { EMAIL_CHANGE_UNDO_LINK_DAYS } from '@poolmaster/shared/dto';
import { EmailChangeUndoService } from '../../../packages/core-api/src/modules/auth/email-change-undo-service';
import { hashResetToken, PasswordResetService } from '../../../packages/core-api/src/modules/auth/password-reset-service';
import { PrismaUserRepository } from '../../../packages/core-api/src/adapters';
import type {
  MailDeliveryMessage,
  MailDeliveryProvider,
  MailDeliveryResult,
} from '../../../packages/core-api/src/modules/email';

const APP_BASE_URL = 'https://app.example.test';
const DAY_MS = 24 * 60 * 60_000;
const CHANGED_SUBJECT = 'Your Primetime Commissioner email address was changed';

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

/** The token from the link in an email-changed email's plain text. */
function tokenFrom(message: MailDeliveryMessage | undefined): string {
  const match = /\/undo-email-change#token=([A-Za-z0-9_-]+)/.exec(expectDefined(message).text);
  if (!match?.[1]) throw new Error('The email carries no undo link');
  return match[1];
}

function build(options: { now?: () => Date } = {}) {
  const prisma = getPrisma();
  const users = new PrismaUserRepository(prisma);
  const mail = new RecordingMailDelivery();
  const outbox = inMemoryEmailMessages();
  const email = emailServiceOver(mail, outbox);
  const undo = new EmailChangeUndoService({ users, prisma, email, appBaseUrl: APP_BASE_URL, now: options.now });
  const userService = new UserService(users, prisma, new PasswordChangedNotifier(users, email, APP_BASE_URL), undo);
  const resets = new PasswordResetService({ users, prisma, email, appBaseUrl: APP_BASE_URL });
  return { undo, userService, resets, mail, outbox };
}

/** `userId` changes their own email to `email`, and the email to the old address is delivered. */
async function changeEmail(userService: UserService, userId: string, email: string, actor = { userId, isRootAdmin: false }) {
  await userService.updateProfile(actor, userId, { firstName: 'Riley', lastName: 'Owner', email });
  await deliverQueuedEmail();
}

const freshEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@integration.test`;

async function emailOf(userId: string): Promise<string> {
  return (await getPrisma().user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })).email;
}

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('the email-changed email (#903 A5)', () => {
  it('emails the old address, not the new one, with the new address and a link stored only as its SHA-256, live for 7 days', async () => {
    const changedAt = Date.now();
    const { userService, mail } = build();
    const { user } = await createTestUser({ firstName: 'Riley' });
    const newEmail = freshEmail('new');

    await changeEmail(userService, user.id, newEmail);

    expect(mail.to(newEmail)).toHaveLength(0);
    const message = expectDefined(mail.to(user.email)[0]);
    expect(message.subject).toBe(CHANGED_SUBJECT);
    expect(message.text).toContain('Hi Riley,');
    expect(message.text).toContain(`was changed to ${newEmail} on`);
    const rows = await getPrisma().emailChangeUndoToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    const row = expectDefined(rows[0]);
    expect(row.tokenHash).toBe(hashResetToken(tokenFrom(message)));
    expect(row.oldEmail).toBe(user.email);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(EMAIL_CHANGE_UNDO_LINK_DAYS * DAY_MS);
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(changedAt - 1000);
  });

  it('keeps no copy of the undo link in the outbox once the email is sent', async () => {
    const { userService, outbox } = build();
    const { user } = await createTestUser();

    await changeEmail(userService, user.id, freshEmail('new'));

    expect(outbox.rows.filter((row) => row.templateKey === 'EMAIL_CHANGED').map((row) => [row.status, row.subject ?? null, row.textBody ?? null, row.htmlBody ?? null]))
      .toEqual([['SENT', null, null, null]]);
  });

  it('says a Primetime Commissioner admin made the change when a root admin changed the address', async () => {
    const { userService, mail } = build();
    const { user } = await createTestUser();
    const { user: admin } = await createTestUser({ isRootAdmin: true });
    const newEmail = freshEmail('admin-set');

    await changeEmail(userService, user.id, newEmail, { userId: admin.id, isRootAdmin: true });

    expect(expectDefined(mail.to(user.email)[0]).text).toContain(`A Primetime Commissioner admin changed the email address for your account (${user.username}) to ${newEmail}`);
  });

  it('sends nothing when a profile save keeps the same address', async () => {
    const { userService, mail } = build();
    const { user } = await createTestUser();

    await changeEmail(userService, user.id, user.email);

    expect(mail.sent).toHaveLength(0);
  });
});

describe('undoing an email change (#903 A5)', () => {
  it('puts the old address back and signs out every session, and the link works only once', async () => {
    const { userService, undo, mail } = build();
    const { user } = await createTestUser();
    await changeEmail(userService, user.id, freshEmail('taker'));
    await getPrisma().refreshToken.create({
      data: { token: `undo-it-${randomUUID()}`, userId: user.id, expiresAt: new Date(Date.now() + DAY_MS) },
    });
    const token = tokenFrom(mail.to(user.email)[0]);

    await undo.undo(token);

    await expect(emailOf(user.id)).resolves.toBe(user.email);
    await expect(getPrisma().refreshToken.count({ where: { userId: user.id, revokedAt: null } })).resolves.toBe(0);
    await expect(undo.undo(token)).rejects.toMatchObject({ code: 'EMAIL_CHANGE_UNDO_LINK_INVALID', statusCode: 400 });
  });

  it('replaces the password with one nobody knows, so the password used to change the address no longer works, and a reset to the old address still goes out', async () => {
    const { userService, undo, resets, mail } = build();
    const { user } = await createTestUser({ password: 'Known-Pass1' });
    await changeEmail(userService, user.id, freshEmail('taker'));

    await undo.undo(tokenFrom(mail.to(user.email)[0]));

    const { passwordHash } = await getPrisma().user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    expect(passwordHash).not.toBeNull();
    await expect(bcrypt.compare('Known-Pass1', expectDefined(passwordHash))).resolves.toBe(false);
    await resets.requestReset(user.email);
    await deliverQueuedEmail();
    expect(mail.to(user.email).map((message) => message.subject)).toContain('Reset your Primetime Commissioner password');
  });

  it('cancels the open reset links, which went to the address being replaced', async () => {
    const { userService, undo, mail } = build();
    const { user } = await createTestUser();
    await changeEmail(userService, user.id, freshEmail('taker'));
    await getPrisma().passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashResetToken(randomUUID()), expiresAt: new Date(Date.now() + DAY_MS) },
    });

    await undo.undo(tokenFrom(mail.to(user.email)[0]));

    await expect(getPrisma().passwordResetToken.count({ where: { userId: user.id, cancelledAt: null } })).resolves.toBe(0);
  });

  it('refuses a link after its 7 days', async () => {
    const { userService, mail } = build();
    const { user } = await createTestUser();
    await changeEmail(userService, user.id, freshEmail('taker'));
    const late = build({ now: () => new Date(Date.now() + EMAIL_CHANGE_UNDO_LINK_DAYS * DAY_MS + 60_000) }).undo;

    await expect(late.undo(tokenFrom(mail.to(user.email)[0])))
      .rejects.toMatchObject({ code: 'EMAIL_CHANGE_UNDO_LINK_INVALID', statusCode: 400 });
    expect(await emailOf(user.id)).not.toBe(user.email);
  });

  it("lets the first owner's link win over a later change: it still works after the later link was used, and cancels that link", async () => {
    const { userService, undo, mail } = build();
    const { user } = await createTestUser();
    const second = freshEmail('second');
    await changeEmail(userService, user.id, second);
    await changeEmail(userService, user.id, freshEmail('third'));
    const firstLink = tokenFrom(mail.to(user.email)[0]);
    const laterLink = tokenFrom(mail.to(second)[0]);

    await undo.undo(laterLink);
    await expect(emailOf(user.id)).resolves.toBe(second);
    await undo.undo(firstLink);

    await expect(emailOf(user.id)).resolves.toBe(user.email);
    await expect(getPrisma().emailChangeUndoToken.count({ where: { userId: user.id, usedAt: null, cancelledAt: null } })).resolves.toBe(0);
  });

  it('refuses to put back an address another account has taken since, and changes nothing', async () => {
    const { userService, undo, mail } = build();
    const { user } = await createTestUser();
    const taker = freshEmail('taker');
    await changeEmail(userService, user.id, taker);
    await createTestUser({ email: user.email, username: freshEmail('other') });
    const token = tokenFrom(mail.to(user.email)[0]);

    await expect(undo.undo(token)).rejects.toMatchObject({ code: 'EMAIL_CHANGE_UNDO_ADDRESS_TAKEN', statusCode: 409 });
    await expect(emailOf(user.id)).resolves.toBe(taker);
  });
});
