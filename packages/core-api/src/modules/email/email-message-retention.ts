/**
 * Email retention (#1175): the outbox keeps a row for every email, sent or not, and its content
 * is cleared after 7 days (EmailSender). The nightly cleanup deletes the rows themselves once
 * they are EMAIL_MESSAGES_KEPT_DAYS old. A row must outlive every "already told?" check that
 * reads it, or a sweep would send its email again. The longest is the plan preview's 30-day
 * reminder, checked daily until the 7-day one is due: about 22 days after its row is written.
 * Shorten this below that and leagues are reminded again.
 */

import type { EmailMessageRepository } from '@poolmaster/shared/db';
import { deleteInBatches, type NightlyCleanupStep } from '../../core/nightly-cleanup';

export const EMAIL_MESSAGES_KEPT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export class EmailMessageRetention implements NightlyCleanupStep {
  readonly name = 'emailMessages';

  constructor(private readonly messages: Pick<EmailMessageRepository, 'deleteBatchCreatedBefore'>) {}

  purge(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - EMAIL_MESSAGES_KEPT_DAYS * DAY_MS);
    return deleteInBatches((limit) => this.messages.deleteBatchCreatedBefore(cutoff, limit));
  }
}
