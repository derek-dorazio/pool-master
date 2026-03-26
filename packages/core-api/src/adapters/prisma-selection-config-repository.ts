/**
 * Prisma adapter for SelectionConfigRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { SelectionConfigRepository } from '@poolmaster/shared/db';
import type { SelectionConfig } from '@poolmaster/shared/domain';

export class PrismaSelectionConfigRepository implements SelectionConfigRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByContest(contestId: string): Promise<SelectionConfig | null> {
    const row = await this.prisma.selectionConfig.findUnique({
      where: { contestId },
    });
    return row ? mapToSelectionConfig(row) : null;
  }

  async create(
    config: Omit<SelectionConfig, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SelectionConfig> {
    const row = await this.prisma.selectionConfig.create({
      data: {
        contestId: config.contestId,
        selectionType: config.selectionType,
        draftMode: config.draftMode,
        rounds: config.rounds,
        timePerPickSeconds: config.timePerPickSeconds,
        autoPickPolicy: config.autoPickPolicy,
        tierConfig: config.tierConfig as object[] | undefined,
        tierAssignmentMethod: config.tierAssignmentMethod,
        budget: config.budget,
        pricingMethod: config.pricingMethod,
        rosterSize: config.rosterSize,
        pickCount: config.pickCount,
        survivorStyle: config.survivorStyle,
        picksPerPeriod: config.picksPerPeriod,
        oneEntityPerSeason: config.oneEntityPerSeason,
        strikesBeforeElimination: config.strikesBeforeElimination,
        buybacksAllowed: config.buybacksAllowed,
        roundValues: config.roundValues as number[] | undefined,
        startRound: config.startRound,
        isExclusive: config.isExclusive,
        bestBallN: config.bestBallN,
        missedCutPenalty: config.missedCutPenalty,
        captainSlot: config.captainSlot,
        captainMultiplier: config.captainMultiplier,
      },
    });
    return mapToSelectionConfig(row);
  }

  async update(id: string, updates: Partial<SelectionConfig>): Promise<SelectionConfig> {
    const row = await this.prisma.selectionConfig.update({
      where: { id },
      data: {
        ...(updates.draftMode !== undefined && { draftMode: updates.draftMode }),
        ...(updates.rounds !== undefined && { rounds: updates.rounds }),
        ...(updates.timePerPickSeconds !== undefined && { timePerPickSeconds: updates.timePerPickSeconds }),
        ...(updates.autoPickPolicy !== undefined && { autoPickPolicy: updates.autoPickPolicy }),
        ...(updates.isExclusive !== undefined && { isExclusive: updates.isExclusive }),
      },
    });
    return mapToSelectionConfig(row);
  }
}

function mapToSelectionConfig(row: Record<string, unknown>): SelectionConfig {
  return {
    id: row.id as string,
    contestId: row.contestId as string,
    selectionType: row.selectionType as SelectionConfig['selectionType'],
    draftMode: (row.draftMode as SelectionConfig['draftMode']) ?? undefined,
    rounds: (row.rounds as number) ?? undefined,
    timePerPickSeconds: (row.timePerPickSeconds as number) ?? undefined,
    autoPickPolicy: (row.autoPickPolicy as string) ?? undefined,
    tierConfig: (row.tierConfig as SelectionConfig['tierConfig']) ?? undefined,
    tierAssignmentMethod: (row.tierAssignmentMethod as SelectionConfig['tierAssignmentMethod']) ?? undefined,
    budget: (row.budget as number) ?? undefined,
    pricingMethod: (row.pricingMethod as SelectionConfig['pricingMethod']) ?? undefined,
    rosterSize: (row.rosterSize as number) ?? undefined,
    pickCount: (row.pickCount as number) ?? undefined,
    survivorStyle: (row.survivorStyle as SelectionConfig['survivorStyle']) ?? undefined,
    picksPerPeriod: (row.picksPerPeriod as number) ?? undefined,
    oneEntityPerSeason: (row.oneEntityPerSeason as boolean) ?? undefined,
    strikesBeforeElimination: (row.strikesBeforeElimination as number) ?? undefined,
    buybacksAllowed: (row.buybacksAllowed as boolean) ?? undefined,
    roundValues: (row.roundValues as number[]) ?? undefined,
    startRound: (row.startRound as string) ?? undefined,
    isExclusive: row.isExclusive as boolean,
    bestBallN: (row.bestBallN as number) ?? undefined,
    missedCutPenalty: (row.missedCutPenalty as number) ?? undefined,
    captainSlot: (row.captainSlot as boolean) ?? undefined,
    captainMultiplier: (row.captainMultiplier as number) ?? undefined,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}
