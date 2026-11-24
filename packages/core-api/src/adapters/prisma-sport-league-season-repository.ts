/**
 * Prisma adapter for a sport league's Seasons (#2003): what the events sync reads of them, and the
 * daily current-Season recompute's reads and writes. Seasons are added by migration, so nothing
 * here creates one.
 */
import type { PrismaClient } from '@prisma/client';
import type {
  SportLeagueCurrentSeasonFacts,
  SportLeagueSeasonRepository,
  SyncableSportLeagueSeason,
} from '@poolmaster/shared/db';
import { SportEventSyncScope, type SportLeagueSeason } from '@poolmaster/shared/domain';

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
      // A Season the sync has made an event in; slice 7 reads this from its slots instead.
      this.prisma.sportEvent.groupBy({
        by: ['sportLeagueSeasonId'],
        where: { syncScope: { not: SportEventSyncScope.NONE } },
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
}
