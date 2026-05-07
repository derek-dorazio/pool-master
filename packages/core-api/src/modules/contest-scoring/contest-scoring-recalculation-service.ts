import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  AggregationDefinitionId,
  ContestEntryPrizeAward,
  ParticipantScoringDefinitionId,
} from '@poolmaster/shared/domain';
import { ContestEntryScoringResultService } from './contest-entry-scoring-result-service';
import {
  applyPrizeDefinition,
  type RankedContestEntry,
  type RuntimeContestPrizeDefinition,
} from './prize-definition-registry';
import { scoreContestEntry } from './score-contest-entry';
import type {
  ContestEntryAggregationRule,
  ParticipantContestScoringRule,
  ScoreableContestEntryPick,
} from './types';

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
    this.logger?.debug({
      action: 'contestScoringRecalculation.start',
      data: { contestId },
    }, 'Recalculating contest scoring');
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
      include: {
        configuration: {
          include: {
            participantScoringRules: {
              orderBy: { sortOrder: 'asc' },
            },
            entryAggregationRule: true,
            prizeDefinitions: {
              where: { active: true },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            },
          },
        },
        entries: {
          include: {
            picks: {
              include: {
                sportEventParticipant: {
                  include: {
                    sourceData: {
                      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
                    },
                  },
                },
              },
              orderBy: [{ pickedAt: 'asc' }, { id: 'asc' }],
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!contest) {
      this.logger?.warn({
        action: 'contestScoringRecalculation.missingContest',
        data: { contestId },
      }, 'Cannot recalculate missing contest');
      throw new Error(`Contest ${contestId} not found`);
    }
    if (!contest.configuration) {
      this.logger?.error({
        action: 'contestScoringRecalculation.missingConfiguration',
        data: { contestId },
      }, 'Contest is missing scoring configuration');
      throw new Error(`Contest ${contestId} is missing ContestConfiguration`);
    }
    if (!contest.configuration.entryAggregationRule) {
      this.logger?.error({
        action: 'contestScoringRecalculation.missingAggregationRule',
        data: { contestId },
      }, 'Contest is missing entry aggregation rule');
      throw new Error(
        `Contest ${contestId} is missing ContestEntryAggregationRule`,
      );
    }

    const scoringRules = contest.configuration.participantScoringRules
      .filter((rule) => rule.active)
      .map(mapParticipantContestScoringRule);
    const aggregationRule = mapContestEntryAggregationRule(
      contest.configuration.entryAggregationRule,
    );
    const prizeDefinitions = contest.configuration.prizeDefinitions.map(
      mapContestPrizeDefinition,
    );

    const scoredEntries = contest.entries.map((entry) => {
      const picks: ScoreableContestEntryPick[] = entry.picks.map((pick) => ({
        id: pick.id,
        sportEventParticipantId: pick.sportEventParticipantId,
      }));

      const result = scoreContestEntry({
        picks,
        sourceData: entry.picks.flatMap((pick) => {
          const latestSource = pick.sportEventParticipant.sourceData[0];
          if (!latestSource) {
            return [];
          }

          return [
            {
              sportEventParticipantId: pick.sportEventParticipantId,
              rawPayload: (latestSource.rawPayload ?? {}) as Record<string, unknown>,
              normalizedData: (latestSource.normalizedData ?? {}) as Record<string, unknown>,
            },
          ];
        }),
        scoringRules,
        aggregationRule,
      }, this.logger);

      return {
        entryId: entry.id,
        oldRank: entry.standingsPosition ?? 0,
        oldScore: entry.totalScore,
        result,
      };
    });

    const rankedEntries = assignRanks(
      scoredEntries.map((entry) => ({
        entryId: entry.entryId,
        totalScore: entry.result.totalScore,
      })),
    );
    const prizeAwardsByEntry = buildPrizeAwardsByEntry(prizeDefinitions, rankedEntries);

    for (const scoredEntry of scoredEntries) {
      const ranking = rankedEntries.find((entry) => entry.entryId === scoredEntry.entryId);
      if (!ranking) {
        this.logger?.error({
          action: 'contestScoringRecalculation.missingRanking',
          data: {
            contestId,
            entryId: scoredEntry.entryId,
          },
        }, 'Missing ranking for scored contest entry');
        throw new Error(`Missing ranking for entry ${scoredEntry.entryId}`);
      }

      await this.entryScoringResultService.replaceEntryScoringResult({
        entryId: scoredEntry.entryId,
        totalScore: scoredEntry.result.totalScore,
        standingsPosition: ranking.rank,
        isEliminated: false,
        scoreResult: scoredEntry.result,
        prizeAwards: prizeAwardsByEntry.get(scoredEntry.entryId) ?? [],
      });
    }

    const changes = scoredEntries
      .map((entry) => {
        const ranking = rankedEntries.find((ranked) => ranked.entryId === entry.entryId);
        if (!ranking) {
          return null;
        }

        if (
          entry.oldRank === ranking.rank &&
          entry.oldScore === entry.result.totalScore
        ) {
          return null;
        }

        return {
          entryId: entry.entryId,
          oldRank: entry.oldRank,
          newRank: ranking.rank,
          oldScore: entry.oldScore,
          newScore: entry.result.totalScore,
        };
      })
      .filter((change): change is ContestScoringRecalculationChange => Boolean(change));

    const recalculationResult = {
      contestId,
      teamsAffected: changes.length,
      standingsChanged: changes.length > 0,
      changes,
    };
    this.logger?.info({
      action: 'contestScoringRecalculation.success',
      data: {
        contestId,
        entryCount: scoredEntries.length,
        teamsAffected: recalculationResult.teamsAffected,
        standingsChanged: recalculationResult.standingsChanged,
      },
    }, 'Recalculated contest scoring');
    return recalculationResult;
  }
}

function assignRanks(
  entries: Array<{ entryId: string; totalScore: number }>,
): RankedContestEntry[] {
  const sorted = [...entries].sort((left, right) => {
    if (left.totalScore !== right.totalScore) {
      return right.totalScore - left.totalScore;
    }

    return left.entryId.localeCompare(right.entryId);
  });

  let currentRank = 1;
  return sorted.map((entry, index) => {
    if (index > 0 && entry.totalScore !== sorted[index - 1]!.totalScore) {
      currentRank = index + 1;
    }

    return {
      entryId: entry.entryId,
      totalScore: entry.totalScore,
      rank: currentRank,
    };
  });
}

function buildPrizeAwardsByEntry(
  prizeDefinitions: RuntimeContestPrizeDefinition[],
  rankedEntries: RankedContestEntry[],
): Map<
  string,
  Array<Omit<ContestEntryPrizeAward, 'id' | 'entryId' | 'createdAt' | 'updatedAt'>>
> {
  const awardsByEntry = new Map<
    string,
    Array<Omit<ContestEntryPrizeAward, 'id' | 'entryId' | 'createdAt' | 'updatedAt'>>
  >();

  for (const contestPrizeDefinition of prizeDefinitions.filter((definition) => definition.active)) {
    const awards = applyPrizeDefinition({
      contestPrizeDefinition,
      rankedEntries,
    });

    for (const award of awards) {
      const entryAwards = awardsByEntry.get(award.entryId) ?? [];
      entryAwards.push({
        contestPrizeDefinitionId: award.contestPrizeDefinitionId,
        prizeDefinitionId: award.prizeDefinitionId,
        displayName: award.displayName,
        amount: award.amount,
        percentage: award.percentage,
        awardedAt: award.awardedAt,
      });
      awardsByEntry.set(award.entryId, entryAwards);
    }
  }

  return awardsByEntry;
}

function mapParticipantContestScoringRule(row: {
  id: string;
  participantScoringDefinitionId: string;
  sortOrder: number;
  config: unknown;
  active: boolean;
}): ParticipantContestScoringRule {
  return {
    id: row.id,
    participantScoringDefinitionId:
      row.participantScoringDefinitionId as ParticipantScoringDefinitionId,
    sortOrder: row.sortOrder,
    config: (row.config ?? {}) as Record<string, unknown>,
    active: row.active,
  };
}

function mapContestEntryAggregationRule(row: {
  id: string;
  aggregationDefinitionId: string;
  config: unknown;
  active: boolean;
}): ContestEntryAggregationRule {
  return {
    id: row.id,
    aggregationDefinitionId:
      row.aggregationDefinitionId as AggregationDefinitionId,
    config: (row.config ?? {}) as Record<string, unknown>,
    active: row.active,
  };
}

function mapContestPrizeDefinition(row: {
  id: string;
  prizeDefinitionId: string;
  displayName: string;
  sortOrder: number;
  ruleConfig: unknown;
  payoutType: string | null;
  amount: number | null;
  percentage: number | null;
  active: boolean;
}): RuntimeContestPrizeDefinition {
  return {
    id: row.id,
    prizeDefinitionId: row.prizeDefinitionId,
    displayName: row.displayName,
    sortOrder: row.sortOrder,
    ruleConfig: (row.ruleConfig ?? {}) as Record<string, unknown>,
    payoutType: (row.payoutType ?? undefined) as RuntimeContestPrizeDefinition['payoutType'],
    amount: row.amount ?? undefined,
    percentage: row.percentage ?? undefined,
    active: row.active,
  };
}
