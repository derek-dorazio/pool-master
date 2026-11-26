/**
 * Prisma adapter for a league's NAME_PATTERN slot definitions (#2011): what "link to existing" on
 * a SLOT_NAME_UNMATCHED finding offers, and the pattern it adds. Definitions are set by migration;
 * only their patterns are added here.
 */
import { Prisma, PrismaSlotProviderMatchType, type PrismaClient } from '@prisma/client';
import type { SlotNamePatternChoices, SlotNamePatternRepository } from '@poolmaster/shared/db';

export class PrismaSlotNamePatternRepository implements SlotNamePatternRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findChoices(sportLeagueId: string, providerId: string): Promise<SlotNamePatternChoices | null> {
    // The mapping the league's sync reads, and only when it is the finding's Provider's: a league
    // may map several leagues of one Provider, and a pattern on another would never be read.
    const league = await this.prisma.sportLeague.findUnique({
      where: { id: sportLeagueId },
      select: { selectedProviderMapping: { select: {
        id: true,
        providerLeague: { select: { providerId: true } },
        slotMappings: {
          where: { matchType: PrismaSlotProviderMatchType.NAME_PATTERN, providerValue: { not: null } },
          select: { providerValue: true, slot: { select: { id: true, key: true, slotKind: true, weekNumber: true, name: true } } },
          orderBy: [{ slot: { key: 'asc' } }, { providerValue: 'asc' }],
        },
      } } },
    });
    const mapping = league?.selectedProviderMapping ?? null;
    if (mapping === null || mapping.providerLeague.providerId !== providerId) return null;
    const slots = new Map<string, SlotNamePatternChoices['slots'][number]>();
    for (const row of mapping.slotMappings) {
      const choice = slots.get(row.slot.id) ?? { slotDefinitionId: row.slot.id, key: row.slot.key, slotKind: row.slot.slotKind, weekNumber: row.slot.weekNumber, name: row.slot.name, patterns: [] };
      if (row.providerValue !== null) choice.patterns.push(row.providerValue);
      slots.set(row.slot.id, choice);
    }
    return { sportLeagueProviderMappingId: mapping.id, slots: [...slots.values()] };
  }

  async addPattern(input: { sportLeagueId: string; sportLeagueProviderMappingId: string; slotDefinitionId: string; pattern: string }): Promise<'ADDED' | 'TAKEN'> {
    try {
      await this.prisma.sportLeagueCompetitionSlotProviderMapping.create({
        data: {
          sportLeagueId: input.sportLeagueId,
          sportLeagueCompetitionSlotId: input.slotDefinitionId,
          sportLeagueProviderMappingId: input.sportLeagueProviderMappingId,
          matchType: PrismaSlotProviderMatchType.NAME_PATTERN,
          providerValue: input.pattern,
        },
        select: { id: true },
      });
      return 'ADDED';
    } catch (error) {
      // The mappings' unique key on provider mapping, match type and value.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'TAKEN';
      throw error;
    }
  }
}
