/**
 * Abandoned-draft retention (#1195): a draft contest that was never opened can never open once
 * its events have started, and members never saw it (#1161 hides it from the contest list). The
 * nightly cleanup deletes each one whose last event started more than ABANDONED_DRAFT_KEPT_DAYS
 * ago, with its configuration and rules. A draft with no events is kept: it has no date to age by.
 * No email goes out, since the draft was never shown to anyone but its commissioners.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ContestRepository } from '@poolmaster/shared/db';
import { deleteInBatches, type NightlyCleanupStep } from '../../core/nightly-cleanup';

/** How long after its last event started an unopened draft is kept. */
export const ABANDONED_DRAFT_KEPT_DAYS = 90;
const DAY_MS = 24 * 60 * 60_000;

export class AbandonedDraftRetention implements NightlyCleanupStep {
  readonly name = 'abandonedDraftContests';

  constructor(
    private readonly contests: Pick<ContestRepository, 'deleteAbandonedDraftsBatch'>,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async purge(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - ABANDONED_DRAFT_KEPT_DAYS * DAY_MS);
    const leagueIds = new Set<string>();
    const deleted = await deleteInBatches(async (limit) => {
      const batch = await this.contests.deleteAbandonedDraftsBatch(cutoff, limit);
      for (const draft of batch) leagueIds.add(draft.leagueId);
      return batch.length;
    });
    if (deleted > 0) {
      this.logger?.info({
        action: 'nightlyCleanup.abandonedDraftContests.deleted',
        data: { deleted, leagueIds: [...leagueIds] },
      }, 'Deleted abandoned draft contests');
    }
    return deleted;
  }
}
