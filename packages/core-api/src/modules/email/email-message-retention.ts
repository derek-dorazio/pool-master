/**
 * Email retention (#1175): the outbox keeps a row for every email, sent or not, and its content
 * is cleared after 30 days (EmailSender). The nightly cleanup deletes the rows themselves once
 * they are EMAIL_MESSAGES_KEPT_MONTHS old. No notice looks back that far: the outbox's
 * idempotency and "already sent" checks reach back days or weeks.
 */

import type { EmailMessageRepository } from '@poolmaster/shared/db';
import { deleteInBatches, type NightlyCleanupStep } from '../../core/nightly-cleanup';

export const EMAIL_MESSAGES_KEPT_MONTHS = 13;

export class EmailMessageRetention implements NightlyCleanupStep {
  readonly name = 'emailMessages';

  constructor(private readonly messages: Pick<EmailMessageRepository, 'deleteBatchCreatedBefore'>) {}

  purge(now: Date): Promise<number> {
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - EMAIL_MESSAGES_KEPT_MONTHS);
    return deleteInBatches((limit) => this.messages.deleteBatchCreatedBefore(cutoff, limit));
  }
}
