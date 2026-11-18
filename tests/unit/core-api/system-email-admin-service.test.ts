import { EmailMessageStatus, EmailTemplateKey, LeaguePlan, type User } from '@poolmaster/shared/domain';
import type { EmailConfig, PlanConfig } from '@poolmaster/shared/dto';
import {
  EMAIL_SETTINGS,
  EmailService,
  SystemEmailAdminService,
  SystemEmailNotSentError,
  SystemEmailRequesterNotFoundError,
} from '../../../packages/core-api/src/modules/email';
import { PlanEntitlementsService } from '../../../packages/core-api/src/modules/plans/plan-entitlements-service';
import { PLAN_SETTINGS } from '../../../packages/core-api/src/modules/plans/plan-settings';
import { fakeLogger } from '../../support/fake-logger';
import { TEST_PLAN_ENTITLEMENTS, TEST_UNSUBSCRIBE } from '../../support/email-service';
import {
  inMemoryEmailMessages,
  inMemoryEmailOptOuts,
  inMemoryEmailSuppressions,
  type InMemoryEmailMessages,
} from '../../support/in-memory-email-messages';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const ADMIN: User = {
  id: 'admin-1',
  firstName: 'Testing',
  lastName: 'Admin',
  username: 'testing-admin',
  email: 'admin@gmail.com',
  isActive: true,
  isRootAdmin: true,
  createdAt: NOW,
  updatedAt: NOW,
};

function emailConfig(overrides: Partial<EmailConfig> = {}): EmailConfig {
  return { ...EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }), ...overrides };
}

/** Puts one email in the outbox as the sender leaves it: sent at `sentAt`, content kept unless cleared. */
async function seedSent(
  outbox: InMemoryEmailMessages,
  templateKey: EmailTemplateKey,
  sentAt: Date,
  options: { id?: string; status?: EmailMessageStatus; cleared?: boolean; recipient?: string } = {},
) {
  const about = options.id ?? `${templateKey}-${sentAt.toISOString()}`;
  const { message } = await outbox.record({
    templateKey,
    recipientEmail: options.recipient ?? 'member@gmail.com',
    idempotencyKey: `${templateKey}:${about}`,
    fromName: 'Office League',
    fromAddress: 'office24@qa.example.com',
    status: EmailMessageStatus.QUEUED,
    subject: `Subject of ${about}`,
    textBody: `Text of ${about}`,
    htmlBody: `<p>HTML of ${about}</p>`,
    dueAt: sentAt,
  });
  await outbox.markSent(message.id, { sentAt, clearContent: options.cleared ?? false });
  if (options.status) Object.assign(outbox.rows.find((row) => row.id === message.id) ?? {}, { status: options.status });
  return message.id;
}

function adminService(options: {
  outbox?: InMemoryEmailMessages;
  readConfig?: () => EmailConfig;
  readPlanConfig?: () => PlanConfig;
  users?: User[];
} = {}) {
  const outbox = options.outbox ?? inMemoryEmailMessages(() => NOW);
  const readConfig = options.readConfig ?? (() => emailConfig());
  const email = new EmailService({
    messages: outbox,
    suppressions: inMemoryEmailSuppressions(),
    optOuts: inMemoryEmailOptOuts(),
    unsubscribe: TEST_UNSUBSCRIBE,
    providerName: 'smtp',
    readConfig,
    planEntitlements: TEST_PLAN_ENTITLEMENTS,
    senderAddress: 'noreply@qa.example.com',
    logger: fakeLogger(),
    now: () => NOW,
  });
  const users = options.users ?? [ADMIN];
  return new SystemEmailAdminService({
    messages: outbox,
    users: { findById: (id) => Promise.resolve(users.find((user) => user.id === id) ?? null) },
    email,
    planEntitlements: new PlanEntitlementsService({
      leagues: { findById: () => Promise.resolve(null) },
      readConfig: options.readPlanConfig ?? (() => PLAN_SETTINGS.defaults({})),
    }),
    readConfig,
    now: () => NOW,
  });
}

describe('system email admin service: the emails list', () => {
  it('lists every template key once, in EmailTemplateKey order, with none sent when the outbox is empty', async () => {
    const emails = await adminService().list();

    expect(emails.map((email) => email.templateKey)).toEqual(Object.values(EmailTemplateKey));
    expect(emails.every((email) => email.sentCount === 0 && email.lastSentAt === undefined && email.previewSentAt === undefined)).toBe(true);
  });

  it('counts each email\'s sends of the last 30 days, leaving out older sends, and dates the last one', async () => {
    const outbox = inMemoryEmailMessages(() => NOW);
    await seedSent(outbox, 'CONTEST_RESULTS', daysAgo(1));
    await seedSent(outbox, 'CONTEST_RESULTS', daysAgo(3));
    await seedSent(outbox, 'CONTEST_RESULTS', daysAgo(31));
    await seedSent(outbox, 'LEAGUE_JOIN_SUCCESS', daysAgo(2));

    const emails = await adminService({ outbox }).list();

    expect(emails.find((email) => email.templateKey === 'CONTEST_RESULTS')).toMatchObject({ sentCount: 2, lastSentAt: daysAgo(1) });
    expect(emails.find((email) => email.templateKey === 'LEAGUE_JOIN_SUCCESS')).toMatchObject({ sentCount: 1, lastSentAt: daysAgo(2) });
  });

  it('dates the preview by the newest send that still keeps its content, and has none when every send was cleared', async () => {
    const outbox = inMemoryEmailMessages(() => NOW);
    await seedSent(outbox, 'CONTEST_RESULTS', daysAgo(1), { cleared: true });
    await seedSent(outbox, 'CONTEST_RESULTS', daysAgo(4));
    await seedSent(outbox, 'PASSWORD_RESET', daysAgo(1), { cleared: true });

    const emails = await adminService({ outbox }).list();

    expect(emails.find((email) => email.templateKey === 'CONTEST_RESULTS')).toMatchObject({ lastSentAt: daysAgo(1), previewSentAt: daysAgo(4) });
    expect(emails.find((email) => email.templateKey === 'PASSWORD_RESET')).toMatchObject({ sentCount: 1, previewSentAt: undefined });
  });

  it('shows an email ON or OFF by its own switch, and ALWAYS_ON when it has no switch', async () => {
    const readConfig = () => emailConfig({ templates: { ...emailConfig().templates, CONTEST_STANDINGS: false } });

    const emails = await adminService({ readConfig }).list();
    const statusOf = (key: EmailTemplateKey) => emails.find((email) => email.templateKey === key)?.status;

    expect(statusOf('CONTEST_RESULTS')).toBe('ON');
    expect(statusOf('CONTEST_STANDINGS')).toBe('OFF');
    expect(statusOf('PASSWORD_RESET')).toBe('ALWAYS_ON');
    expect(statusOf('EMAIL_TEST')).toBe('ALWAYS_ON');
  });

  it('names each email\'s plan feature and the plan it starts at under the current plan settings, and null for an email every league gets', async () => {
    const defaults = PLAN_SETTINGS.defaults({});
    const readPlanConfig = () => ({ ...defaults, features: { ...defaults.features, EMAIL_CONTEST_STANDINGS: LeaguePlan.PREMIUM } });

    const emails = await adminService({ readPlanConfig }).list();

    expect(emails.find((email) => email.templateKey === 'CONTEST_STANDINGS')).toMatchObject({
      planFeature: 'EMAIL_CONTEST_STANDINGS',
      planStartsAt: 'PREMIUM',
    });
    expect(emails.find((email) => email.templateKey === 'LEAGUE_MEMBER_INVITE')).toMatchObject({ planFeature: null, planStartsAt: null });
  });
});

describe('system email admin service: the latest send', () => {
  it('answers the newest send that keeps its content, passing over a newer one whose content was cleared', async () => {
    const outbox = inMemoryEmailMessages(() => NOW);
    const kept = await seedSent(outbox, 'CONTEST_RESULTS', daysAgo(2), { id: 'kept' });
    await seedSent(outbox, 'CONTEST_RESULTS', daysAgo(1), { id: 'cleared', cleared: true });

    const latest = await adminService({ outbox }).latestSend('CONTEST_RESULTS');

    expect(latest).toMatchObject({ id: kept, subject: 'Subject of kept', htmlBody: '<p>HTML of kept</p>', sentAt: daysAgo(2) });
  });

  it('throws SystemEmailNotSentError (404 SYSTEM_EMAIL_NOT_SENT) for an email never sent', async () => {
    const outbox = inMemoryEmailMessages(() => NOW);
    await seedSent(outbox, 'CONTEST_RESULTS', daysAgo(1));

    await expect(adminService({ outbox }).latestSend('CONTEST_STANDINGS')).rejects.toMatchObject({
      constructor: SystemEmailNotSentError,
      statusCode: 404,
      code: 'SYSTEM_EMAIL_NOT_SENT',
    });
  });
});

describe('system email admin service: send me this email', () => {
  it('queues a copy of the latest send to the calling admin\'s own address, a new email each press', async () => {
    const outbox = inMemoryEmailMessages(() => NOW);
    await seedSent(outbox, 'CONTEST_RESULTS', daysAgo(1), { id: 'latest' });
    const service = adminService({ outbox });

    const first = await service.sendLatestTo('CONTEST_RESULTS', ADMIN.id);
    const second = await service.sendLatestTo('CONTEST_RESULTS', ADMIN.id);

    expect(first.status).toBe('QUEUED');
    expect(second.id).not.toBe(first.id);
    const copies = outbox.rows.filter((row) => row.recipientEmail === ADMIN.email);
    expect(copies).toHaveLength(2);
    expect(copies[0]).toMatchObject({
      templateKey: 'CONTEST_RESULTS',
      recipientUserId: ADMIN.id,
      subject: 'Subject of latest',
      htmlBody: '<p>HTML of latest</p>',
    });
  });

  it('throws SystemEmailNotSentError and queues nothing when the email was never sent', async () => {
    const outbox = inMemoryEmailMessages(() => NOW);

    await expect(adminService({ outbox }).sendLatestTo('CONTEST_RESULTS', ADMIN.id)).rejects.toBeInstanceOf(SystemEmailNotSentError);
    expect(outbox.rows).toHaveLength(0);
  });

  it('throws SystemEmailRequesterNotFoundError (404 USER_NOT_FOUND) when the admin\'s account is gone', async () => {
    const outbox = inMemoryEmailMessages(() => NOW);
    await seedSent(outbox, 'CONTEST_RESULTS', daysAgo(1));

    await expect(adminService({ outbox, users: [] }).sendLatestTo('CONTEST_RESULTS', ADMIN.id)).rejects.toMatchObject({
      constructor: SystemEmailRequesterNotFoundError,
      code: 'USER_NOT_FOUND',
    });
  });
});
