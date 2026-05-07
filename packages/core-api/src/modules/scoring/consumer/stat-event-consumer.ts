/**
 * Legacy stat-event consumer.
 *
 * pool-master-rop.78.3 — the upstream `stat.received` event was retired
 * along with the untyped `ProviderStatEvent` path (plans/117 §10.3).
 * This module previously subscribed to `stat.received`, looked up active
 * contests for the participant, and triggered
 * `ContestScoringRecalculationService.recalculateContest`. With the
 * recalculation service throwing `ContestScoringRecalculationDisabledError`
 * (rop.78.4) and no upstream emitter, the consumer is dead code.
 *
 * Reactivated by SKIP: pool-master-rop.78.7 — the rebuild slice subscribes
 * the new typed consumer to `live_score.persisted` and reads from
 * SportEventParticipantGolfRound. The legacy class shells below preserve
 * the export shape that test fixtures import; runtime behavior throws.
 */

import type { PrismaClient } from '@prisma/client';
import { ContestStatus } from '@poolmaster/shared/domain';

export interface ContestInfo {
  contestId: string;
}

/**
 * SKIP: pool-master-rop.78.7 — legacy ContestLookup retained as a shell so
 * existing test imports compile. The lookups still query Prisma, but no
 * production code path calls them after rop.78.3 retired the
 * stat.received subscription.
 */
export class ContestLookup {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveContestsForParticipant(participantId: string): Promise<ContestInfo[]> {
    const picks = await this.prisma.contestEntryPick.findMany({
      where: {
        sportEventParticipant: { participantId },
        entry: {
          contest: {
            status: { in: [ContestStatus.ACTIVE, ContestStatus.LOCKED] },
          },
        },
      },
      select: { entry: { select: { contestId: true } } },
    });
    return Array.from(
      new Map(
        picks.map((pick) => [pick.entry.contestId, { contestId: pick.entry.contestId }]),
      ).values(),
    );
  }

  async findActiveContestsForProviderParticipant(
    providerId: string,
    externalId: string,
  ): Promise<ContestInfo[]> {
    const picks = await this.prisma.contestEntryPick.findMany({
      where: {
        sportEventParticipant: {
          participant: {
            providerMappings: { some: { providerId, externalId } },
          },
        },
        entry: {
          contest: {
            status: { in: [ContestStatus.ACTIVE, ContestStatus.LOCKED] },
          },
        },
      },
      select: { entry: { select: { contestId: true } } },
    });
    return Array.from(
      new Map(
        picks.map((pick) => [pick.entry.contestId, { contestId: pick.entry.contestId }]),
      ).values(),
    );
  }
}
