/**
 * #844 — the email outbox's queries against real Postgres: recording an email once per key,
 * the skip-locked claim two core-api tasks share, each outcome the sender records, the body
 * purge, and the latest invite email per invitation.
 *
 * The emails here are due in 2000, and each claim asks for what was due by then, so a claim
 * only ever sees this file's rows.
 */
import { randomUUID } from 'node:crypto';
import type { EmailMessageRecord } from '@poolmaster/shared/db';
import type { LeagueResponse } from '@poolmaster/shared/dto';
import { PrismaEmailMessageRepository } from '../../../packages/core-api/src/adapters';
import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

type QueuedRecord = Extract<EmailMessageRecord, { status: 'QUEUED' }>;

const RUN = randomUUID().slice(0, 8);
const DUE = new Date('2000-01-01T00:00:00.000Z');
const MINUTE = 60_000;
let keyCount = 0;

function queued(overrides: Partial<QueuedRecord> = {}): QueuedRecord {
  keyCount++;
  return {
    templateKey: 'LEAGUE_MEMBER_INVITE',
    recipientEmail: `outbox-${RUN}-${String(keyCount)}@integration.test`,
    idempotencyKey: `outbox-test:${RUN}:${String(keyCount)}`,
    fromName: 'Outbox League',
    fromAddress: 'outbox@integration.test',
    status: 'QUEUED',
    subject: 'You are invited',
    textBody: 'Join us',
    htmlBody: '<p>Join us</p>',
    dueAt: DUE,
    ...overrides,
  };
}

function repository() {
  return new PrismaEmailMessageRepository(getAppPrisma());
}

beforeAll(async () => {
  await setupIntegrationTests();
});
afterEach(async () => {
  await getPrisma().emailMessage.deleteMany({ where: { idempotencyKey: { startsWith: `outbox-test:${RUN}:` } } });
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('email outbox: recording', () => {
  it('records a queued email with its content, due when asked, and records a second one with the same key as nothing new', async () => {
    const email = queued();

    const first = await repository().record(email);
    const again = await repository().record({ ...email, subject: 'Something else' });

    expect(first.created).toBe(true);
    expect(first.message).toMatchObject({
      status: 'QUEUED',
      subject: 'You are invited',
      textBody: 'Join us',
      htmlBody: '<p>Join us</p>',
      nextAttemptAt: DUE,
      attempts: 0,
    });
    expect(again).toEqual({ message: first.message, created: false });
    expect(await getPrisma().emailMessage.count({ where: { idempotencyKey: email.idempotencyKey } })).toBe(1);
  });

  it('records a skipped email with its reason and no content or due time', async () => {
    const { message } = await repository().record({ ...queued(), status: 'SKIPPED', skipReason: 'NOT_ALLOWED_IN_ENVIRONMENT' });

    expect(message).toMatchObject({ status: 'SKIPPED', skipReason: 'NOT_ALLOWED_IN_ENVIRONMENT', attempts: 0 });
    expect(message.subject).toBeUndefined();
    expect(message.nextAttemptAt).toBeUndefined();
  });

  it('refuses a skipped row without a reason, a queued row with one, and a queued row with no due time', async () => {
    const base = {
      templateKey: 'LEAGUE_MEMBER_INVITE' as const,
      recipientEmail: 'refused@integration.test',
      fromName: 'Outbox League',
      fromAddress: 'outbox@integration.test',
    };

    await expect(getPrisma().emailMessage.create({
      data: { ...base, idempotencyKey: `outbox-test:${RUN}:refused-1`, status: 'SKIPPED' },
    })).rejects.toThrow(/email_messages_skip_reason_when_skipped/);
    await expect(getPrisma().emailMessage.create({
      data: { ...base, idempotencyKey: `outbox-test:${RUN}:refused-2`, status: 'QUEUED', skipReason: 'EMAIL_DISABLED', nextAttemptAt: DUE },
    })).rejects.toThrow(/email_messages_skip_reason_when_skipped/);
    await expect(getPrisma().emailMessage.create({
      data: { ...base, idempotencyKey: `outbox-test:${RUN}:refused-3`, status: 'QUEUED' },
    })).rejects.toThrow(/email_messages_due_when_queued/);
  });
});

describe('email outbox: reading one email', () => {
  it('finds a recorded email by its id as it stands, and nothing for an id never recorded', async () => {
    const { message } = await repository().record(queued());
    await repository().markSent(message.id, { providerMessageId: `ses-find-${RUN}`, sentAt: DUE, clearContent: false });

    expect(await repository().findById(message.id)).toMatchObject({ id: message.id, status: 'SENT', providerMessageId: `ses-find-${RUN}` });
    expect(await repository().findById(randomUUID())).toBeUndefined();
  });
});

describe('email outbox: claiming', () => {
  it('claims due emails oldest due first, up to the limit, each now SENDING with one more attempt and held until the claim lapses', async () => {
    const later = await repository().record(queued({ dueAt: new Date(DUE.getTime() + MINUTE) }));
    const earlier = await repository().record(queued());
    await repository().record(queued({ dueAt: new Date(DUE.getTime() + 2 * MINUTE) }));
    const claimUntil = new Date('2030-01-01T00:00:00.000Z');

    const claimed = await repository().claimDue({ now: new Date(DUE.getTime() + 2 * MINUTE), limit: 2, claimUntil, firstTemplateKeys: [] });

    expect(claimed.map((message) => message.id).sort()).toEqual([earlier.message.id, later.message.id].sort());
    expect(claimed.every((message) => message.status === 'SENDING' && message.attempts === 1)).toBe(true);
    expect(claimed.every((message) => message.nextAttemptAt?.getTime() === claimUntil.getTime())).toBe(true);
  });

  it('claims emails of the first template keys ahead of earlier-due ones, so a reset never waits behind a backlog', async () => {
    await repository().record(queued());
    await repository().record(queued());
    const reset = await repository().record(queued({
      templateKey: 'PASSWORD_RESET',
      dueAt: new Date(DUE.getTime() + MINUTE),
    }));

    const claimed = await repository().claimDue({
      now: new Date(DUE.getTime() + MINUTE),
      limit: 1,
      claimUntil: new Date(DUE.getTime() + 6 * MINUTE),
      firstTemplateKeys: ['PASSWORD_RESET'],
    });

    expect(claimed.map((message) => message.id)).toEqual([reset.message.id]);
  });

  it('passes over skipped and sent emails and ones not yet due', async () => {
    await repository().record({ ...queued(), status: 'SKIPPED', skipReason: 'EMAIL_DISABLED' });
    const { message: sent } = await repository().record(queued());
    await repository().markSent(sent.id, { providerMessageId: 'ses-1', sentAt: DUE, clearContent: false });
    await repository().record(queued({ dueAt: new Date(DUE.getTime() + MINUTE) }));

    expect(await repository().claimDue({ now: DUE, limit: 10, claimUntil: new Date(DUE.getTime() + 5 * MINUTE), firstTemplateKeys: [] })).toEqual([]);
  });

  it('never hands the same email to two senders claiming at once', async () => {
    for (let index = 0; index < 6; index++) {
      await repository().record(queued());
    }
    const claimUntil = new Date(DUE.getTime() + 5 * MINUTE);

    const [first, second] = await Promise.all([
      repository().claimDue({ now: DUE, limit: 4, claimUntil, firstTemplateKeys: [] }),
      repository().claimDue({ now: DUE, limit: 4, claimUntil, firstTemplateKeys: [] }),
    ]);

    const ids = [...first, ...second].map((message) => message.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it('claims an email again once its claim lapses, and not before', async () => {
    const { message } = await repository().record(queued());
    const lapsesAt = new Date(DUE.getTime() + 5 * MINUTE);
    await repository().claimDue({ now: DUE, limit: 10, claimUntil: lapsesAt, firstTemplateKeys: [] });

    expect(await repository().claimDue({ now: new Date(lapsesAt.getTime() - 1), limit: 10, claimUntil: lapsesAt, firstTemplateKeys: [] })).toEqual([]);
    const reclaimed = await repository().claimDue({ now: lapsesAt, limit: 10, claimUntil: new Date(lapsesAt.getTime() + 5 * MINUTE), firstTemplateKeys: [] });
    expect(reclaimed.map((row) => [row.id, row.attempts])).toEqual([[message.id, 2]]);
  });
});

describe('email outbox: outcomes', () => {
  it('records a sent email with the transport\'s id and when, and no due time', async () => {
    const { message } = await repository().record(queued());
    await repository().claimDue({ now: DUE, limit: 10, claimUntil: new Date(DUE.getTime() + 5 * MINUTE), firstTemplateKeys: [] });

    await repository().markSent(message.id, { providerMessageId: 'ses-message-1', sentAt: new Date(DUE.getTime() + 1000), clearContent: false });

    const row = await getPrisma().emailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row).toMatchObject({ status: 'SENT', providerMessageId: 'ses-message-1', nextAttemptAt: null, attempts: 1 });
    expect(row.sentAt).toEqual(new Date(DUE.getTime() + 1000));
  });

  it('clears the subject and bodies with the outcome when asked, for an email that carries a secret', async () => {
    const sent = await repository().record(queued());
    const failed = await repository().record(queued());
    const kept = await repository().record(queued());
    await repository().claimDue({ now: DUE, limit: 10, claimUntil: new Date(DUE.getTime() + 5 * MINUTE), firstTemplateKeys: [] });

    await repository().markSent(sent.message.id, { sentAt: DUE, clearContent: true });
    await repository().markFailed(failed.message.id, { error: 'Message rejected', clearContent: true });
    await repository().markSent(kept.message.id, { sentAt: DUE, clearContent: false });

    const rows = await getPrisma().emailMessage.findMany({
      where: { id: { in: [sent.message.id, failed.message.id, kept.message.id] } },
    });
    const contentOf = (id: string) => {
      const row = rows.find((candidate) => candidate.id === id);
      return [row?.subject ?? null, row?.textBody ?? null, row?.htmlBody ?? null].map((value) => value !== null);
    };
    expect(contentOf(sent.message.id)).toEqual([false, false, false]);
    expect(contentOf(failed.message.id)).toEqual([false, false, false]);
    expect(contentOf(kept.message.id)).toEqual([true, true, true]);
  });

  it('puts a failed email back in the queue for its retry, keeping the error, and a throttled one without counting the try', async () => {
    const failed = await repository().record(queued());
    const throttled = await repository().record(queued());
    await repository().claimDue({ now: DUE, limit: 10, claimUntil: new Date(DUE.getTime() + 5 * MINUTE), firstTemplateKeys: [] });
    const retryAt = new Date(DUE.getTime() + MINUTE);

    await repository().markRetry(failed.message.id, { nextAttemptAt: retryAt, error: 'Connection reset' });
    await repository().markThrottled(throttled.message.id, retryAt);

    const rows = await getPrisma().emailMessage.findMany({
      where: { id: { in: [failed.message.id, throttled.message.id] } },
      orderBy: { lastError: { sort: 'asc', nulls: 'last' } },
    });
    expect(rows.map((row) => [row.status, row.attempts, row.lastError, row.nextAttemptAt?.getTime()])).toEqual([
      ['QUEUED', 1, 'Connection reset', retryAt.getTime()],
      ['QUEUED', 0, null, retryAt.getTime()],
    ]);
  });

  it('records an email that will not be sent as FAILED with its last error and no due time', async () => {
    const { message } = await repository().record(queued());
    await repository().claimDue({ now: DUE, limit: 10, claimUntil: new Date(DUE.getTime() + 5 * MINUTE), firstTemplateKeys: [] });

    await repository().markFailed(message.id, { error: 'Message rejected', clearContent: false });

    expect(await getPrisma().emailMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
      status: 'FAILED',
      lastError: 'Message rejected',
      nextAttemptAt: null,
    });
  });

  it('clears the subject and bodies of emails created in the window, and keeps the rows and the content outside it', async () => {
    const before = await repository().record(queued());
    const inside = await repository().record(queued());
    const recent = await repository().record(queued());
    await getPrisma().emailMessage.update({ where: { id: before.message.id }, data: { createdAt: new Date('1999-12-01T00:00:00.000Z') } });
    await getPrisma().emailMessage.update({ where: { id: inside.message.id }, data: { createdAt: DUE } });

    const cleared = await repository().clearContentCreatedBetween(
      new Date('1999-12-25T00:00:00.000Z'),
      new Date('2000-06-01T00:00:00.000Z'),
    );

    expect(cleared).toBe(1);
    const rows = await getPrisma().emailMessage.findMany({ where: { id: { in: [before.message.id, inside.message.id, recent.message.id] } } });
    expect(rows.find((row) => row.id === inside.message.id)).toMatchObject({ subject: null, textBody: null, htmlBody: null });
    expect(rows.find((row) => row.id === before.message.id)).toMatchObject({ subject: 'You are invited' });
    expect(rows.find((row) => row.id === recent.message.id)).toMatchObject({ subject: 'You are invited' });
  });

  it('deletes at most one batch of the emails created before the cutoff, oldest first, and keeps newer ones', async () => {
    const oldest = await repository().record(queued());
    const older = await repository().record(queued());
    const recent = await repository().record(queued());
    await getPrisma().emailMessage.update({ where: { id: oldest.message.id }, data: { createdAt: new Date('1990-11-01T00:00:00.000Z') } });
    await getPrisma().emailMessage.update({ where: { id: older.message.id }, data: { createdAt: new Date('1990-12-01T00:00:00.000Z') } });
    const cutoff = new Date('1991-01-01T00:00:00.000Z');
    const ids = [oldest.message.id, older.message.id, recent.message.id];

    expect(await repository().deleteBatchCreatedBefore(cutoff, 1)).toBe(1);
    expect((await getPrisma().emailMessage.findMany({ where: { id: { in: ids } } })).map((row) => row.id).sort())
      .toEqual([older.message.id, recent.message.id].sort());

    expect(await repository().deleteBatchCreatedBefore(cutoff, 10)).toBe(1);
    expect(await repository().deleteBatchCreatedBefore(cutoff, 10)).toBe(0);
    expect((await getPrisma().emailMessage.findMany({ where: { id: { in: ids } } })).map((row) => row.id)).toEqual([recent.message.id]);
  });
});

describe('email outbox: an invitation\'s email', () => {
  it('reports the status and skip reason of each invitation\'s latest email of the template, and nothing for an invitation with none', async () => {
    const commissioner = await createTestUser();
    const created = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: commissioner.headers,
      payload: buildCreateLeaguePayload(`Outbox League ${RUN}`),
    });
    const leagueId = created.json<LeagueResponse>().league.id;
    const [resent, sentOnce, none] = await Promise.all(['resent', 'once', 'none'].map((name) => getPrisma().leagueInvitation.create({
      data: { leagueId, email: `${name}-${RUN}@integration.test`, inviteCode: `${name}-${RUN}`, invitedBy: commissioner.user.id },
    })));
    const first = await repository().record(queued({ invitationId: resent.id, leagueId }));
    await repository().markFailed(first.message.id, { error: 'Message rejected', clearContent: false });
    await getPrisma().emailMessage.update({ where: { id: first.message.id }, data: { createdAt: DUE } });
    await repository().record(queued({ invitationId: resent.id, leagueId }));
    await repository().record({ ...queued({ invitationId: sentOnce.id, leagueId }), status: 'SKIPPED', skipReason: 'EMAIL_DISABLED' });
    await repository().record(queued({ invitationId: sentOnce.id, leagueId, templateKey: 'LEAGUE_JOIN_SUCCESS' }));

    const states = await repository().findLatestStateByInvitations([resent.id, sentOnce.id, none.id], 'LEAGUE_MEMBER_INVITE');

    expect(Object.fromEntries(states)).toEqual({
      [resent.id]: { status: 'QUEUED', skipReason: undefined },
      [sentOnce.id]: { status: 'SKIPPED', skipReason: 'EMAIL_DISABLED' },
    });
  });
});
