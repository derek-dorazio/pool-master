/**
 * Prisma adapter for a sport league's Seasons (#2003): what the events sync reads of them, and the
 * daily current-Season recompute's reads and writes, and its slots as an event create reads them.
 * Seasons are added by migration, so nothing here creates one; a labelled test slot is added here
 * (#2004).
 */
import { Prisma, PrismaSlotProviderMatchType, PrismaSlotWindowStatus, type PrismaClient } from '@prisma/client';
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

/** The match types that place a game by its Season slot's window (#2012, #2154). */
const WINDOW_MATCH_TYPES: readonly PrismaSlotProviderMatchType[] = [PrismaSlotProviderMatchType.DATE_WINDOW, PrismaSlotProviderMatchType.REST_OF_PHASE];

const SEASON_SELECT = { id: true, sportLeagueId: true, name: true, championshipYear: true, startsAt: true, endsAt: true } as const;
const SLOT_WITH_EVENT_SELECT = {
  ...SEASON_SLOT_SELECT,
  sportLeagueId: true,
  sportLeagueSeasonId: true,
  eventSlot: { select: { sportEventId: true } },
} as const satisfies Prisma.SportLeagueSeasonCompetitionSlotSelect;

function toSlotWithEvent(row: Prisma.SportLeagueSeasonCompetitionSlotGetPayload<{ select: typeof SLOT_WITH_EVENT_SELECT }>): SeasonSlotWithEvent {
  const { sportLeagueId, sportLeagueSeasonId, eventSlot, ...slot } = row;
  return { slot: toSeasonSlot(slot), sportLeagueId, sportLeagueSeasonId, sportEventId: eventSlot?.sportEventId ?? null };
}

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
    const row = await this.prisma.sportLeagueSeasonCompetitionSlot.findUnique({ where: { id: seasonSlotId }, select: SLOT_WITH_EVENT_SELECT });
    return row === null ? null : toSlotWithEvent(row);
  }

  async findSlotsByIds(seasonSlotIds: readonly string[]): Promise<SeasonSlotWithEvent[]> {
    if (seasonSlotIds.length === 0) return [];
    const rows = await this.prisma.sportLeagueSeasonCompetitionSlot.findMany({ where: { id: { in: [...seasonSlotIds] } }, select: SLOT_WITH_EVENT_SELECT });
    return rows.map(toSlotWithEvent);
  }

  async createTestSlot(input: TestSeasonSlotCreate): Promise<TestSlotCreateResult> {
    const definition = await this.prisma.sportLeagueCompetitionSlot.findFirst({
      where: { id: input.slotDefinitionId, sportLeagueId: input.sportLeagueId },
      select: { sportLeagueCompetitionId: true, seriesFormat: true, seriesGames: true, pairing: true },
    });
    if (definition === null) return { outcome: 'DEFINITION_NOT_FOUND' };
    const competition = await this.prisma.sportLeagueSeasonCompetition.findUnique({
      where: {
        sportLeagueSeasonId_sportLeagueCompetitionId: { sportLeagueSeasonId: input.sportLeagueSeasonId, sportLeagueCompetitionId: definition.sportLeagueCompetitionId },
      },
      select: { id: true },
    });
    if (competition === null) return { outcome: 'COMPETITION_NOT_IN_SEASON' };
    let row: SeasonSlotRow;
    try {
      row = await this.prisma.sportLeagueSeasonCompetitionSlot.create({
        data: {
          sportLeagueId: input.sportLeagueId,
          sportLeagueSeasonId: input.sportLeagueSeasonId,
          sportLeagueSeasonCompetitionId: competition.id,
          sportLeagueCompetitionSlotId: input.slotDefinitionId,
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
    const rows = await this.prisma.sportLeagueSeasonCompetitionSlot.findMany({
      where: { sportLeagueSeasonId, isTestData: false },
      select: {
        id: true,
        sportLeagueCompetitionSlotId: true,
        sportLeagueSeasonCompetitionId: true,
        seasonCompetition: { select: { competition: { select: { name: true } } } },
        startsAt: true,
        endsAt: true,
        windowStartsAt: true,
        windowEndsAt: true,
        windowStatus: true,
        eventSlot: { select: { sportEventId: true } },
        providerLinks: { where: { sportLeagueProviderMappingId }, select: { providerValue: true } },
        definition: {
          select: {
            key: true,
            providerMappings: {
              where: { sportLeagueProviderMappingId, matchType: { in: [PrismaSlotProviderMatchType.PROVIDER_CODE, ...WINDOW_MATCH_TYPES] } },
              select: { matchType: true, providerValue: true },
            },
            _count: { select: { templateSlots: { where: { template: { active: true } } } } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => {
      const mappings = row.definition.providerMappings;
      const byWindow = mappings.some((mapping) => WINDOW_MATCH_TYPES.includes(mapping.matchType));
      return {
        seasonSlotId: row.id,
        slotDefinitionId: row.sportLeagueCompetitionSlotId,
        key: row.definition.key,
        // A slot has one PROVIDER_CODE row per provider mapping (the mappings' partial unique key).
        providerCode: mappings.find((mapping) => mapping.matchType === PrismaSlotProviderMatchType.PROVIDER_CODE)?.providerValue ?? null,
        // A Season slot has one link per provider mapping (the links' unique key).
        linkedCode: row.providerLinks.at(0)?.providerValue ?? null,
        coveredByTemplate: row.definition._count.templateSlots > 0,
        sportEventId: row.eventSlot?.sportEventId ?? null,
        seasonCompetitionId: row.sportLeagueSeasonCompetitionId,
        competitionName: row.seasonCompetition.competition.name,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        placedByWindow: byWindow,
        restOfPhase: mappings.some((mapping) => mapping.matchType === PrismaSlotProviderMatchType.REST_OF_PHASE),
        // The database check sets the three window columns together.
        window: byWindow && row.windowStartsAt !== null && row.windowEndsAt !== null && row.windowStatus !== null
          ? { startsAt: row.windowStartsAt, endsAt: row.windowEndsAt, status: row.windowStatus }
          : null,
      };
    });
  }

  async findSlotNamePatterns(sportLeagueProviderMappingId: string): Promise<SlotNamePattern[]> {
    const rows = await this.prisma.sportLeagueCompetitionSlotProviderMapping.findMany({
      where: { sportLeagueProviderMappingId, matchType: PrismaSlotProviderMatchType.NAME_PATTERN, providerValue: { not: null } },
      select: { sportLeagueCompetitionSlotId: true, providerValue: true },
      orderBy: { id: 'asc' },
    });
    return rows.flatMap((row) => (row.providerValue === null ? [] : [{ slotDefinitionId: row.sportLeagueCompetitionSlotId, pattern: row.providerValue }]));
  }

  async linkNameMatchedSlots(input: NameMatchedSlotsRecord): Promise<{ competitionMissing: string[] }> {
    if (input.links.length === 0 && input.creates.length === 0) return { competitionMissing: [] };
    const { sportLeagueId, sportLeagueSeasonId, sportLeagueProviderMappingId } = input;
    return this.prisma.$transaction(async (tx) => {
      const definitionIds = input.creates.map((create) => create.slotDefinitionId);
      const [definitions, competitions] = definitionIds.length === 0 ? [[], []] : await Promise.all([
        tx.sportLeagueCompetitionSlot.findMany({
          where: { sportLeagueId, id: { in: definitionIds } },
          select: { id: true, sportLeagueCompetitionId: true, seriesFormat: true, seriesGames: true, pairing: true },
        }),
        tx.sportLeagueSeasonCompetition.findMany({ where: { sportLeagueSeasonId }, select: { id: true, sportLeagueCompetitionId: true } }),
      ]);
      const seasonCompetitionIdByCompetition = new Map(competitions.map((competition) => [competition.sportLeagueCompetitionId, competition.id]));
      const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
      const creatable = input.creates.flatMap((create) => {
        const definition = definitionById.get(create.slotDefinitionId);
        const seasonCompetitionId = definition === undefined ? undefined : seasonCompetitionIdByCompetition.get(definition.sportLeagueCompetitionId);
        return definition === undefined || seasonCompetitionId === undefined ? [] : [{ create, definition, seasonCompetitionId }];
      });
      const created = creatable.length === 0 ? [] : await tx.sportLeagueSeasonCompetitionSlot.createManyAndReturn({
        data: creatable.map(({ definition, seasonCompetitionId }) => ({
          sportLeagueId,
          sportLeagueSeasonId,
          sportLeagueSeasonCompetitionId: seasonCompetitionId,
          sportLeagueCompetitionSlotId: definition.id,
          seriesFormat: definition.seriesFormat,
          seriesGames: definition.seriesGames,
          pairing: definition.pairing,
        })),
        select: { id: true, sportLeagueCompetitionSlotId: true },
      });
      const codeByDefinition = new Map(input.creates.map((create) => [create.slotDefinitionId, create.code]));
      const links = [
        ...input.links,
        ...created.flatMap((slot) => {
          const code = codeByDefinition.get(slot.sportLeagueCompetitionSlotId);
          return code === undefined ? [] : [{ seasonSlotId: slot.id, code }];
        }),
      ];
      await tx.sportLeagueSeasonCompetitionSlotProviderMapping.createMany({
        data: links.map((link) => ({ sportLeagueId, sportLeagueSeasonCompetitionSlotId: link.seasonSlotId, sportLeagueProviderMappingId, providerValue: link.code })),
        // A slot or a code already linked keeps its link: the links' unique keys skip it.
        skipDuplicates: true,
      });
      const made = new Set(creatable.map(({ create }) => create.slotDefinitionId));
      return { competitionMissing: input.creates.flatMap((create) => (made.has(create.slotDefinitionId) ? [] : [create.slotDefinitionId])) };
    });
  }

  async recordSyncedSlots(input: SyncedSlotsRecord): Promise<void> {
    const placed = input.placedGames ?? null;
    if (input.eventSlots.length === 0 && input.slotDates.length === 0 && input.confirmedWindows.length === 0 && placed === null) return;
    const placedRows = placed === null ? [] : placed.bySlot.flatMap(({ seasonSlotId, externalIds }) => externalIds.map((externalId) => ({
      sportLeagueId: placed.sportLeagueId,
      sportLeagueSeasonCompetitionSlotId: seasonSlotId,
      sportLeagueProviderMappingId: placed.sportLeagueProviderMappingId,
      externalId,
    })));
    await this.prisma.$transaction([
      // Each listed game moves to its slot, and a listed slot keeps only its listed games (#2154).
      ...(placed === null || placed.bySlot.length === 0 ? [] : [
        this.prisma.sportLeagueSeasonCompetitionSlotGameProviderMapping.deleteMany({
          where: {
            sportLeagueProviderMappingId: placed.sportLeagueProviderMappingId,
            OR: [
              { sportLeagueSeasonCompetitionSlotId: { in: placed.bySlot.map((slot) => slot.seasonSlotId) } },
              { externalId: { in: placedRows.map((row) => row.externalId) } },
            ],
          },
        }),
        ...(placedRows.length === 0 ? [] : [this.prisma.sportLeagueSeasonCompetitionSlotGameProviderMapping.createMany({ data: placedRows })]),
      ]),
      // A slot that already has an event keeps it: the unique key on the Season slot skips it.
      ...(input.eventSlots.length === 0 ? [] : [this.prisma.sportEventSlot.createMany({
        data: input.eventSlots.map((row) => ({
          sportEventId: row.sportEventId,
          sportLeagueSeasonId: row.sportLeagueSeasonId,
          sportLeagueSeasonCompetitionSlotId: row.seasonSlotId,
        })),
        skipDuplicates: true,
      })]),
      // poolmaster-allow-query-in-loop: one update per slot whose games moved, each to its own dates; after a Season's first sync, only the slots whose games the provider rescheduled
      ...input.slotDates.map((change) => this.prisma.sportLeagueSeasonCompetitionSlot.update({
        where: { id: change.seasonSlotId },
        data: { startsAt: change.startsAt, endsAt: change.endsAt },
        select: { id: true },
      })),
      ...(input.confirmedWindows.length === 0 ? [] : [this.prisma.sportLeagueSeasonCompetitionSlot.updateMany({
        where: { id: { in: [...input.confirmedWindows] }, windowStatus: PrismaSlotWindowStatus.TENTATIVE },
        data: { windowStatus: PrismaSlotWindowStatus.CONFIRMED },
      })]),
    ]);
  }
}
