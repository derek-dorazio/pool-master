/**
 * Prisma adapter for the root admin's League page (#1865): one sport league's syncs, events,
 * participants and structure, each in a fixed number of grouped reads however many runs, events,
 * participants and slots it has.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  SportEventPageFacts,
  SportLeagueEventFacts,
  SportLeaguePageEvent,
  SportLeaguePageLeague,
  SportLeaguePageParticipant,
  SportLeaguePageReader,
  SportLeaguePageRun,
  SportLeagueSyncFacts,
} from '@poolmaster/shared/db';
import type { SportLeaguePhaseDefinition, SportLeaguePosition, SportLeagueSlotDefinition } from '@poolmaster/shared/domain';
import { ProviderSyncRunStatus } from '@poolmaster/shared/domain';
import { readOverdueCandidates } from './prisma-overdue-event-reads';
import { outcomeSummary } from './prisma-sport-league-overview-reader';
import { SYNC_PROVIDER_SELECT, syncProviderIdOf } from './prisma-sync-provider';

const RUN_SELECT = { id: true, kind: true, status: true, createdAt: true, startedAt: true, payloadJson: true } as const;
const SLOT_SELECT = {
  id: true, sportLeaguePhaseId: true, key: true, slotKind: true, weekNumber: true, name: true, awardsTrophy: true, squaresEligible: true,
  seriesFormat: true, seriesGames: true, pairing: true, matchFormat: true, canEndTied: true, periodUnit: true, periodCount: true,
  providerMappings: {
    select: {
      id: true, matchType: true, providerValue: true,
      sportLeagueProviderMapping: {
        select: { providerLeague: { select: { code: true, name: true, provider: { select: { id: true, name: true } } } } },
      },
    },
  },
} as const;
const EVENT_SELECT = {
  id: true, name: true, eventYear: true, startDate: true, endDate: true, status: true, providerId: true, syncScope: true, releasedAt: true,
  autoReleaseCheckedAt: true, autoReleaseOutcome: true, autoReleaseFailedChecks: true,
} as const;

export class PrismaSportLeaguePageReader implements SportLeaguePageReader {
  constructor(private readonly prisma: PrismaClient) {}

  async readSyncFacts(sportLeagueId: string): Promise<SportLeagueSyncFacts | null> {
    const league = await this.league(sportLeagueId);
    if (league === null) return null;
    const latest = await this.prisma.providerSyncRun.groupBy({
      by: ['kind'],
      where: { sportLeagueId },
      _max: { createdAt: true },
    });
    const keys = latest.flatMap((group) => (group._max.createdAt === null
      ? []
      : [{ sportLeagueId, kind: group.kind, createdAt: group._max.createdAt }]));
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
        select: EVENT_SELECT,
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
      const eventRuns = runsByEvent.get(row.sportEventId);
      if (eventRuns === undefined) runsByEvent.set(row.sportEventId, [toRun(row)]);
      else eventRuns.push(toRun(row));
    }
    return {
      league,
      events: events.map(toPageEvent),
      fieldSizes: new Map(fieldGroups.map((group) => [group.sportEventId, group._count._all])),
      latestRunsByEvent: new Map([...runsByEvent].map(([sportEventId, runs]) => [sportEventId, oneRunPerKind(runs)])),
      overdueCandidates,
    };
  }

  async readStructure(sportLeagueId: string): Promise<SportLeaguePhaseDefinition[] | null> {
    const [league, phases, slots] = await Promise.all([
      this.prisma.sportLeague.findUnique({ where: { id: sportLeagueId }, select: { id: true } }),
      this.prisma.sportLeaguePhase.findMany({ where: { sportLeagueId }, select: { id: true, phase: true, isSynced: true } }),
      this.prisma.sportLeaguePhaseSlot.findMany({ where: { sportLeagueId }, select: SLOT_SELECT }),
    ]);
    if (league === null) return null;
    const slotsByPhase = new Map<string, SportLeagueSlotDefinition[]>();
    for (const { sportLeaguePhaseId, providerMappings, ...slot } of slots) {
      const list = slotsByPhase.get(sportLeaguePhaseId) ?? [];
      list.push({
        ...slot,
        providerMappings: providerMappings.map(({ sportLeagueProviderMapping: { providerLeague }, ...mapping }) => ({
          ...mapping,
          providerId: providerLeague.provider.id,
          providerName: providerLeague.provider.name,
          providerLeagueCode: providerLeague.code,
          providerLeagueName: providerLeague.name,
        })),
      });
      slotsByPhase.set(sportLeaguePhaseId, list);
    }
    return phases.map((phase) => ({ ...phase, slots: slotsByPhase.get(phase.id) ?? [] }));
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

  async readPositions(sportLeagueId: string): Promise<SportLeaguePosition[] | null> {
    const [league, positions] = await Promise.all([
      this.prisma.sportLeague.findUnique({ where: { id: sportLeagueId }, select: { id: true } }),
      this.prisma.sportLeaguePosition.findMany({
        where: { sportLeagueId },
        select: {
          id: true,
          code: true,
          displayOrder: true,
          isFieldEligible: true,
          providerCodes: {
            select: {
              providerCode: true,
              sportLeagueProviderMapping: {
                select: { providerLeague: { select: { code: true, name: true, provider: { select: { code: true } } } } },
              },
            },
            orderBy: [{ sportLeagueProviderMapping: { providerLeague: { code: 'asc' } } }, { providerCode: 'asc' }],
          },
        },
        orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      }),
    ]);
    if (league === null) return null;
    return positions.map(({ providerCodes, ...position }) => ({
      ...position,
      providerCodes: providerCodes
        .map(({ providerCode, sportLeagueProviderMapping: { providerLeague } }) => ({
          providerCode,
          provider: providerLeague.provider.code,
          providerLeagueCode: providerLeague.code,
          providerLeagueName: providerLeague.name,
        })),
    }));
  }

  async readEventPageFacts(sportEventId: string, now: Date): Promise<SportEventPageFacts | null> {
    const event = await this.prisma.sportEvent.findUnique({
      where: { id: sportEventId },
      select: { ...EVENT_SELECT, eventSeries: { select: { sportLeagueId: true, name: true } } },
    });
    if (event === null) return null;
    const { eventSeries, ...eventRow } = event;
    const [league, latestRunGroups, overdueCandidates, field, offer] = await Promise.all([
      this.league(eventSeries.sportLeagueId),
      this.prisma.providerSyncRun.groupBy({ by: ['kind'], where: { sportEventId }, _max: { createdAt: true } }),
      readOverdueCandidates(this.prisma, now, undefined, [sportEventId]),
      this.prisma.sportEventParticipant.findMany({
        where: { sportEventId },
        select: { id: true, participantId: true, isActive: true, oddsToWin: true, seedNumber: true, ranking: true, participant: { select: { name: true } } },
        orderBy: { id: 'asc' },
      }),
      // An offer names its series by sport league and name, as a template's series names do.
      this.prisma.eventPageOffer.findFirst({
        where: { sportLeagueId: eventSeries.sportLeagueId, eventSeriesName: eventSeries.name, eventPage: { isActive: true } },
        select: { eventPage: { select: { slug: true } } },
        orderBy: [{ eventPage: { displayOrder: 'asc' } }, { id: 'asc' }],
      }),
    ]);
    // Every series names a sport league (a foreign key), so it is there.
    if (league === null) return null;
    const keys = latestRunGroups.flatMap((group) => (group._max.createdAt === null ? [] : [{ sportEventId, kind: group.kind, createdAt: group._max.createdAt }]));
    const participantIds = field.map((row) => row.participantId);
    const [runRows, mappings] = await Promise.all([
      keys.length === 0 ? [] : this.prisma.providerSyncRun.findMany({ where: { OR: keys }, select: RUN_SELECT, orderBy: { id: 'asc' } }),
      participantIds.length === 0 ? [] : this.prisma.participantProviderMapping.findMany({
        where: { sportLeagueId: eventSeries.sportLeagueId, participantId: { in: participantIds } },
        select: { participantId: true, externalId: true, lastSeenAt: true },
        // Of two providers' mappings, the latest made names the participant's feed id, as on the League page.
        orderBy: [{ mappedAt: 'desc' }, { id: 'asc' }],
      }),
    ]);
    const mappingByParticipant = new Map<string, { externalId: string; lastSeenAt: Date | null }>();
    for (const mapping of mappings) {
      if (!mappingByParticipant.has(mapping.participantId)) {
        mappingByParticipant.set(mapping.participantId, { externalId: mapping.externalId, lastSeenAt: mapping.lastSeenAt });
      }
    }
    return {
      league,
      event: toPageEvent(eventRow),
      latestRuns: oneRunPerKind(runRows.map(toRun)),
      overdueCandidates,
      field: field.map((row) => ({
        id: row.id,
        isActive: row.isActive,
        oddsToWin: row.oddsToWin === null ? null : row.oddsToWin.toNumber(),
        seedNumber: row.seedNumber,
        ranking: row.ranking,
        name: row.participant.name,
        mapping: mappingByParticipant.get(row.participantId) ?? null,
      })),
      eventPageSlug: offer?.eventPage.slug ?? null,
    };
  }

  private async league(sportLeagueId: string): Promise<SportLeaguePageLeague | null> {
    const row = await this.prisma.sportLeague.findUnique({
      where: { id: sportLeagueId },
      select: {
        id: true, isActive: true, ...SYNC_PROVIDER_SELECT, autoReleaseDaysBeforeStart: true,
        sport: { select: { sport: true } },
      },
    });
    if (row === null) return null;
    const { sport, selectedProviderMapping, ...league } = row;
    return { ...league, sport: sport.sport, syncProviderId: syncProviderIdOf({ selectedProviderMapping }) };
  }
}

type RunRow = Prisma.ProviderSyncRunGetPayload<{ select: typeof RUN_SELECT }>;
type EventRow = Prisma.SportEventGetPayload<{ select: typeof EVENT_SELECT }>;

function toPageEvent({ autoReleaseCheckedAt, autoReleaseOutcome, autoReleaseFailedChecks, ...event }: EventRow): SportLeaguePageEvent {
  return {
    ...event,
    // The check constraint sets the time and the outcome together.
    lastReleaseCheck: autoReleaseCheckedAt === null || autoReleaseOutcome === null
      ? null
      : { checkedAt: autoReleaseCheckedAt, outcome: autoReleaseOutcome, failedChecks: autoReleaseFailedChecks },
  };
}

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
