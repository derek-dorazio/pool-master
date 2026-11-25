/**
 * Prisma adapter for a sport league's Seasons (#2003): what the events sync reads of them, and the
 * daily current-Season recompute's reads and writes, and its slots as an event create reads them.
 * Seasons are added by migration, so nothing here creates one; a labelled test slot is added here
 * (#2004).
 */
import { Prisma, PrismaSlotProviderMatchType, type PrismaClient } from '@prisma/client';
import type {
  NameMatchedSlotsRecord,
  SeasonSlotWithEvent,
  SportLeagueCurrentSeasonFacts,
  SportLeagueSeasonRepository,
  SyncedSlotsRecord,
  SyncableSportLeagueSeason,
  TestSeasonSlotCreate,
  TestSlotCreateResult,
} from '@poolmaster/shared/db';
import type { SlotNamePattern, SportLeagueSeason, SyncSeasonSlot } from '@poolmaster/shared/domain';
import { SEASON_SLOT_SELECT, toSeasonSlot, type SeasonSlotRow } from './season-slot-select';

const SEASON_SELECT = { id: true, sportLeagueId: true, name: true, championshipYear: true, startsAt: true, endsAt: true } as const;

export class PrismaSportLeagueSeasonRepository implements SportLeagueSeasonRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<SportLeagueSeason | null> {
    return this.prisma.sportLeagueSeason.findUnique({ where: { id }, select: SEASON_SELECT });
  }

  async findForSync(sportLeagueId: string, sportLeagueProviderMappingId: string): Promise<SyncableSportLeagueSeason[]> {
    const rows = await this.prisma.sportLeagueSeason.findMany({
      where: { sportLeagueId },
      select: {
        ...SEASON_SELECT,
        providerMappings: { where: { sportLeagueProviderMappingId }, select: { providerSeasonId: true } },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(({ providerMappings, ...season }) => ({ ...season, providerSeasonId: providerMappings.at(0)?.providerSeasonId ?? null }));
  }

  async findCurrentSeasonFacts(): Promise<SportLeagueCurrentSeasonFacts[]> {
    const [leagues, seasons, synced] = await Promise.all([
      this.prisma.sportLeague.findMany({ select: { id: true, currentSeasonId: true }, orderBy: { id: 'asc' } }),
      this.prisma.sportLeagueSeason.findMany({ select: { id: true, sportLeagueId: true, startsAt: true, endsAt: true } }),
      // A Season the sync has made an event in: one with a provider id (#2004).
      this.prisma.sportEvent.groupBy({
        by: ['sportLeagueSeasonId'],
        where: { providerMappings: { some: {} } },
      }),
    ]);
    const withSyncedEvent = new Set(synced.map((group) => group.sportLeagueSeasonId));
    return leagues.map((league) => ({
      sportLeagueId: league.id,
      currentSeasonId: league.currentSeasonId,
      seasons: seasons
        .filter((season) => season.sportLeagueId === league.id)
        .map((season) => ({ id: season.id, startsAt: season.startsAt, endsAt: season.endsAt, hasSyncedEvent: withSyncedEvent.has(season.id) })),
    }));
  }

  async setCurrentSeasons(changes: ReadonlyArray<{ sportLeagueId: string; currentSeasonId: string | null }>): Promise<void> {
    if (changes.length === 0) return;
    // poolmaster-allow-query-in-loop: one update per league whose current Season moved, each to its own value; a handful a day, at a Season's turn
    await this.prisma.$transaction(changes.map((change) => this.prisma.sportLeague.update({
      where: { id: change.sportLeagueId },
      data: { currentSeasonId: change.currentSeasonId },
      select: { id: true },
    })));
  }

  async findSlot(seasonSlotId: string): Promise<SeasonSlotWithEvent | null> {
    const row = await this.prisma.sportLeagueSeasonPhaseSlot.findUnique({
      where: { id: seasonSlotId },
      select: { ...SEASON_SLOT_SELECT, sportLeagueId: true, sportLeagueSeasonId: true, eventSlot: { select: { sportEventId: true } } },
    });
    if (row === null) return null;
    const { sportLeagueId, sportLeagueSeasonId, eventSlot, ...slot } = row;
    return { slot: toSeasonSlot(slot), sportLeagueId, sportLeagueSeasonId, sportEventId: eventSlot?.sportEventId ?? null };
  }

  async createTestSlot(input: TestSeasonSlotCreate): Promise<TestSlotCreateResult> {
    const definition = await this.prisma.sportLeaguePhaseSlot.findFirst({
      where: { id: input.slotDefinitionId, sportLeagueId: input.sportLeagueId },
      select: { sportLeaguePhaseId: true, seriesFormat: true, seriesGames: true, pairing: true },
    });
    if (definition === null) return { outcome: 'DEFINITION_NOT_FOUND' };
    const phase = await this.prisma.sportLeagueSeasonPhase.findUnique({
      where: { sportLeagueSeasonId_sportLeaguePhaseId: { sportLeagueSeasonId: input.sportLeagueSeasonId, sportLeaguePhaseId: definition.sportLeaguePhaseId } },
      select: { id: true },
    });
    if (phase === null) return { outcome: 'PHASE_NOT_IN_SEASON' };
    let row: SeasonSlotRow;
    try {
      row = await this.prisma.sportLeagueSeasonPhaseSlot.create({
        data: {
          sportLeagueId: input.sportLeagueId,
          sportLeagueSeasonId: input.sportLeagueSeasonId,
          sportLeagueSeasonPhaseId: phase.id,
          sportLeaguePhaseSlotId: input.slotDefinitionId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          seriesFormat: definition.seriesFormat,
          seriesGames: definition.seriesGames,
          pairing: definition.pairing,
          isTestData: true,
          label: input.label,
        },
        select: SEASON_SLOT_SELECT,
      });
    } catch (error) {
      // The Season's unique key on its definition and label.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { outcome: 'LABEL_TAKEN' };
      throw error;
    }
    return { outcome: 'CREATED', slot: toSeasonSlot(row) };
  }

  async findSyncSlots(sportLeagueSeasonId: string, sportLeagueProviderMappingId: string): Promise<SyncSeasonSlot[]> {
    const rows = await this.prisma.sportLeagueSeasonPhaseSlot.findMany({
      where: { sportLeagueSeasonId, isTestData: false },
      select: {
        id: true,
        sportLeaguePhaseSlotId: true,
        startsAt: true,
        endsAt: true,
        eventSlot: { select: { sportEventId: true } },
        providerLinks: { where: { sportLeagueProviderMappingId }, select: { providerValue: true } },
        definition: {
          select: {
            providerMappings: {
              where: { sportLeagueProviderMappingId, matchType: PrismaSlotProviderMatchType.PROVIDER_CODE },
              select: { providerValue: true },
            },
            _count: { select: { templateSlots: { where: { template: { active: true } } } } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      seasonSlotId: row.id,
      slotDefinitionId: row.sportLeaguePhaseSlotId,
      // A slot has one PROVIDER_CODE row per provider mapping (the mappings' partial unique key).
      providerCode: row.definition.providerMappings.at(0)?.providerValue ?? null,
      // A Season slot has one link per provider mapping (the links' unique key).
      linkedCode: row.providerLinks.at(0)?.providerValue ?? null,
      coveredByTemplate: row.definition._count.templateSlots > 0,
      sportEventId: row.eventSlot?.sportEventId ?? null,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    }));
  }

  async findSlotNamePatterns(sportLeagueProviderMappingId: string): Promise<SlotNamePattern[]> {
    const rows = await this.prisma.sportLeaguePhaseSlotProviderMapping.findMany({
      where: { sportLeagueProviderMappingId, matchType: PrismaSlotProviderMatchType.NAME_PATTERN, providerValue: { not: null } },
      select: { sportLeaguePhaseSlotId: true, providerValue: true },
      orderBy: { id: 'asc' },
    });
    return rows.flatMap((row) => (row.providerValue === null ? [] : [{ slotDefinitionId: row.sportLeaguePhaseSlotId, pattern: row.providerValue }]));
  }

  async linkNameMatchedSlots(input: NameMatchedSlotsRecord): Promise<{ phaseMissing: string[] }> {
    if (input.links.length === 0 && input.creates.length === 0) return { phaseMissing: [] };
    const { sportLeagueId, sportLeagueSeasonId, sportLeagueProviderMappingId } = input;
    return this.prisma.$transaction(async (tx) => {
      const definitionIds = input.creates.map((create) => create.slotDefinitionId);
      const [definitions, phases] = definitionIds.length === 0 ? [[], []] : await Promise.all([
        tx.sportLeaguePhaseSlot.findMany({
          where: { sportLeagueId, id: { in: definitionIds } },
          select: { id: true, sportLeaguePhaseId: true, seriesFormat: true, seriesGames: true, pairing: true },
        }),
        tx.sportLeagueSeasonPhase.findMany({ where: { sportLeagueSeasonId }, select: { id: true, sportLeaguePhaseId: true } }),
      ]);
      const seasonPhaseIdByPhase = new Map(phases.map((phase) => [phase.sportLeaguePhaseId, phase.id]));
      const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
      const creatable = input.creates.flatMap((create) => {
        const definition = definitionById.get(create.slotDefinitionId);
        const seasonPhaseId = definition === undefined ? undefined : seasonPhaseIdByPhase.get(definition.sportLeaguePhaseId);
        return definition === undefined || seasonPhaseId === undefined ? [] : [{ create, definition, seasonPhaseId }];
      });
      const created = creatable.length === 0 ? [] : await tx.sportLeagueSeasonPhaseSlot.createManyAndReturn({
        data: creatable.map(({ definition, seasonPhaseId }) => ({
          sportLeagueId,
          sportLeagueSeasonId,
          sportLeagueSeasonPhaseId: seasonPhaseId,
          sportLeaguePhaseSlotId: definition.id,
          seriesFormat: definition.seriesFormat,
          seriesGames: definition.seriesGames,
          pairing: definition.pairing,
        })),
        select: { id: true, sportLeaguePhaseSlotId: true },
      });
      const codeByDefinition = new Map(input.creates.map((create) => [create.slotDefinitionId, create.code]));
      const links = [
        ...input.links,
        ...created.flatMap((slot) => {
          const code = codeByDefinition.get(slot.sportLeaguePhaseSlotId);
          return code === undefined ? [] : [{ seasonSlotId: slot.id, code }];
        }),
      ];
      await tx.sportLeagueSeasonPhaseSlotProviderMapping.createMany({
        data: links.map((link) => ({ sportLeagueId, sportLeagueSeasonPhaseSlotId: link.seasonSlotId, sportLeagueProviderMappingId, providerValue: link.code })),
        // A slot or a code already linked keeps its link: the links' unique keys skip it.
        skipDuplicates: true,
      });
      const made = new Set(creatable.map(({ create }) => create.slotDefinitionId));
      return { phaseMissing: input.creates.flatMap((create) => (made.has(create.slotDefinitionId) ? [] : [create.slotDefinitionId])) };
    });
  }

  async recordSyncedSlots(input: SyncedSlotsRecord): Promise<void> {
    if (input.eventSlots.length === 0 && input.slotDates.length === 0) return;
    await this.prisma.$transaction([
      // A slot that already has an event keeps it: the unique key on the Season slot skips it.
      ...(input.eventSlots.length === 0 ? [] : [this.prisma.sportEventSlot.createMany({
        data: input.eventSlots.map((row) => ({
          sportEventId: row.sportEventId,
          sportLeagueSeasonId: row.sportLeagueSeasonId,
          sportLeagueSeasonPhaseSlotId: row.seasonSlotId,
        })),
        skipDuplicates: true,
      })]),
      // poolmaster-allow-query-in-loop: one update per slot whose games moved, each to its own dates; after a Season's first sync, only the slots whose games the provider rescheduled
      ...input.slotDates.map((change) => this.prisma.sportLeagueSeasonPhaseSlot.update({
        where: { id: change.seasonSlotId },
        data: { startsAt: change.startsAt, endsAt: change.endsAt },
        select: { id: true },
      })),
    ]);
  }
}
