/**
 * #1870 — the root admin's Notifications page: GET /api/v1/platform/emails lists every system
 * email with its sends of the last 30 days, GET …/:templateKey/latest-send answers the newest send
 * that still keeps its content, and POST …/latest-send/send-to-me queues a copy of it to the
 * calling admin. Sends are seeded straight into the outbox as the sender leaves them.
 */
import { randomUUID } from 'crypto';
import {
  ErrorEnvelopeSchema,
  SystemEmailLatestSendResponseSchema,
  SystemEmailListResponseSchema,
  SystemEmailResendResponseSchema,
  type SystemEmailDto,
} from '@poolmaster/shared/dto';
import { EmailMessageStatus, EmailSkipReason, type EmailTemplateKey } from '@poolmaster/shared/domain';
import { SYSTEM_EMAIL_REQUESTS_PER_MINUTE } from '../../../packages/core-api/src/modules/email';
import { expectMatchesSchema } from '../../support/expect-matches-schema';
import {
  cleanupTestData,
  createTestUser,
  deliverQueuedIntegrationEmail,
  getApp,
  getPrisma,
  getSentMail,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Every row this file seeds starts its idempotency key so, and is deleted after. */
const SEED_PREFIX = 'system-emails-integration:';

let rootAdmin: TestUser;

beforeAll(async () => {
  await setupIntegrationTests();
  rootAdmin = await createTestUser({ firstName: 'Notify', lastName: 'Admin', isRootAdmin: true });
});
afterAll(async () => {
  await getPrisma().emailMessage.deleteMany({ where: { idempotencyKey: { startsWith: SEED_PREFIX } } });
  await cleanupTestData();
  await teardownIntegrationTests();
});

/** One email as the sender leaves it: `status` at `sentAt`, its content kept unless `cleared`. */
async function seedSent(
  templateKey: EmailTemplateKey,
  sentAt: Date,
  options: { status?: EmailMessageStatus; cleared?: boolean; recipientEmail?: string; label?: string } = {},
): Promise<string> {
  const label = options.label ?? randomUUID();
  const skipped = options.status === EmailMessageStatus.SKIPPED;
  const cleared = skipped || options.cleared === true;
  const row = await getPrisma().emailMessage.create({
    data: {
      templateKey,
      recipientEmail: options.recipientEmail ?? 'member@integration.test',
      idempotencyKey: `${SEED_PREFIX}${label}`,
      fromName: 'Office League',
      fromAddress: 'office24@integration.test',
      subject: cleared ? null : `Subject ${label}`,
      textBody: cleared ? null : `Text ${label}`,
      htmlBody: cleared ? null : `<html><body><p>HTML ${label}</p></body></html>`,
      status: options.status ?? EmailMessageStatus.SENT,
      skipReason: skipped ? EmailSkipReason.EMAIL_DISABLED : null,
      attempts: skipped ? 0 : 1,
      sentAt: skipped ? null : sentAt,
    },
  });
  return row.id;
}

const ago = (days: number) => new Date(Date.now() - days * DAY_MS);
/** A send dated after anything other tests sent, so it is this key's latest whatever ran before. */
const ahead = (minutes: number) => new Date(Date.now() + minutes * 60_000);

async function listEmails(headers = rootAdmin.headers) {
  const response = await getApp().inject({ method: 'GET', url: '/api/v1/platform/emails/', headers });
  expect(response.statusCode).toBe(200);
  return expectMatchesSchema(SystemEmailListResponseSchema, response.json()).emails;
}

function emailOf(emails: SystemEmailDto[], templateKey: EmailTemplateKey): SystemEmailDto {
  const email = emails.find((candidate) => candidate.templateKey === templateKey);
  if (!email) throw new Error(`No ${templateKey} row`);
  return email;
}

function latestSend(templateKey: string, headers = rootAdmin.headers) {
  return getApp().inject({ method: 'GET', url: `/api/v1/platform/emails/${templateKey}/latest-send`, headers });
}

function sendToMe(templateKey: string, headers = rootAdmin.headers) {
  return getApp().inject({
    method: 'POST',
    url: `/api/v1/platform/emails/${templateKey}/latest-send/send-to-me`,
    headers: withoutJsonBodyHeaders(headers),
  });
}

describe('GET the system emails', () => {
  it('lists every template key once, with its plan feature, plan and status', async () => {
    const emails = await listEmails();

    expect(new Set(emails.map((email) => email.templateKey)).size).toBe(emails.length);
    expect(emailOf(emails, 'CONTEST_STANDINGS')).toMatchObject({ planFeature: 'EMAIL_CONTEST_STANDINGS', planStartsAt: 'PRO', status: 'ON' });
    expect(emailOf(emails, 'PASSWORD_RESET')).toMatchObject({ planFeature: null, planStartsAt: null, status: 'ALWAYS_ON' });
  });

  it('counts the sends of the last 30 days the transport accepted, leaving out older, skipped and failed emails', async () => {
    const before = emailOf(await listEmails(), 'CONTEST_RESULTS').sentLast30Days;
    await seedSent('CONTEST_RESULTS', ago(1));
    await seedSent('CONTEST_RESULTS', ago(2), { status: EmailMessageStatus.DELIVERED });
    await seedSent('CONTEST_RESULTS', ago(3), { status: EmailMessageStatus.BOUNCED });
    await seedSent('CONTEST_RESULTS', ago(29), { cleared: true });
    await seedSent('CONTEST_RESULTS', ago(31));
    await seedSent('CONTEST_RESULTS', ago(1), { status: EmailMessageStatus.FAILED });
    await seedSent('CONTEST_RESULTS', ago(1), { status: EmailMessageStatus.SKIPPED });

    const after = emailOf(await listEmails(), 'CONTEST_RESULTS');

    expect(after.sentLast30Days - before).toBe(4);
  });

  it('dates the last send, and the preview by the newest send that still keeps its content', async () => {
    const lastSentAt = ahead(10);
    const previewSentAt = ahead(5);
    await seedSent('CONTEST_OPENED', lastSentAt, { cleared: true });
    await seedSent('CONTEST_OPENED', previewSentAt);

    const email = emailOf(await listEmails(), 'CONTEST_OPENED');

    expect(email.lastSentAt).toBe(lastSentAt.toISOString());
    expect(email.previewSentAt).toBe(previewSentAt.toISOString());
  });

  it('refuses a member who is not a root admin with 403', async () => {
    const member = await createTestUser();

    const response = await getApp().inject({ method: 'GET', url: '/api/v1/platform/emails/', headers: member.headers });

    expect(response.statusCode).toBe(403);
  });
});

describe('GET a system email\'s latest send', () => {
  it('answers the newest send that keeps its content, exactly as sent, with its recipient masked', async () => {
    const sentAt = ahead(20);
    const label = randomUUID();
    await seedSent('CONTEST_ENTRY_REMINDER', ahead(15), { label: randomUUID() });
    await seedSent('CONTEST_ENTRY_REMINDER', sentAt, { label, recipientEmail: 'jordan@integration.test' });
    await seedSent('CONTEST_ENTRY_REMINDER', ahead(25), { cleared: true });

    const response = await latestSend('CONTEST_ENTRY_REMINDER');

    expect(response.statusCode).toBe(200);
    expect(expectMatchesSchema(SystemEmailLatestSendResponseSchema, response.json())).toEqual({
      templateKey: 'CONTEST_ENTRY_REMINDER',
      subject: `Subject ${label}`,
      htmlBody: `<html><body><p>HTML ${label}</p></body></html>`,
      sentAt: sentAt.toISOString(),
      recipient: 'j•••@integration.test',
    });
  });

  it('answers 404 SYSTEM_EMAIL_NOT_SENT for an email no send of which keeps its content', async () => {
    await getPrisma().emailMessage.deleteMany({ where: { templateKey: 'LEAGUE_PLAN_PREVIEW_ENDING' } });
    await seedSent('LEAGUE_PLAN_PREVIEW_ENDING', ago(1), { cleared: true });

    const response = await latestSend('LEAGUE_PLAN_PREVIEW_ENDING');

    expect(response.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.parse(response.json())).toMatchObject({ error: { code: 'SYSTEM_EMAIL_NOT_SENT' } });
  });

  it('answers 400 for a template key that does not exist', async () => {
    const response = await latestSend('NOT_AN_EMAIL');

    expect(response.statusCode).toBe(400);
  });
});

describe('POST send me a system email\'s latest send', () => {
  it('queues one copy of the latest send to the calling admin, which the sender delivers with the same subject', async () => {
    const label = randomUUID();
    await seedSent('CONTEST_STANDINGS', ahead(30), { label });
    const copiesBefore = await getPrisma().emailMessage.count({ where: { recipientUserId: rootAdmin.user.id } });

    const response = await sendToMe('CONTEST_STANDINGS');

    expect(response.statusCode).toBe(200);
    expect(expectMatchesSchema(SystemEmailResendResponseSchema, response.json())).toEqual({ status: 'QUEUED', skipReason: null });
    const copies = await getPrisma().emailMessage.findMany({ where: { recipientUserId: rootAdmin.user.id } });
    expect(copies).toHaveLength(copiesBefore + 1);
    const copy = copies.find((row) => row.subject === `Subject ${label}`);
    expect(copy).toMatchObject({
      templateKey: 'CONTEST_STANDINGS',
      recipientEmail: rootAdmin.user.email,
      fromAddress: 'office24@integration.test',
      htmlBody: `<html><body><p>HTML ${label}</p></body></html>`,
      leagueId: null,
      listUnsubscribeUrl: null,
    });
    await deliverQueuedIntegrationEmail();
    expect(getSentMail().filter((mail) => mail.to.includes(rootAdmin.user.email)).map((mail) => mail.subject)).toContain(`Subject ${label}`);
  });

  it('leaves the member\'s unsubscribe token out of the preview and the copy, and the copy changes neither the count, the last send nor the preview', async () => {
    const token = `member-token-${randomUUID()}`;
    const unsubscribe = `https://qa.example.com/email/unsubscribe?token=${token}`;
    const sentAt = ahead(40);
    const id = await seedSent('CONTEST_STARTED_SUMMARY', sentAt);
    await getPrisma().emailMessage.update({
      where: { id },
      data: {
        htmlBody: `<html><body><a href="${unsubscribe}">Stop these emails</a></body></html>`,
        textBody: `Stop these emails: ${unsubscribe}`,
      },
    });
    const before = emailOf(await listEmails(), 'CONTEST_STARTED_SUMMARY');

    const preview = await latestSend('CONTEST_STARTED_SUMMARY');
    const copied = await sendToMe('CONTEST_STARTED_SUMMARY');

    expect(preview.statusCode).toBe(200);
    expect(preview.body).not.toContain(token);
    expect(expectMatchesSchema(SystemEmailLatestSendResponseSchema, preview.json()).htmlBody).toContain('href="#"');
    expect(copied.statusCode).toBe(200);
    const copy = await getPrisma().emailMessage.findFirstOrThrow({
      where: { recipientUserId: rootAdmin.user.id, templateKey: 'CONTEST_STARTED_SUMMARY' },
      orderBy: { createdAt: 'desc' },
    });
    expect(`${copy.htmlBody ?? ''}${copy.textBody ?? ''}`).not.toContain(token);
    // Sent, and dated after the member's send: still not a send of the email.
    await deliverQueuedIntegrationEmail();
    await getPrisma().emailMessage.update({ where: { id: copy.id }, data: { sentAt: ahead(50) } });
    expect(emailOf(await listEmails(), 'CONTEST_STARTED_SUMMARY')).toEqual(before);
    expect(before.lastSentAt).toBe(sentAt.toISOString());
    expect((await latestSend('CONTEST_STARTED_SUMMARY')).json()).toMatchObject({ sentAt: sentAt.toISOString() });
  });

  it('answers 404 SYSTEM_EMAIL_NOT_SENT and queues nothing for an email never sent', async () => {
    await getPrisma().emailMessage.deleteMany({ where: { templateKey: 'CONTEST_EXPANDED' } });
    const before = await getPrisma().emailMessage.count({ where: { recipientUserId: rootAdmin.user.id } });

    const response = await sendToMe('CONTEST_EXPANDED');

    expect(response.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.parse(response.json())).toMatchObject({ error: { code: 'SYSTEM_EMAIL_NOT_SENT' } });
    expect(await getPrisma().emailMessage.count({ where: { recipientUserId: rootAdmin.user.id } })).toBe(before);
  });

  it('refuses a member who is not a root admin with 403', async () => {
    const member = await createTestUser();

    expect((await sendToMe('CONTEST_STANDINGS', member.headers)).statusCode).toBe(403);
  });
});

describe('system email route rate limit', () => {
  it('answers reads up to the minute\'s limit, then 429 SYSTEM_EMAIL_RATE_LIMITED for that address only', async () => {
    const read = (remoteAddress: string) => getApp().inject({
      method: 'GET',
      url: '/api/v1/platform/emails/',
      headers: rootAdmin.headers,
      remoteAddress,
    });

    for (let index = 0; index < SYSTEM_EMAIL_REQUESTS_PER_MINUTE; index += 1) {
      // A request at a time, as the page makes them.
      expect((await read('10.0.3.7')).statusCode).toBe(200);
    }

    const over = await read('10.0.3.7');
    expect(over.statusCode).toBe(429);
    expect(ErrorEnvelopeSchema.parse(over.json())).toMatchObject({ error: { code: 'SYSTEM_EMAIL_RATE_LIMITED' } });
    expect((await read('10.0.3.8')).statusCode).toBe(200);
  });
});
