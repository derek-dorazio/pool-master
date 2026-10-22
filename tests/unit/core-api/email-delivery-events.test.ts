import { EmailDeliveryEvents } from '../../../packages/core-api/src/modules/email';
import { fakeLogger } from '../../support/fake-logger';
import {
  inMemoryEmailMessages,
  inMemoryEmailSuppressions,
  type InMemoryEmailMessages,
} from '../../support/in-memory-email-messages';
import { complaint, permanentBounce, sesEvent } from '../../support/sns-messages';

const SES_ID = 'ses-message-1';

async function sentEmail(outbox: InMemoryEmailMessages, to = 'member@gmail.com'): Promise<string> {
  const { message } = await outbox.record({
    status: 'QUEUED',
    templateKey: 'LEAGUE_MEMBER_INVITE',
    recipientEmail: to,
    invitationId: 'invite-1',
    idempotencyKey: `LEAGUE_MEMBER_INVITE:invite-1:${to}`,
    fromName: 'Office League',
    fromAddress: 'office24@qa.example.com',
    subject: 'Casey invited you',
    textBody: 'Join',
    htmlBody: '<p>Join</p>',
    dueAt: new Date(),
  });
  await outbox.markSent(message.id, { providerMessageId: SES_ID, sentAt: new Date(), clearContent: false });
  return message.id;
}

function setup() {
  const outbox = inMemoryEmailMessages();
  const suppressions = inMemoryEmailSuppressions();
  const logger = fakeLogger();
  const events = new EmailDeliveryEvents({ messages: outbox, suppressions, logger });
  return { outbox, suppressions, logger, events };
}

describe('SES delivery events', () => {
  it('marks a sent email DELIVERED when SES reports it reached the mail server, and suppresses nothing', async () => {
    const { outbox, suppressions, events } = setup();
    const id = await sentEmail(outbox);

    await events.record(sesEvent('Delivery', SES_ID));

    expect(outbox.rows.find((row) => row.id === id)?.status).toBe('DELIVERED');
    expect(suppressions.rows).toHaveLength(0);
  });

  it('on a permanent bounce, marks the email BOUNCED with the bounce type and suppresses the address, lower-cased', async () => {
    const { outbox, suppressions, events } = setup();
    const id = await sentEmail(outbox);

    await events.record(permanentBounce(SES_ID, 'Member@Gmail.com'));

    expect(outbox.rows.find((row) => row.id === id)).toMatchObject({ status: 'BOUNCED', lastError: 'Bounced: Permanent (General)' });
    expect(suppressions.rows).toEqual([expect.objectContaining({ email: 'member@gmail.com', suppressionReason: 'BOUNCE', emailMessageId: id })]);
  });

  it('on a complaint, marks the email COMPLAINED and suppresses the address, even after it was delivered', async () => {
    const { outbox, suppressions, events } = setup();
    const id = await sentEmail(outbox);

    await events.record(sesEvent('Delivery', SES_ID));
    await events.record(complaint(SES_ID, 'member@gmail.com'));

    expect(outbox.rows.find((row) => row.id === id)?.status).toBe('COMPLAINED');
    expect(suppressions.rows).toEqual([expect.objectContaining({ email: 'member@gmail.com', suppressionReason: 'COMPLAINT' })]);
  });

  it('only logs a transient bounce, since SES retries it, leaving the email SENT and the address emailable', async () => {
    const { outbox, suppressions, logger, events } = setup();
    const id = await sentEmail(outbox);

    await events.record(sesEvent('Bounce', SES_ID, {
      bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull', bouncedRecipients: [{ emailAddress: 'member@gmail.com' }] },
    }));

    expect(outbox.rows.find((row) => row.id === id)?.status).toBe('SENT');
    expect(suppressions.rows).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.deliveryEvent.transientBounce' }),
      expect.any(String),
    );
  });

  it('marks a rejected email FAILED with SES\'s reason', async () => {
    const { outbox, events } = setup();
    const id = await sentEmail(outbox);

    await events.record(sesEvent('Reject', SES_ID, { reject: { reason: 'Bad content' } }));

    expect(outbox.rows.find((row) => row.id === id)).toMatchObject({ status: 'FAILED', lastError: 'Rejected by SES: Bad content' });
  });

  it('never moves an email backwards: a delivery that arrives after a bounce leaves it BOUNCED', async () => {
    const { outbox, events } = setup();
    const id = await sentEmail(outbox);

    await events.record(permanentBounce(SES_ID, 'member@gmail.com'));
    await events.record(sesEvent('Delivery', SES_ID));

    expect(outbox.rows.find((row) => row.id === id)?.status).toBe('BOUNCED');
  });

  it('still suppresses a bounced address when the email is not one this outbox sent, and logs ids but no address', async () => {
    const { suppressions, logger, events } = setup();

    await events.record(permanentBounce('another-environments-id', 'stranger@gmail.com'));

    expect(suppressions.rows).toEqual([expect.objectContaining({ email: 'stranger@gmail.com', emailMessageId: undefined })]);
    expect(JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls])).not.toContain('stranger@gmail.com');
  });

  it('drops an event it cannot read, or of a kind it does not handle, with a warning and no change', async () => {
    const { outbox, suppressions, logger, events } = setup();
    const id = await sentEmail(outbox);

    await events.record('not json');
    await events.record(JSON.stringify({ eventType: 'Open', mail: { messageId: SES_ID } }));

    expect(outbox.rows.find((row) => row.id === id)?.status).toBe('SENT');
    expect(suppressions.rows).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
