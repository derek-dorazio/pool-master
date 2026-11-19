/**
 * Prisma adapter for the root admin's League page (#1865): one sport league's syncs, events and
 * participants, each in a fixed number of grouped reads however many runs, events and
 * participants it has.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  SportLeagueEventFacts,
  SportLeaguePageLeague,
  SportLeaguePageParticipant,
  SportLeaguePageReader,
  SportLeaguePageRun,
  SportLeagueSyncFacts,
} from '@poolmaster/shared/db';
import { isClutchCardLeague, ProviderSyncKind, ProviderSyncRunStatus } from '@poolmaster/shared/domain';
import { readOverdueCandidates } from './prisma-overdue-event-reads';
import { outcomeSummary } from './prisma-sport-league-overview-reader';

const RUN_SELECT = { id: true, kind: true, status: true, createdAt: true, startedAt: true, payloadJson: true } as const;

export class PrismaSportLeaguePageReader implements SportLeaguePageReader {
  constructor(private readonly prisma: PrismaClient) {}

  async readSyncFacts(sportLeagueId: string): Promise<SportLeagueSyncFacts | null> {
    const league = await this.league(sportLeagueId);
    if (league === null) return null;
    const clutchCard = isClutchCardLeague(league) && league.parentSportLeagueId !== null;
    // A Clutch Card's events come from its parent's event list sync, so that run stands for its own.
    const scopes = clutchCard && league.parentSportLeagueId !== null
      ? [{ sportLeagueId, kind: { not: ProviderSyncKind.EVENTS } }, { sportLeagueId: league.parentSportLeagueId, kind: ProviderSyncKind.EVENTS }]
      : [{ sportLeagueId }];
    const latest = await this.prisma.providerSyncRun.groupBy({
      by: ['sportLeagueId', 'kind'],
      where: { OR: scopes },
      _max: { createdAt: true },
    });
    const keys = latest.flatMap((group) => (group.sportLeagueId === null || group._max.createdAt === null
      ? []
      : [{ sportLeagueId: group.sportLeagueId, kind: group.kind, createdAt: group._max.createdAt }]));
    const rows = keys.length === 0 ? [] : await this.prisma.providerSyncRun.findMany({
      where: { OR: keys },
      select: RUN_SELECT,
      orderBy: { id: 'asc' },
    });
    return { league, latestRuns: oneRunPerKind(rows.map(toRun)) };
  }

  async readEventFacts(sportLeagueId: string, now: Date): Promise<SportLeagueEventFacts | null> {
    const [league, series] = await Promise.all([
      this.league(sportLeagueId),
      this.prisma.eventSeries.findMany({ where: { sportLeagueId }, select: { id: true } }),
    ]);
    if (league === null) return null;
    const seriesIds = series.map((row) => row.id);
    const [events, overdueCandidates] = await Promise.all([
      this.prisma.sportEvent.findMany({
        where: { eventSeriesId: { in: seriesIds } },
        select: {
          id: true, name: true, eventYear: true, startDate: true, endDate: true, status: true, providerId: true, syncScope: true, releasedAt: true,
          autoReleaseCheckedAt: true, autoReleaseOutcome: true, autoReleaseFailedChecks: true,
        },
        orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      }),
      readOverdueCandidates(this.prisma, now, seriesIds),
    ]);
    const eventIds = events.map((event) => event.id);
    const [fieldGroups, latestRunGroups] = eventIds.length === 0 ? [[], []] : await Promise.all([
      this.prisma.sportEventParticipant.groupBy({ by: ['sportEventId'], where: { sportEventId: { in: eventIds } }, _count: { _all: true } }),
      this.prisma.providerSyncRun.groupBy({ by: ['sportEventId', 'kind'], where: { sportEventId: { in: eventIds } }, _max: { createdAt: true } }),
    ]);
    const keys = latestRunGroups.flatMap((group) => (group.sportEventId === null || group._max.createdAt === null
      ? []
      : [{ sportEventId: group.sportEventId, kind: group.kind, createdAt: group._max.createdAt }]));
    const runRows = keys.length === 0 ? [] : await this.prisma.providerSyncRun.findMany({
      where: { OR: keys },
      select: { ...RUN_SELECT, sportEventId: true },
      orderBy: { id: 'asc' },
    });
    const runsByEvent = new Map<string, SportLeaguePageRun[]>();
    for (const row of runRows) {
      if (row.sportEventId === null) continue;
      runsByEvent.set(row.sportEventId, [...(runsByEvent.get(row.sportEventId) ?? []), toRun(row)]);
    }
    return {
      league,
      events: events.map(({ autoReleaseCheckedAt, autoReleaseOutcome, autoReleaseFailedChecks, ...event }) => ({
        ...event,
        // The check constraint sets the time and the outcome together.
        lastReleaseCheck: autoReleaseCheckedAt === null || autoReleaseOutcome === null
          ? null
          : { checkedAt: autoReleaseCheckedAt, outcome: autoReleaseOutcome, failedChecks: autoReleaseFailedChecks },
      })),
      fieldSizes: new Map(fieldGroups.map((group) => [group.sportEventId, group._count._all])),
      latestRunsByEvent: new Map([...runsByEvent].map(([sportEventId, runs]) => [sportEventId, oneRunPerKind(runs)])),
      overdueCandidates,
    };
  }

  async readParticipants(sportLeagueId: string): Promise<SportLeaguePageParticipant[] | null> {
    const [league, participants, mappings] = await Promise.all([
      this.prisma.sportLeague.findUnique({ where: { id: sportLeagueId }, select: { id: true } }),
      this.prisma.participant.findMany({
        where: { sportLeagueId },
        select: { id: true, name: true, participantType: true, shortName: true, nationality: true, teamAffiliation: true, role: true, ranking: true, createdAt: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.participantProviderMapping.findMany({
        where: { sportLeagueId },
        select: { participantId: true, externalId: true, lastSeenAt: true, mappedAt: true },
        // Of two providers' mappings, the latest made names the participant's feed id.
        orderBy: [{ mappedAt: 'desc' }, { id: 'asc' }],
      }),
    ]);
    if (league === null) return null;
    const mappingByParticipant = new Map<string, { externalId: string; lastSeenAt: Date | null }>();
    for (const mapping of mappings) {
      if (!mappingByParticipant.has(mapping.participantId)) {
        mappingByParticipant.set(mapping.participantId, { externalId: mapping.externalId, lastSeenAt: mapping.lastSeenAt });
      }
    }
    return participants.map((participant) => ({ participant, mapping: mappingByParticipant.get(participant.id) ?? null }));
  }

  private async league(sportLeagueId: string): Promise<SportLeaguePageLeague | null> {
    const row = await this.prisma.sportLeague.findUnique({
      where: { id: sportLeagueId },
      select: {
        id: true, isActive: true, parentSportLeagueId: true, scoringFamily: true, eventSyncProviderId: true, autoReleaseDaysBeforeStart: true,
        sport: { select: { sport: true } },
        parentSportLeague: { select: { isActive: true, eventSyncProviderId: true } },
      },
    });
    if (row === null) return null;
    const { sport, parentSportLeague, ...league } = row;
    return { ...league, sport: sport.sport, parent: parentSportLeague };
  }
}

type RunRow = Prisma.ProviderSyncRunGetPayload<{ select: typeof RUN_SELECT }>;

function toRun(row: RunRow): SportLeaguePageRun {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    summary: outcomeSummary(row.payloadJson),
    changedCount: row.status === ProviderSyncRunStatus.COMPLETED ? changedCount(row.payloadJson) : null,
  };
}

/** Two runs of one kind written in the same instant: either is the latest; keep the first read. */
function oneRunPerKind(runs: readonly SportLeaguePageRun[]): SportLeaguePageRun[] {
  const byKind = new Map<string, SportLeaguePageRun>();
  for (const run of runs) if (!byKind.has(run.kind)) byKind.set(run.kind, run);
  return [...byKind.values()];
}

/** The rows a finished run created or updated, from its `stats`; null when it counted none. */
function changedCount(payload: Prisma.JsonValue): number | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const stats = payload['stats'];
  if (typeof stats !== 'object' || stats === null || Array.isArray(stats)) return null;
  const created = stats['writeCreated'];
  const updated = stats['writeUpdated'];
  if (typeof created !== 'number' || typeof updated !== 'number') return null;
  return created + updated;
}
