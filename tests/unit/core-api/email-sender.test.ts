import type { EmailConfig } from '@poolmaster/shared/dto';
import type { EmailMessageRecord } from '@poolmaster/shared/db';
import {
  EMAIL_SETTINGS,
  EmailSender,
  MailDeliveryError,
  MailDeliveryThrottledError,
  type MailDeliveryMessage,
  type MailDeliveryProvider,
} from '../../../packages/core-api/src/modules/email';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';

type QueuedRecord = Extract<EmailMessageRecord, { status: 'QUEUED' }>;

const START = new Date('2026-10-22T12:00:00.000Z').getTime();
const MINUTE = 60_000;

/** A clock the test moves; `sleep` moves it too, so the rate limit's waits are visible. */
function clock() {
  let now = START;
  const sleeps: number[] = [];
  return {
    now: () => new Date(now),
    advance: (ms: number) => { now += ms; },
    sleep: (ms: number) => { sleeps.push(ms); now += ms; return Promise.resolve(); },
    sleeps,
  };
}

function queued(index: number, overrides: Partial<QueuedRecord> = {}): QueuedRecord {
  return {
    templateKey: 'LEAGUE_JOIN_SUCCESS',
    recipientUserId: `user-${String(index)}`,
    recipientEmail: `member${String(index)}@gmail.com`,
    leagueId: 'league-1',
    idempotencyKey: `LEAGUE_JOIN_SUCCESS:invite-1:user-${String(index)}`,
    fromName: 'Office League',
    fromAddress: 'office24@qa.example.com',
    status: 'QUEUED',
    subject: 'Welcome to Office League',
    textBody: `Hello member ${String(index)}`,
    htmlBody: `<p>Hello member ${String(index)}</p>`,
    dueAt: new Date(START),
    ...overrides,
  };
}

/** A password reset: a template with a 10-minute send-by window and content it doesn't keep. */
const RESET = {
  templateKey: 'PASSWORD_RESET' as const,
  leagueId: undefined,
  idempotencyKey: 'PASSWORD_RESET:reset-1:user-1',
  fromName: 'Prime Time Commissioner',
  fromAddress: 'noreply@qa.example.com',
};

function recordingTransport(fail?: (message: MailDeliveryMessage) => Error | undefined) {
  const sent: MailDeliveryMessage[] = [];
  const transport: MailDeliveryProvider = {
    providerName: 'ses',
    send: (message) => {
      const error = fail?.(message);
      if (error) return Promise.reject(error);
      sent.push(message);
      return Promise.resolve({ provider: 'ses', messageId: `ses-${String(sent.length)}` });
    },
  };
  return { transport, sent };
}

function sender(options: {
  outbox: InMemoryEmailMessages;
  transport: MailDeliveryProvider;
  time: ReturnType<typeof clock>;
  config?: Partial<EmailConfig>;
  logger?: ReturnType<typeof fakeLogger>;
}) {
  return new EmailSender({
    messages: options.outbox,
    transport: options.transport,
    readConfig: () => ({ ...EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }), ...options.config }),
    logger: options.logger ?? fakeLogger(),
    now: options.time.now,
    sleep: options.time.sleep,
  });
}

describe('email sender', () => {
  it('sends each due email as stored, from its sender to its one recipient, and records it sent with the transport\'s id', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record(queued(1));
    const { transport, sent } = recordingTransport();

    await sender({ outbox, transport, time }).drain();

    expect(sent).toEqual([{
      from: { name: 'Office League', address: 'office24@qa.example.com' },
      to: 'member1@gmail.com',
      subject: 'Welcome to Office League',
      text: 'Hello member 1',
      html: '<p>Hello member 1</p>',
      metadata: {
        templateKey: 'LEAGUE_JOIN_SUCCESS',
        leagueId: 'league-1',
        contestId: undefined,
        entryId: undefined,
        invitationId: undefined,
      },
    }]);
    expect(outbox.rows[0]).toMatchObject({ status: 'SENT', providerMessageId: 'ses-1', attempts: 1, nextAttemptAt: undefined });
    expect(outbox.rows[0].sentAt).toEqual(new Date(START));
  });

  it('clears a password reset\'s content once it is sent or given up on, and keeps other emails\' content', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    const reset = { templateKey: 'PASSWORD_RESET' as const, leagueId: undefined, fromName: 'Prime Time Commissioner', fromAddress: 'noreply@qa.example.com' };
    await outbox.record(queued(1, { ...reset, idempotencyKey: 'PASSWORD_RESET:reset-1:user-1' }));
    await outbox.record(queued(2, { ...reset, idempotencyKey: 'PASSWORD_RESET:reset-2:user-2' }));
    await outbox.record(queued(3));
    const { transport } = recordingTransport((message) => (
      message.to === 'member2@gmail.com' ? new MailDeliveryError('SES email submission failed', 'ses', new Error('Message rejected')) : undefined
    ));
    const emailSender = sender({ outbox, transport, time });

    await emailSender.drain();
    for (const delay of [1, 5, 30]) {
      time.advance(delay * MINUTE);
      await emailSender.drain();
    }

    expect(outbox.rows.map((row) => [row.templateKey, row.status, row.textBody !== undefined])).toEqual([
      ['PASSWORD_RESET', 'SENT', false],
      ['PASSWORD_RESET', 'FAILED', false],
      ['LEAGUE_JOIN_SUCCESS', 'SENT', true],
    ]);
  });

  it('leaves skipped emails and emails not yet due alone', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record({ ...queued(1), status: 'SKIPPED', skipReason: 'EMAIL_DISABLED' });
    await outbox.record(queued(2, { dueAt: new Date(START + MINUTE) }));
    const { transport, sent } = recordingTransport();

    await sender({ outbox, transport, time }).drain();

    expect(sent).toHaveLength(0);
    expect(outbox.rows.map((row) => row.status)).toEqual(['SKIPPED', 'QUEUED']);
  });

  it('sends no more than the configured rate a second, waiting out the rest of each second between batches', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    for (let index = 1; index <= 7; index++) await outbox.record(queued(index));
    const { transport, sent } = recordingTransport();

    await sender({ outbox, transport, time, config: { sendRatePerSecond: 3 } }).drain();

    expect(sent).toHaveLength(7);
    // Two full batches of three, each followed by the rest of its second; the short third batch ends the drain.
    expect(time.sleeps).toEqual([1000, 1000]);
  });

  it('retries a failed email 1, 5 and 30 minutes later, keeping the error, then marks it FAILED after the fourth try', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record(queued(1));
    const { transport, sent } = recordingTransport(() => new MailDeliveryError('SES email submission failed', 'ses', new Error('Connection reset')));
    const logger = fakeLogger();
    const emailSender = sender({ outbox, transport, time, logger });

    const dueTimes: Array<number | undefined> = [];
    for (const wait of [0, MINUTE, 5 * MINUTE, 30 * MINUTE]) {
      time.advance(wait);
      await emailSender.drain();
      dueTimes.push(outbox.rows[0].nextAttemptAt?.getTime());
    }

    expect(sent).toHaveLength(0);
    expect(dueTimes).toEqual([START + MINUTE, START + 6 * MINUTE, START + 36 * MINUTE, undefined]);
    expect(outbox.rows[0]).toMatchObject({
      status: 'FAILED',
      attempts: 4,
      lastError: 'SES email submission failed: Connection reset',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.sender.failed' }),
      expect.any(String),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('member1@gmail.com');
  });

  it('does not try a failed email again before its retry is due', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record(queued(1));
    let calls = 0;
    const { transport } = recordingTransport(() => { calls++; return new Error('down'); });
    const emailSender = sender({ outbox, transport, time });

    await emailSender.drain();
    time.advance(MINUTE - 1);
    await emailSender.drain();

    expect(calls).toBe(1);
  });

  it('puts a throttled email back a few seconds later without counting the try', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record(queued(1));
    const { transport } = recordingTransport(() => new MailDeliveryThrottledError('ses'));

    await sender({ outbox, transport, time }).drain();

    expect(outbox.rows[0]).toMatchObject({ status: 'QUEUED', attempts: 0, nextAttemptAt: new Date(START + 10_000) });
  });

  it('gives up on a password reset whose next retry would land after its 10-minute link expires, clearing its content', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record(queued(1, RESET));
    const { transport, sent } = recordingTransport(() => new MailDeliveryError('SES email submission failed', 'ses', new Error('Connection reset')));
    const logger = fakeLogger();
    const emailSender = sender({ outbox, transport, time, logger });

    const dueTimes: Array<number | undefined> = [];
    for (const wait of [0, MINUTE, 5 * MINUTE]) {
      time.advance(wait);
      await emailSender.drain();
      dueTimes.push(outbox.rows[0].nextAttemptAt?.getTime());
    }

    // Tried at +0, +1 and +6 minutes; the next retry would be at +36, long after the link died.
    expect(sent).toHaveLength(0);
    expect(dueTimes).toEqual([START + MINUTE, START + 6 * MINUTE, undefined]);
    expect(outbox.rows[0]).toMatchObject({
      status: 'FAILED',
      attempts: 3,
      lastError: 'Not sent within its send-by window',
      subject: undefined,
      textBody: undefined,
      htmlBody: undefined,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.sender.expired' }),
      expect.any(String),
    );
  });

  it('gives up on a password reset still throttled when its 10-minute window ends, instead of retrying without limit', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record(queued(1, RESET));
    const { transport, sent } = recordingTransport(() => new MailDeliveryThrottledError('ses'));
    const emailSender = sender({ outbox, transport, time });

    for (let tick = 0; tick < 70 && outbox.rows[0].status === 'QUEUED'; tick += 1) {
      await emailSender.drain();
      time.advance(10_000);
    }

    expect(sent).toHaveLength(0);
    expect(outbox.rows[0]).toMatchObject({ status: 'FAILED', textBody: undefined });
    expect(outbox.rows[0].updatedAt.getTime()).toBeLessThanOrEqual(START + 10 * MINUTE);
  });

  it('does not send a password reset claimed after its window, such as one whose claims lapsed', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record(queued(1, RESET));
    await outbox.claimDue({ now: new Date(START), limit: 10, claimUntil: new Date(START + 11 * MINUTE), firstTemplateKeys: [] });
    const { transport, sent } = recordingTransport();

    time.advance(11 * MINUTE);
    await sender({ outbox, transport, time }).drain();

    expect(sent).toHaveLength(0);
    expect(outbox.rows[0]).toMatchObject({ status: 'FAILED', lastError: 'Not sent within its send-by window' });
  });

  it('claims a password reset ahead of a backlog of emails queued before it', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    for (let index = 1; index <= 15; index += 1) await outbox.record(queued(index));
    await outbox.record(queued(99, { ...RESET, dueAt: new Date(START + 1) }));
    time.advance(1);
    const { transport, sent } = recordingTransport();

    await sender({ outbox, transport, time, config: { sendRatePerSecond: 5 } }).drain();

    expect(sent[0]?.metadata.templateKey).toBe('PASSWORD_RESET');
    expect(sent).toHaveLength(16);
  });

  it('sends an email whose claim lapsed because the task holding it stopped mid-send', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record(queued(1));
    await outbox.claimDue({ now: new Date(START), limit: 10, claimUntil: new Date(START + 5 * MINUTE), firstTemplateKeys: [] });
    const { transport, sent } = recordingTransport();
    const emailSender = sender({ outbox, transport, time });

    await emailSender.drain();
    expect(sent).toHaveLength(0);

    time.advance(5 * MINUTE);
    await emailSender.drain();
    expect(sent).toHaveLength(1);
    expect(outbox.rows[0]).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('gives up on an email whose claims keep lapsing rather than sending it again and again', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record(queued(1));
    for (let claim = 0; claim < 4; claim++) {
      await outbox.claimDue({ now: time.now(), limit: 10, claimUntil: time.now(), firstTemplateKeys: [] });
    }
    const { transport, sent } = recordingTransport();

    await sender({ outbox, transport, time }).drain();

    expect(sent).toHaveLength(0);
    expect(outbox.rows[0]).toMatchObject({ status: 'FAILED', attempts: 5 });
  });

  it('looks again before it stops when woken mid-drain, so an email queued meanwhile is sent now', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record(queued(1));
    const sent: string[] = [];
    const transport: MailDeliveryProvider = {
      providerName: 'smtp',
      send: async (message) => {
        sent.push(message.to);
        if (sent.length === 1) {
          // Another request queues an email while this one is being sent.
          await outbox.record(queued(2));
          emailSender.wake();
        }
        return { provider: 'smtp' };
      },
    };
    const emailSender = sender({ outbox, transport, time });

    await emailSender.drain();

    expect(sent).toEqual(['member1@gmail.com', 'member2@gmail.com']);
  });

  it('logs a failed pass and resolves, so the next tick tries again', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    outbox.claimDue = () => Promise.reject(new Error('database unavailable'));
    const logger = fakeLogger();

    await expect(sender({ outbox, transport: recordingTransport().transport, time, logger }).drain()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.sender.failure' }),
      expect.any(String),
    );
  });

  it('clears the subject and bodies of emails older than 30 days, at most once an hour, keeping the rows', async () => {
    const time = clock();
    const outbox = inMemoryEmailMessages(time.now);
    await outbox.record({ ...queued(1), status: 'SKIPPED', skipReason: 'EMAIL_DISABLED' });
    await outbox.record(queued(2));
    const { transport } = recordingTransport();
    const emailSender = sender({ outbox, transport, time });
    await emailSender.drain();

    time.advance(30 * 24 * 60 * MINUTE + 1);
    await outbox.record(queued(3, { dueAt: new Date(time.now().getTime() + MINUTE) }));
    await emailSender.drain();

    expect(outbox.rows.map((row) => [row.status, row.subject])).toEqual([
      ['SKIPPED', undefined],
      ['SENT', undefined],
      ['QUEUED', 'Welcome to Office League'],
    ]);
  });
});
