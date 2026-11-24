/**
 * Prisma adapter for the root admin's sport league overview (#1847, #1865): every sport league's facts
 * in a fixed number of grouped reads, however many leagues, events and runs there are. groupBy
 * cannot group through a relation, so event reads group by series and the series are folded into
 * their sport league here.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  SportLeagueLatestSyncRun,
  SportLeagueOverviewFacts,
  SportLeagueOverviewReader,
} from '@poolmaster/shared/db';
import { AutoReleaseCheckOutcome, ProviderSyncFindingStatus, SportEventStatus } from '@poolmaster/shared/domain';
import { readOverdueCandidates } from './prisma-overdue-event-reads';
import { SYNC_PROVIDER_SELECT, syncProviderIdOf } from './prisma-sync-provider';

export class PrismaSportLeagueOverviewReader implements SportLeagueOverviewReader {
  constructor(private readonly prisma: PrismaClient) {}

  async readFacts(now: Date): Promise<SportLeagueOverviewFacts> {
    const notCancelled = { not: SportEventStatus.CANCELLED };
    const [leagues, latestSyncRuns, heldEvents, countGroups, nextGroups, overdueCandidates, findingGroups] = await Promise.all([
      this.prisma.sportLeague.findMany({
        select: {
          id: true,
          name: true,
          ...SYNC_PROVIDER_SELECT,
          isActive: true,
          sport: { select: { sport: true } },
          currentSeason: { select: { startsAt: true, endsAt: true } },
        },
      }),
      this.latestSyncRuns(),
      this.prisma.sportEvent.findMany({
        where: { status: SportEventStatus.DRAFT, autoReleaseOutcome: AutoReleaseCheckOutcome.HELD },
        select: { id: true, name: true, eventSeriesId: true, autoReleaseCheckedAt: true, autoReleaseFailedChecks: true },
      }),
      this.prisma.sportEvent.groupBy({
        by: ['eventSeriesId'],
        _count: { _all: true },
      }),
      this.prisma.sportEvent.groupBy({
        by: ['eventSeriesId'],
        where: { status: notCancelled, startDate: { gt: now } },
        _min: { startDate: true },
      }),
      readOverdueCandidates(this.prisma, now),
      // Each league's OPEN sync findings by severity (#1999), on the (league, status, severity) index.
      this.prisma.providerSyncFinding.groupBy({
        by: ['sportLeagueId', 'severity'],
        where: { status: ProviderSyncFindingStatus.OPEN },
        _count: { _all: true },
      }),
    ]);
    // Read after the events, so every series an event read named is already there: a series is
    // written before its events.
    const leagueOfSeries = seriesLeagues(await this.prisma.eventSeries.findMany({ select: { id: true, sportLeagueId: true } }));

    return {
      leagues: leagues.map((league) => ({
        id: league.id,
        name: league.name,
        isActive: league.isActive,
        sport: league.sport.sport,
        syncProviderId: syncProviderIdOf(league),
      })),
      latestSyncRuns,
      heldEvents: heldEvents.flatMap((event) => {
        // The check constraint sets the time with the outcome.
        if (event.autoReleaseCheckedAt === null) return [];
        return [{ id: event.id, sportLeagueId: leagueOfSeries(event.eventSeriesId), name: event.name, checkedAt: event.autoReleaseCheckedAt, failedChecks: event.autoReleaseFailedChecks }];
      }),
      eventCounts: eventCounts(countGroups, leagueOfSeries),
      currentSeasonSpans: new Map(leagues.flatMap((league) => (league.currentSeason === null
        ? []
        : [[league.id, { start: league.currentSeason.startsAt, end: league.currentSeason.endsAt }] as const]))),
      nextEventStarts: earliestByLeague(nextGroups, leagueOfSeries),
      overdueCandidates: overdueCandidates.map(({ eventSeriesId, ...event }) => ({ ...event, sportLeagueId: leagueOfSeries(eventSeriesId) })),
      openFindings: findingGroups.map((group) => ({ sportLeagueId: group.sportLeagueId, severity: group.severity, count: group._count._all })),
    };
  }

  /**
   * Each sport league's latest run of each sync kind: the latest time per (league, kind), then
   * those runs. Both reads use the (sport league, kind, created at) index.
   */
  private async latestSyncRuns(): Promise<SportLeagueLatestSyncRun[]> {
    const latest = await this.prisma.providerSyncRun.groupBy({
      by: ['sportLeagueId', 'kind'],
      where: { sportLeagueId: { not: null } },
      _max: { createdAt: true },
    });
    const keys = latest.flatMap((group) => (group.sportLeagueId === null || group._max.createdAt === null
      ? []
      : [{ sportLeagueId: group.sportLeagueId, kind: group.kind, createdAt: group._max.createdAt }]));
    if (keys.length === 0) return [];
    const rows = await this.prisma.providerSyncRun.findMany({
      where: { OR: keys },
      select: { id: true, sportLeagueId: true, kind: true, status: true, createdAt: true, payloadJson: true },
      orderBy: { id: 'asc' },
    });
    // Two runs written in the same instant: either is the latest; keep one.
    const byKey = new Map<string, SportLeagueLatestSyncRun>();
    for (const row of rows) {
      if (row.sportLeagueId === null) continue;
      const key = `${row.sportLeagueId}:${row.kind}`;
      if (byKey.has(key)) continue;
      byKey.set(key, { id: row.id, sportLeagueId: row.sportLeagueId, kind: row.kind, status: row.status, createdAt: row.createdAt, summary: outcomeSummary(row.payloadJson) });
    }
    return [...byKey.values()];
  }
}

/** The run's `outcome.summary`, the line the sync history shows for it. */
export function outcomeSummary(payload: Prisma.JsonValue): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const outcome = payload['outcome'];
  if (typeof outcome !== 'object' || outcome === null || Array.isArray(outcome)) return null;
  const summary = outcome['summary'];
  return typeof summary === 'string' && summary !== '' ? summary : null;
}

/** Finds an event series' sport league among every series read. */
type LeagueOfSeries = (eventSeriesId: string) => string;

/** Every series is read, and every event belongs to one, so a series missing here is a broken read. */
function seriesLeagues(series: readonly { id: string; sportLeagueId: string }[]): LeagueOfSeries {
  const leagueOfSeries = new Map(series.map((row) => [row.id, row.sportLeagueId]));
  return (eventSeriesId) => {
    const sportLeagueId = leagueOfSeries.get(eventSeriesId);
    if (sportLeagueId === undefined) throw new Error(`Event series ${eventSeriesId} was not read with the sport leagues`);
    return sportLeagueId;
  };
}

function eventCounts(groups: readonly { eventSeriesId: string; _count: { _all: number } }[], leagueOfSeries: LeagueOfSeries): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const sportLeagueId = leagueOfSeries(group.eventSeriesId);
    counts.set(sportLeagueId, (counts.get(sportLeagueId) ?? 0) + group._count._all);
  }
  return counts;
}

function earliestByLeague(
  groups: readonly { eventSeriesId: string; _min: { startDate: Date | null } }[],
  leagueOfSeries: LeagueOfSeries,
): Map<string, Date> {
  const earliest = new Map<string, Date>();
  for (const group of groups) {
    const startDate = group._min.startDate;
    if (startDate === null) continue;
    const sportLeagueId = leagueOfSeries(group.eventSeriesId);
    const known = earliest.get(sportLeagueId);
    if (known === undefined || startDate < known) earliest.set(sportLeagueId, startDate);
  }
  return earliest;
}

