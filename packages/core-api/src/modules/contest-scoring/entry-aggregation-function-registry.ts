import type {
  ComputedContestEntryParticipantScore,
  ContestEntryAggregationRule,
  EntryAggregationRegistryItem,
} from './types';

interface SumTopNEntriesConfig {
  topN: number;
  lowerIsBetter?: boolean;
}

function aggregateSumAllEntries(
  participantScores: ComputedContestEntryParticipantScore[],
): number {
  return participantScores.reduce((sum, score) => sum + score.pointsEarned, 0);
}

function aggregateSumTopNEntries(
  participantScores: ComputedContestEntryParticipantScore[],
  aggregationRule: ContestEntryAggregationRule,
): number {
  const config = aggregationRule.config as unknown as SumTopNEntriesConfig;
  const sorted = [...participantScores].sort((left, right) =>
    config.lowerIsBetter
      ? left.pointsEarned - right.pointsEarned
      : right.pointsEarned - left.pointsEarned,
  );

  return sorted
    .slice(0, config.topN)
    .reduce((sum, score) => sum + score.pointsEarned, 0);
}

export const EntryAggregationFunctionRegistry: Record<
  string,
  EntryAggregationRegistryItem
> = {
  SUM_ALL_ENTRIES: {
    id: 'SUM_ALL_ENTRIES',
    name: 'Sum All Entries',
    description: 'Sums all participant totals on the contest entry.',
    aggregateEntry: (participantScores) => aggregateSumAllEntries(participantScores),
  },
  SUM_TOP_N_ENTRIES: {
    id: 'SUM_TOP_N_ENTRIES',
    name: 'Sum Top N Entries',
    description:
      'Sorts participant totals and sums the best N participant totals for the contest entry.',
    aggregateEntry: (participantScores, aggregationRule) =>
      aggregateSumTopNEntries(participantScores, aggregationRule),
  },
};

export function aggregateContestEntryScore(
  participantScores: ComputedContestEntryParticipantScore[],
  aggregationRule: ContestEntryAggregationRule,
): number {
  const definition =
    EntryAggregationFunctionRegistry[aggregationRule.aggregationDefinitionId];

  if (!definition) {
    throw new Error(
      `Unsupported aggregation definition: ${aggregationRule.aggregationDefinitionId}`,
    );
  }

  return definition.aggregateEntry(participantScores, aggregationRule);
}
