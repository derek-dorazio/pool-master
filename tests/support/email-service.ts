import {
  EMAIL_SETTINGS,
  EmailSender,
  EmailService,
  type MailDeliveryProvider,
} from '../../packages/core-api/src/modules/email';
import { inMemoryEmailMessages, type InMemoryEmailMessages } from './in-memory-email-messages';

const pendingDeliveries: Promise<void>[] = [];

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
