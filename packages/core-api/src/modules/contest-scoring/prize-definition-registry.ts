import type { ContestEntryPrizeAward } from '@poolmaster/shared/domain';

export interface RankedContestEntry {
  entryId: string;
  rank: number;
  totalScore: number;
}

export interface RuntimeContestPrizeDefinition {
  id: string;
  prizeDefinitionId: string;
  displayName: string;
  sortOrder: number;
  ruleConfig: Record<string, unknown>;
  payoutType?: 'FIXED_AMOUNT' | 'PERCENTAGE';
  amount?: number;
  percentage?: number;
  active: boolean;
}

interface PrizeApplicationContext {
  contestPrizeDefinition: RuntimeContestPrizeDefinition;
  rankedEntries: RankedContestEntry[];
}

type ApplyPrizeDefinitionFn = (
  context: PrizeApplicationContext,
) => Array<
  Omit<ContestEntryPrizeAward, 'id' | 'entryId' | 'createdAt' | 'updatedAt'> & {
    entryId: string;
  }
>;

interface PrizeDefinitionRegistryItem {
  id: string;
  name: string;
  applyAwards: ApplyPrizeDefinitionFn;
}

function applyFinalPlacePrize({
  contestPrizeDefinition,
  rankedEntries,
}: PrizeApplicationContext) {
  const place = Number((contestPrizeDefinition.ruleConfig as { place?: unknown }).place);
  if (!Number.isInteger(place) || place < 1) {
    throw new Error(
      `FINAL_PLACE prize definition ${contestPrizeDefinition.id} requires integer ruleConfig.place`,
    );
  }

  return rankedEntries
    .filter((entry) => entry.rank === place)
    .map((entry) => ({
      entryId: entry.entryId,
      contestPrizeDefinitionId: contestPrizeDefinition.id,
      prizeDefinitionId: contestPrizeDefinition.prizeDefinitionId,
      displayName: contestPrizeDefinition.displayName,
      amount: contestPrizeDefinition.amount,
      percentage: contestPrizeDefinition.percentage,
      awardedAt: new Date(),
    }));
}

export const PrizeDefinitionRegistry: Record<string, PrizeDefinitionRegistryItem> = {
  FINAL_PLACE: {
    id: 'FINAL_PLACE',
    name: 'Final Place Prize',
    applyAwards: applyFinalPlacePrize,
  },
};

export function applyPrizeDefinition(
  context: PrizeApplicationContext,
): Array<
  Omit<ContestEntryPrizeAward, 'id' | 'entryId' | 'createdAt' | 'updatedAt'> & {
    entryId: string;
  }
> {
  const definition = PrizeDefinitionRegistry[context.contestPrizeDefinition.prizeDefinitionId];
  if (!definition) {
    throw new Error(
      `Unsupported prize definition: ${context.contestPrizeDefinition.prizeDefinitionId}`,
    );
  }

  return definition.applyAwards(context);
}
