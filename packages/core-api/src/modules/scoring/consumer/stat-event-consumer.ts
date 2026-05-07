/**
 * StatEventConsumer — bridges incoming stat events to the new scoring system.
 *
 * For each stat event:
 * 1. Finds active/locked contests containing the participant on a roster
 * 2. Recalculates affected contests through ContestScoringRecalculationService
 * 3. Publishes score.updated events for changed entries
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { ContestStatus } from '@poolmaster/shared/domain';
import type { EventBus } from '@poolmaster/shared/events/event-bus';
import type { StatEvent } from '@poolmaster/shared/events/scoring';
import { ContestScoringRecalculationService } from '../../contest-scoring';

export interface ContestInfo {
  contestId: string;
}

export class ContestLookup {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveContestsForParticipant(participantId: string): Promise<ContestInfo[]> {
    return this.findActiveContests({
      sportEventParticipant: {
        participantId,
      },
    });
  }

  async findActiveContestsForProviderParticipant(
    providerId: string,
    participantExternalId: string,
  ): Promise<ContestInfo[]> {
    return this.findActiveContests({
      sportEventParticipant: {
        participant: {
          providerMappings: {
            some: {
              providerId,
              externalId: participantExternalId,
            },
          },
        },
      },
    });
  }

  private async findActiveContests(
    sportEventParticipantWhere: Prisma.ContestEntryPickWhereInput,
  ): Promise<ContestInfo[]> {
    const picks = await this.prisma.contestEntryPick.findMany({
      where: {
        ...sportEventParticipantWhere,
        entry: {
          contest: {
            status: {
              in: [ContestStatus.ACTIVE, ContestStatus.LOCKED],
            },
          },
        },
      },
      select: {
        entry: {
          select: {
            contestId: true,
          },
        },
      },
    });

    return Array.from(
      new Map(
        picks.map((pick) => [pick.entry.contestId, { contestId: pick.entry.contestId }] as const),
      ).values(),
    );
  }
}

export interface StatEventConsumerDeps {
  eventBus: EventBus;
  contestLookup: ContestLookup;
  contestScoringRecalculationService: ContestScoringRecalculationService;
}

export async function handleStatEvent(
  event: StatEvent,
  deps: StatEventConsumerDeps,
): Promise<void> {
  const contests = event.participantId
    ? await deps.contestLookup.findActiveContestsForParticipant(event.participantId)
    : await deps.contestLookup.findActiveContestsForProviderParticipant(
      event.providerId,
      event.participantExternalId,
    );

  for (const contest of contests) {
    const result = await deps.contestScoringRecalculationService.recalculateContest(
      contest.contestId,
    );

    for (const change of result.changes) {
      await deps.eventBus.publish('score.updated', {
        id: `score-${contest.contestId}-${change.entryId}-${Date.now()}`,
        type: 'score.updated',
        sourceService: 'scoring-service',
        timestamp: event.ingestedAt ?? new Date().toISOString(),
        contestId: contest.contestId,
        teamId: change.entryId,
        oldScore: change.oldScore,
        newScore: change.newScore,
        rank: change.newRank,
        rankChanged: change.oldRank !== change.newRank,
      });
    }
  }
}

export function subscribeStatEventConsumer(deps: StatEventConsumerDeps): void {
  deps.eventBus.subscribe<StatEvent>('stat.received', (event) =>
    handleStatEvent(event, deps),
  );
}
