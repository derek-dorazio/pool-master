import {
  EMAIL_SETTINGS,
  EmailSender,
  EmailService,
  UnsubscribeTokens,
  type EmailServiceOptions,
  type MailDeliveryProvider,
} from '../../packages/core-api/src/modules/email';
import {
  inMemoryEmailMessages,
  inMemoryEmailOptOuts,
  inMemoryEmailSuppressions,
  type InMemoryEmailMessages,
} from './in-memory-email-messages';

const pendingDeliveries: Promise<void>[] = [];

/** What a test EmailService builds its "Stop these emails" links from. */
export const TEST_UNSUBSCRIBE: EmailServiceOptions['unsubscribe'] = {
  tokens: new UnsubscribeTokens('test-unsubscribe-secret'),
  appBaseUrl: 'https://app.example.test',
};

/**
 * The real EmailService and EmailSender over an in-memory outbox and a test transport, with
 * EMAIL_CONFIG at its everywhere-but-QA defaults (every email on, no allow list). Each queued
 * email wakes the sender, as in the app; `deliverQueuedEmail()` waits for it to reach the
 * transport, so a test can assert on what was sent.
 */
export function emailServiceOver(
  transport: MailDeliveryProvider,
  messages: InMemoryEmailMessages = inMemoryEmailMessages(),
): EmailService {
  const readConfig = () => EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' });
  const sender = new EmailSender({ messages, transport, readConfig });
  return new EmailService({
    messages,
    suppressions: inMemoryEmailSuppressions(),
    optOuts: inMemoryEmailOptOuts(),
    unsubscribe: TEST_UNSUBSCRIBE,
    providerName: transport.providerName,
    readConfig,
    senderAddress: 'noreply@poolmaster.test',
    onQueued: () => { pendingDeliveries.push(sender.drain()); },
  });
}

/** Waits until every email queued through `emailServiceOver` has been handed to its transport. */
export async function deliverQueuedEmail(): Promise<void> {
  while (pendingDeliveries.length > 0) {
    await Promise.all(pendingDeliveries.splice(0));
  }
}

/**
 * The real EmailService queueing into an in-memory outbox and sending nothing, with EMAIL_CONFIG
 * at its everywhere-but-QA defaults. For a test that asserts on what was queued.
 */
export function emailServiceInto(messages: InMemoryEmailMessages = inMemoryEmailMessages()): EmailService {
  const config = EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' });
  return new EmailService({
    messages,
    suppressions: inMemoryEmailSuppressions(),
    optOuts: inMemoryEmailOptOuts(),
    unsubscribe: TEST_UNSUBSCRIBE,
    providerName: 'smtp',
    readConfig: () => config,
    senderAddress: 'noreply@poolmaster.test',
  });
}
