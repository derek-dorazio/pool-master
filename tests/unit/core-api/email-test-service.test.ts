import { EmailMessageStatus } from '@poolmaster/shared/domain';
import {
  EMAIL_SETTINGS,
  EmailSender,
  EmailService,
  EmailTestService,
  MailDeliveryError,
  type MailDeliveryMessage,
  type MailDeliveryProvider,
} from '../../../packages/core-api/src/modules/email';
import { fakeLogger } from '../../support/fake-logger';
import { TEST_UNSUBSCRIBE } from '../../support/email-service';
import {
  inMemoryEmailMessages,
  inMemoryEmailOptOuts,
  inMemoryEmailSuppressions,
} from '../../support/in-memory-email-messages';

const NOW = new Date('2026-10-23T16:20:00.000Z');
const ADMIN = { id: 'admin-1', firstName: 'Testing', lastName: 'Admin', username: 'testing-admin', email: 'admin@example.com' };

function testService(send: MailDeliveryProvider['send'], now: () => Date = () => NOW) {
  const messages = inMemoryEmailMessages(now);
  const readConfig = () => EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' });
  const transport: MailDeliveryProvider = { providerName: 'ses', send };
  const sender = new EmailSender({ messages, transport, readConfig, logger: fakeLogger(), now });
  const email = new EmailService({
    messages,
    suppressions: inMemoryEmailSuppressions(),
    optOuts: inMemoryEmailOptOuts(),
    unsubscribe: TEST_UNSUBSCRIBE,
    providerName: 'ses',
    readConfig,
    senderAddress: 'noreply@qa.example.com',
    now,
  });
  const users = { findById: (id: string) => Promise.resolve(id === ADMIN.id ? ADMIN : undefined) };
  return new EmailTestService({ email, sender, messages, users, environment: 'qa', now });
}

describe('the root admin test email', () => {
  it('sends one email to the address, from the app, naming the admin and the environment, and returns it SENT', async () => {
    const sent: MailDeliveryMessage[] = [];
    const service = testService((message) => {
      sent.push(message);
      return Promise.resolve({ provider: 'ses', messageId: 'ses-1' });
    });

    const result = await service.send('derek@gmail.com', ADMIN.id);

    expect(result.status).toBe(EmailMessageStatus.SENT);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'derek@gmail.com',
      from: { name: 'Prime Time Commissioner', address: 'noreply@qa.example.com' },
      subject: 'Prime Time Commissioner test email (qa)',
    });
    expect(sent[0].text).toContain('Testing Admin sent this test from the qa Email settings');
  });

  it('returns the provider\'s error with the email still QUEUED for a retry when the first try fails', async () => {
    const service = testService(() => Promise.reject(new MailDeliveryError('Email address is not verified.', 'ses')));

    const result = await service.send('unverified@gmail.com', ADMIN.id);

    expect(result.status).toBe(EmailMessageStatus.QUEUED);
    expect(result.lastError).toContain('Email address is not verified.');
  });

  it('sends a new email each time it is pressed, rather than returning the first one', async () => {
    let tries = 0;
    let now = NOW.getTime();
    const service = testService(() => {
      tries++;
      return Promise.resolve({ provider: 'ses', messageId: `ses-${String(tries)}` });
    }, () => new Date(now));

    await service.send('derek@gmail.com', ADMIN.id);
    now += 1000;
    await service.send('derek@gmail.com', ADMIN.id);

    expect(tries).toBe(2);
  });
});
