/**
 * Prisma adapter for the root admin's League page (#1865): one sport league's syncs, events,
 * participants and structure, each in a fixed number of grouped reads however many runs, events,
 * participants and slots it has.
 */
import { PrismaSlotProviderMatchType, type Prisma, type PrismaClient } from '@prisma/client';
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
import type { SportLeaguePhaseDefinition, SportLeaguePosition, SportLeagueSeasonDetail, SportLeagueSeasonPhaseSlot, SportLeagueSlotDefinition } from '@poolmaster/shared/domain';
import { buildEventPagePath, ProviderSyncRunStatus, seasonsToSync } from '@poolmaster/shared/domain';
import { readOverdueCandidates } from './prisma-overdue-event-reads';
import { SYNC_PROVIDER_SELECT, syncProviderIdOf } from './prisma-sync-provider';
import { COVERS_TEST_SLOT, SEASON_SLOT_SELECT, toSeasonSlot } from './season-slot-select';

const RUN_SELECT = { id: true, kind: true, status: true, createdAt: true, startedAt: true, summary: true, changedCount: true } as const;
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
  id: true, name: true, sportLeagueSeasonId: true, startDate: true, endDate: true, status: true, releasedAt: true,
  autoReleaseCheckedAt: true, autoReleaseOutcome: true, autoReleaseFailedChecks: true,
  // A test event is one on a test slot (#2004): its first such slot, if any, says so.
  slots: { where: COVERS_TEST_SLOT, select: { id: true }, take: 1 },
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
    const league = await this.league(sportLeagueId);
    if (league === null) return null;
    const [events, overdueCandidates] = await Promise.all([
      this.prisma.sportEvent.findMany({
        where: { sportLeagueSeason: { sportLeagueId } },
        select: EVENT_SELECT,
        orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      }),
      readOverdueCandidates(this.prisma, now, sportLeagueId),
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

  async readSeasons(sportLeagueId: string): Promise<SportLeagueSeasonDetail[] | null> {
    const [league, seasons, phases, slots] = await Promise.all([
      this.prisma.sportLeague.findUnique({ where: { id: sportLeagueId }, select: { currentSeasonId: true, selectedProviderMappingId: true } }),
      this.prisma.sportLeagueSeason.findMany({
        where: { sportLeagueId },
        select: {
          id: true, sportLeagueId: true, name: true, championshipYear: true, startsAt: true, endsAt: true,
          providerMappings: {
            select: {
              id: true, sportLeagueProviderMappingId: true, providerSeasonId: true,
              sportLeagueProviderMapping: { select: { providerLeague: { select: { code: true, provider: { select: { id: true, name: true } } } } } },
            },
          },
        },
      }),
      this.prisma.sportLeagueSeasonPhase.findMany({
        where: { sportLeagueId },
        select: { id: true, sportLeagueSeasonId: true, phase: { select: { phase: true, isSynced: true } } },
      }),
      this.prisma.sportLeagueSeasonPhaseSlot.findMany({
        where: { sportLeagueId },
        select: {
          ...SEASON_SLOT_SELECT,
          sportLeagueSeasonPhaseId: true,
          eventSlot: { select: { sportEventId: true } },
          definition: {
            select: {
              ...SEASON_SLOT_SELECT.definition.select,
              // The provider mappings that place the slot's games by date window (#2012).
              providerMappings: { where: { matchType: PrismaSlotProviderMatchType.DATE_WINDOW }, select: { sportLeagueProviderMappingId: true } },
            },
          },
        },
      }),
    ]);
    if (league === null) return null;
    const slotsByPhase = new Map<string, SportLeagueSeasonPhaseSlot[]>();
    for (const { sportLeagueSeasonPhaseId, eventSlot, definition: { providerMappings, ...definition }, ...slot } of slots) {
      const list = slotsByPhase.get(sportLeagueSeasonPhaseId) ?? [];
      list.push({
        ...toSeasonSlot({ ...slot, definition }),
        sportEventId: eventSlot?.sportEventId ?? null,
        placedByWindow: providerMappings.some((mapping) => mapping.sportLeagueProviderMappingId === league.selectedProviderMappingId),
      });
      slotsByPhase.set(sportLeagueSeasonPhaseId, list);
    }
    const readBySync = new Set(seasonsToSync(seasons, league.currentSeasonId).map((season) => season.id));
    return seasons.map(({ providerMappings, ...season }) => ({
      ...season,
      isCurrent: season.id === league.currentSeasonId,
      readBySync: readBySync.has(season.id),
      providerMappings: providerMappings.map(({ sportLeagueProviderMapping: { providerLeague }, ...mapping }) => ({
        ...mapping,
        providerId: providerLeague.provider.id,
        providerName: providerLeague.provider.name,
        providerLeagueCode: providerLeague.code,
      })),
      phases: phases
        .filter((phase) => phase.sportLeagueSeasonId === season.id)
        .map((phase) => ({ id: phase.id, ...phase.phase, slots: slotsByPhase.get(phase.id) ?? [] })),
    }));
  }

  async readParticipants(sportLeagueId: string): Promise<SportLeaguePageParticipant[] | null> {
    const [league, participants, mappings] = await Promise.all([
      this.prisma.sportLeague.findUnique({ where: { id: sportLeagueId }, select: { id: true } }),
      this.prisma.participant.findMany({
        // The league's roster: a test participant is on none (#2096).
        where: { sportLeagueId, isTestData: false },
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
      select: { ...EVENT_SELECT, sportLeagueId: true },
    });
    if (event === null) return null;
    const { sportLeagueId, ...eventRow } = event;
    const [league, latestRunGroups, overdueCandidates, field, offer] = await Promise.all([
      this.league(sportLeagueId),
      this.prisma.providerSyncRun.groupBy({ by: ['kind'], where: { sportEventId }, _max: { createdAt: true } }),
      readOverdueCandidates(this.prisma, now, undefined, [sportEventId]),
      this.prisma.sportEventParticipant.findMany({
        where: { sportEventId },
        select: { id: true, participantId: true, isActive: true, oddsToWin: true, seedNumber: true, ranking: true, participant: { select: { name: true } } },
        orderBy: { id: 'asc' },
      }),
      // An offer names a slot definition (#2010): the event's page offers one of its slots.
      this.prisma.eventPageOffer.findFirst({
        where: { sportLeagueId, definition: { seasonSlots: { some: { eventSlot: { sportEventId } } } }, eventPage: { isActive: true } },
        select: { eventPage: { select: { urlSegment: true, sportConfig: { select: { urlSegment: true } } } } },
        orderBy: [{ eventPage: { displayOrder: 'asc' } }, { id: 'asc' }],
      }),
    ]);
    // Every event names a sport league (a foreign key), so it is there.
    if (league === null) return null;
    const keys = latestRunGroups.flatMap((group) => (group._max.createdAt === null ? [] : [{ sportEventId, kind: group.kind, createdAt: group._max.createdAt }]));
    const participantIds = field.map((row) => row.participantId);
    const [runRows, mappings] = await Promise.all([
      keys.length === 0 ? [] : this.prisma.providerSyncRun.findMany({ where: { OR: keys }, select: RUN_SELECT, orderBy: { id: 'asc' } }),
      participantIds.length === 0 ? [] : this.prisma.participantProviderMapping.findMany({
        where: { sportLeagueId, participantId: { in: participantIds } },
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
      eventPagePath: offer ? buildEventPagePath({ sportUrlSegment: offer.eventPage.sportConfig.urlSegment, urlSegment: offer.eventPage.urlSegment }) : null,
    };
  }

  private async league(sportLeagueId: string): Promise<SportLeaguePageLeague | null> {
    const row = await this.prisma.sportLeague.findUnique({
      where: { id: sportLeagueId },
      select: {
        id: true, isActive: true, ...SYNC_PROVIDER_SELECT, autoReleaseDaysBeforeStart: true,
        sport: { select: { sport: true } },
        platformTierProfile: { select: { sources: { orderBy: { orderIndex: 'asc' }, select: { basis: true } } } },
      },
    });
    if (row === null) return null;
    const { sport, selectedProviderMapping, platformTierProfile, ...league } = row;
    return {
      ...league,
      sport: sport.sport,
      syncProviderId: syncProviderIdOf({ selectedProviderMapping }),
      tierSources: platformTierProfile.sources.map(({ basis }) => basis),
    };
  }
}

type RunRow = Prisma.ProviderSyncRunGetPayload<{ select: typeof RUN_SELECT }>;
type EventRow = Prisma.SportEventGetPayload<{ select: typeof EVENT_SELECT }>;

function toPageEvent({ autoReleaseCheckedAt, autoReleaseOutcome, autoReleaseFailedChecks, slots, ...event }: EventRow): SportLeaguePageEvent {
  return {
    ...event,
    isTestData: slots.length > 0,
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
    summary: row.summary === '' ? null : row.summary,
    changedCount: row.status === ProviderSyncRunStatus.COMPLETED ? row.changedCount : null,
  };
}

/** Two runs of one kind written in the same instant: either is the latest; keep the first read. */
function oneRunPerKind(runs: readonly SportLeaguePageRun[]): SportLeaguePageRun[] {
  const byKind = new Map<string, SportLeaguePageRun>();
  for (const run of runs) if (!byKind.has(run.kind)) byKind.set(run.kind, run);
  return [...byKind.values()];
}

