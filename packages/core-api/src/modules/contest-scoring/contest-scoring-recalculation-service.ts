import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { ContestEntryScoringResultService } from './contest-entry-scoring-result-service';

export interface ContestScoringRecalculationChange {
  entryId: string;
  oldRank: number;
  newRank: number;
  oldScore: number;
  newScore: number;
}

export interface ContestScoringRecalculationResult {
  contestId: string;
  teamsAffected: number;
  standingsChanged: boolean;
  changes: ContestScoringRecalculationChange[];
}

/**
 * Raised by ContestScoringRecalculationService.recalculateContest while the
 * substrate redesign is mid-rebuild. The legacy scoring path read from the
 * dropped `sportEventParticipantSourceData` table (plans/117 §13.2);
 * rop.78.7 rebuilds it on top of SportEventParticipantGolfRound and the
 * per-(category × contestFormat) contribution table.
 *
 * Throwing here is intentional: silently feeding empty source data would
 * write zero-score results and rerank standings, corrupting any contest the
 * live-scoring pipeline or admin override service touches. Callers that
 * need scoring continuity should wait for rop.78.7.
 */
export class ContestScoringRecalculationDisabledError extends Error {
  constructor(contestId: string) {
    super(
      `Contest scoring recalculation is disabled for contest ${contestId} ` +
        `until pool-master-rop.78.7 lands the rebuilt scoring path on the ` +
        `typed substrate (plans/117 §13.2 dropped sportEventParticipantSourceData).`,
    );
    this.name = 'ContestScoringRecalculationDisabledError';
  }
}

export class ContestScoringRecalculationService {
  private readonly entryScoringResultService: ContestEntryScoringResultService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {
    this.entryScoringResultService = new ContestEntryScoringResultService(prisma, logger);
  }

  async recalculateContest(
    contestId: string,
  ): Promise<ContestScoringRecalculationResult> {
    // pool-master-rop.78.4 — the legacy aggregator read scoring inputs from
    // sportEventParticipantSourceData, which plans/117 §13.2 drops. Until
    // rop.78.7 ships the rebuilt scoring path on SportEventParticipantGolfRound
    // + the per-(category × contestFormat) contribution table, recalculation
    // would persist synthetic zero-score results and rerank standings on
    // every stat event or admin override. We throw early so callers fail
    // loudly instead of silently corrupting contest standings. The legacy
    // body has been deleted; rop.78.7 reconstitutes the recalc loop against
    // the typed substrate.
    this.logger?.warn({
      action: 'contestScoringRecalculation.disabled',
      data: { contestId },
    }, 'Contest scoring recalculation is disabled until pool-master-rop.78.7');
    throw new ContestScoringRecalculationDisabledError(contestId);
  }
}
