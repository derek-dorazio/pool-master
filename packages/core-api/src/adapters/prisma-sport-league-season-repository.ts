/**
 * Prisma adapter for a sport league's Seasons (#2003): what the events sync reads of them, and the
 * daily current-Season recompute's reads and writes, and its slots as an event create reads them.
 * Seasons are added by migration, so nothing here creates one; a labelled test slot is added here
 * (#2004).
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  SeasonSlotWithEvent,
  SportLeagueCurrentSeasonFacts,
  SportLeagueSeasonRepository,
  SyncableSportLeagueSeason,
  TestSeasonSlotCreate,
  TestSlotCreateResult,
} from '@poolmaster/shared/db';
import type { SportLeagueSeason } from '@poolmaster/shared/domain';
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
}
