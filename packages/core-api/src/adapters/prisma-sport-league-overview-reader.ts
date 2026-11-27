/**
 * Prisma adapter for the root admin's sport league overview (#1847, #1865): every sport league's facts
 * in a fixed number of grouped reads, however many leagues, events and runs there are. groupBy
 * cannot group through a relation, so event reads group by series and the series are folded into
 * their sport league here.
 */
import type { PrismaClient } from '@prisma/client';
import type {
  SportLeagueFailedSync,
  SportLeagueOverviewFacts,
  SportLeagueOverviewReader,
} from '@poolmaster/shared/db';
import { AutoReleaseCheckOutcome, ProviderSyncFindingKind, ProviderSyncFindingStatus, SportEventStatus } from '@poolmaster/shared/domain';
import { readOverdueCandidates } from './prisma-overdue-event-reads';
import { SYNC_PROVIDER_SELECT, syncProviderIdOf, syncProviderNameOf } from './prisma-sync-provider';

export class PrismaSportLeagueOverviewReader implements SportLeagueOverviewReader {
  constructor(private readonly prisma: PrismaClient) {}

  async readFacts(now: Date): Promise<SportLeagueOverviewFacts> {
    const notCancelled = { not: SportEventStatus.CANCELLED };
    const [leagues, leaguesWithRuns, failedSyncs, heldEvents, countGroups, nextGroups, overdueCandidates, findingGroups] = await Promise.all([
      this.prisma.sportLeague.findMany({
        select: {
          id: true,
          name: true,
          ...SYNC_PROVIDER_SELECT,
          isActive: true,
          sport: { select: { sport: true, urlSegment: true, displayOrder: true } },
          currentSeason: { select: { startsAt: true, endsAt: true } },
        },
      }),
      // The leagues with any run, on the (sport league, kind, created at) index.
      this.prisma.sportLeague.findMany({ where: { syncRuns: { some: {} } }, select: { id: true } }),
      this.failedSyncs(),
      this.prisma.sportEvent.findMany({
        where: { status: SportEventStatus.DRAFT, autoReleaseOutcome: AutoReleaseCheckOutcome.HELD },
        select: { id: true, name: true, sportLeagueSeasonId: true, autoReleaseCheckedAt: true, autoReleaseFailedChecks: true },
      }),
      this.prisma.sportEvent.groupBy({
        by: ['sportLeagueSeasonId'],
        _count: { _all: true },
      }),
      this.prisma.sportEvent.groupBy({
        by: ['sportLeagueSeasonId'],
        where: { status: notCancelled, startDate: { gt: now } },
        _min: { startDate: true },
      }),
      readOverdueCandidates(this.prisma, now),
      // Each league's OPEN sync findings by severity (#1999), on the (league, status, severity) index.
      // A failed sync whose run is kept is counted by the Sync chip instead (#2092).
      this.prisma.providerSyncFinding.groupBy({
        by: ['sportLeagueId', 'severity'],
        where: { status: ProviderSyncFindingStatus.OPEN, NOT: { kind: ProviderSyncFindingKind.SYNC_FAILED, syncRunId: { not: null } } },
        _count: { _all: true },
      }),
    ]);
    // Read after the events, so every Season an event read named is already there: a Season is
    // written before its events.
    const leagueOfSeason = seasonLeagues(await this.prisma.sportLeagueSeason.findMany({ select: { id: true, sportLeagueId: true } }));

    return {
      leagues: leagues.map((league) => ({
        id: league.id,
        name: league.name,
        isActive: league.isActive,
        sport: league.sport.sport,
        sportUrlSegment: league.sport.urlSegment,
        sportDisplayOrder: league.sport.displayOrder,
        syncProviderId: syncProviderIdOf(league),
        syncProviderName: syncProviderNameOf(league),
      })),
      leaguesWithSyncRuns: new Set(leaguesWithRuns.map((league) => league.id)),
      failedSyncs,
      heldEvents: heldEvents.flatMap((event) => {
        // The check constraint sets the time with the outcome.
        if (event.autoReleaseCheckedAt === null) return [];
        return [{ id: event.id, sportLeagueId: leagueOfSeason(event.sportLeagueSeasonId), name: event.name, checkedAt: event.autoReleaseCheckedAt, failedChecks: event.autoReleaseFailedChecks }];
      }),
      eventCounts: eventCounts(countGroups, leagueOfSeason),
      currentSeasonSpans: new Map(leagues.flatMap((league) => (league.currentSeason === null
        ? []
        : [[league.id, { start: league.currentSeason.startsAt, end: league.currentSeason.endsAt }] as const]))),
      nextEventStarts: earliestByLeague(nextGroups, leagueOfSeason),
      overdueCandidates,
      openFindings: findingGroups.map((group) => ({ sportLeagueId: group.sportLeagueId, severity: group.severity, count: group._count._all })),
    };
  }

  /** Every OPEN SYNC_FAILED finding (#2092), with its latest failed run while it is kept. */
  private async failedSyncs(): Promise<SportLeagueFailedSync[]> {
    const rows = await this.prisma.providerSyncFinding.findMany({
      where: { kind: ProviderSyncFindingKind.SYNC_FAILED, status: ProviderSyncFindingStatus.OPEN },
      select: { sportLeagueId: true, syncKind: true, lastSeenAt: true, syncRun: { select: { id: true, summary: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => {
      // The migration's check gives every SYNC_FAILED finding its sync kind.
      if (row.syncKind === null) throw new Error(`A SYNC_FAILED finding of sport league ${row.sportLeagueId} has no sync kind`);
      return {
        sportLeagueId: row.sportLeagueId,
        syncKind: row.syncKind,
        lastFailedAt: row.lastSeenAt,
        run: row.syncRun === null ? null : { id: row.syncRun.id, summary: row.syncRun.summary === '' ? null : row.syncRun.summary },
      };
    });
  }
}

/** Finds a Season's sport league among every Season read. */
type LeagueOfSeason = (sportLeagueSeasonId: string) => string;

/** Every Season is read, and every event belongs to one, so a Season missing here is a broken read. */
function seasonLeagues(seasons: readonly { id: string; sportLeagueId: string }[]): LeagueOfSeason {
  const leagueOfSeason = new Map(seasons.map((row) => [row.id, row.sportLeagueId]));
  return (sportLeagueSeasonId) => {
    const sportLeagueId = leagueOfSeason.get(sportLeagueSeasonId);
    if (sportLeagueId === undefined) throw new Error(`Season ${sportLeagueSeasonId} was not read with the sport leagues`);
    return sportLeagueId;
  };
}

function eventCounts(groups: readonly { sportLeagueSeasonId: string; _count: { _all: number } }[], leagueOfSeason: LeagueOfSeason): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const sportLeagueId = leagueOfSeason(group.sportLeagueSeasonId);
    counts.set(sportLeagueId, (counts.get(sportLeagueId) ?? 0) + group._count._all);
  }
  return counts;
}

function earliestByLeague(
  groups: readonly { sportLeagueSeasonId: string; _min: { startDate: Date | null } }[],
  leagueOfSeason: LeagueOfSeason,
): Map<string, Date> {
  const earliest = new Map<string, Date>();
  for (const group of groups) {
    const startDate = group._min.startDate;
    if (startDate === null) continue;
    const sportLeagueId = leagueOfSeason(group.sportLeagueSeasonId);
    const known = earliest.get(sportLeagueId);
    if (known === undefined || startDate < known) earliest.set(sportLeagueId, startDate);
  }
  return earliest;
}

