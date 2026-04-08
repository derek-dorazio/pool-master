import type { PrismaClient } from '@prisma/client';
import type {
  ContestEntryPrizeAward,
} from '@poolmaster/shared/domain';
import type { ScoreContestEntryResult } from './types';

export interface ReplaceContestEntryScoringResultInput {
  entryId: string;
  totalScore: number;
  standingsPosition?: number;
  isEliminated?: boolean;
  scoreResult: ScoreContestEntryResult;
  prizeAwards?: Array<
    Omit<ContestEntryPrizeAward, 'id' | 'entryId' | 'createdAt' | 'updatedAt'>
  >;
}

export class ContestEntryScoringResultService {
  constructor(private readonly prisma: PrismaClient) {}

  async replaceEntryScoringResult(
    input: ReplaceContestEntryScoringResultInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (transactionClient) => {
      const tx = transactionClient as unknown as PrismaClient;
      const existingScores = await tx.contestEntryParticipantScore.findMany({
        where: { entryId: input.entryId },
        select: { id: true },
      });

      if (existingScores.length > 0) {
        await tx.contestEntryParticipantScoreEvent.deleteMany({
          where: {
            contestEntryParticipantScoreId: {
              in: existingScores.map((score: { id: string }) => score.id),
            },
          },
        });
      }

      await tx.contestEntryParticipantScore.deleteMany({
        where: { entryId: input.entryId },
      });

      await tx.contestEntryPrizeAward.deleteMany({
        where: { entryId: input.entryId },
      });

      const scoreIdByRosterPickId = new Map<string, string>();

      for (const participantScore of input.scoreResult.participantScores) {
        const createdScore = await tx.contestEntryParticipantScore.create({
          data: {
            entryId: input.entryId,
            rosterPickId: participantScore.rosterPickId,
            pointsEarned: participantScore.pointsEarned,
          },
        });

        scoreIdByRosterPickId.set(participantScore.rosterPickId, createdScore.id);
      }

      if (input.scoreResult.scoreEvents.length > 0) {
        await tx.contestEntryParticipantScoreEvent.createMany({
          data: input.scoreResult.scoreEvents.map((event) => {
            const contestEntryParticipantScoreId = scoreIdByRosterPickId.get(
              event.rosterPickId,
            );
            if (!contestEntryParticipantScoreId) {
              throw new Error(
                `Missing participant score row for roster pick ${event.rosterPickId}`,
              );
            }

            return {
              contestEntryParticipantScoreId,
              participantContestScoringRuleId:
                event.participantContestScoringRuleId,
              points: event.points,
              detailsJson: event.detailsJson as object,
            };
          }),
        });
      }

      if (input.prizeAwards && input.prizeAwards.length > 0) {
        await tx.contestEntryPrizeAward.createMany({
          data: input.prizeAwards.map((award) => ({
            entryId: input.entryId,
            contestPrizeDefinitionId: award.contestPrizeDefinitionId,
            prizeDefinitionId: award.prizeDefinitionId,
            displayName: award.displayName,
            amount: award.amount,
            percentage: award.percentage,
            awardedAt: award.awardedAt,
          })),
        });
      }

      await tx.contestEntry.update({
        where: { id: input.entryId },
        data: {
          totalScore: input.totalScore,
          standingsPosition: input.standingsPosition ?? null,
          ...(input.isEliminated !== undefined && {
            isEliminated: input.isEliminated,
          }),
        },
      });
    });
  }
}
