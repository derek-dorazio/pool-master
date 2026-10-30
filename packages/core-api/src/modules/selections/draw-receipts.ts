/**
 * Quick pick receipts (#867), sent by the lifecycle sweep rather than in the draw's request
 * (#1171). A draw marks itself as owing its entries their receipts; each sweep, under the sweep's
 * job lock, sends every marked draw's receipts and clears the marks. A receipt may so arrive up
 * to one sweep, five minutes, after the draw.
 *
 * Each receipt is sent once: its outbox idempotency key is the entry, the event and the entry's
 * time, so a sweep that sends and then fails to clear a mark sends nothing new the next time. A
 * draw whose receipts could not be queued keeps its mark, and the next sweep tries again.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ContestRepository } from '@poolmaster/shared/db';
import type { DueNotifications } from '../events/event-lifecycle-scheduler';
import type { SelectionService } from './service';

export interface DrawReceiptsDeps {
  contests: Pick<ContestRepository, 'findDrawReceiptsPending' | 'clearDrawReceiptsPending'>;
  selections: Pick<SelectionService, 'sendDrawReceipts'>;
  logger?: FastifyBaseLogger;
}

export class DrawReceipts implements DueNotifications {
  constructor(private readonly deps: DrawReceiptsDeps) {}

  async queueDue(): Promise<void> {
    const contestIds = await this.deps.contests.findDrawReceiptsPending();
    if (contestIds.length === 0) return;
    const sent: string[] = [];
    // A draw is one contest's: its context is the contest's own, read once for all its entries.
    // Draws are a commissioner's press, so a sweep finds few.
    for (const contestId of contestIds) {
      try {
        await this.deps.selections.sendDrawReceipts(contestId);
        sent.push(contestId);
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.drawReceipts.failed',
          data: { contestId, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue a quick pick draw\'s receipts; the next sweep tries again');
      }
    }
    await this.deps.contests.clearDrawReceiptsPending(sent);
    this.deps.logger?.info({
      action: 'email.drawReceipts.sent',
      data: { contestIds: sent, failedCount: contestIds.length - sent.length },
    }, 'Queued quick pick draws\' receipts');
  }
}
