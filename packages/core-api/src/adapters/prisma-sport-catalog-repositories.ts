/**
 * Prisma adapters for the cross-sport catalog and event-core ports (#235, #236):
 * Sport, SportLeague, ParticipantLeagueAffiliation, SportEvent, EventSeries,
 * SportEventRound, SportEventParticipant, SportEventTier,
 * and SportEventParticipantValuation.
 *
 * Sport extension rows (golf rounds and standings, stat lines, race results, matches) have
 * their own adapters. The one exception is the field read (#1163): a field row comes with
 * every extension at once, mapped by those adapters' own mappers.
 */

import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  EventSeriesRepository,
  ParticipantLeagueAffiliationRepository,
  ParticipantRanking,
  PriceAssignment,
  ReplacementValuation,
  SportEventCreate,
  SportEventFilters,
  SportEventParticipantCreate,
  SportEventParticipantFieldUpdate,
  SportEventParticipantPatch,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
  SportEventParticipantView,
  SportEventProviderSummary,
  SportEventRepository,
  SportEventRoundRepository,
  SportEventRoundCreate,
  SportEventRoundSchedule,
  SportEventTierCreate,
  SportEventTierDefinition,
  SportEventTierRepository,
  SportEventStatusTransition,
  SportEventUpdate,
  SportLeagueFilters,
  SportLeagueRepository,
  SportLeagueUpdate,
  SportRepository,
  TierAssignment,
} from '@poolmaster/shared/db';
import type {
  EventPricingConfig,
  EventSeries,
  ParticipantLeagueAffiliation,
  Sport,
  SportConfig,
  SportEvent,
  SportEventParticipant,
  SportEventParticipantValuation,
  SportEventRound,
  SportEventSyncScope,
  SportEventTier,
  SportLeague,
} from '@poolmaster/shared/domain';
import { EventPricingConfigSchema, MatchSide, ParticipantInactiveReason, ParticipantStatus, SportEventStatus, ValuationSource } from '@poolmaster/shared/domain';
import { forgettingReads, memoizedRead, memoizedReadMany, ReadMemoKey } from '../core/request-read-memo';
import { toGolfRound, toGolfStanding } from './prisma-golf-repositories';
import { MATCH_INCLUDE, toSportEventMatch } from './prisma-match-repositories';
import { mapToParticipant } from './prisma-participant-repository';
import { toRaceResult } from './prisma-race-repositories';
import { toStatLine } from './prisma-stat-line-repositories';

type Db = PrismaClient;

export class PrismaSportRepository implements SportRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<SportConfig | null> {
    const row = await this.prisma.sport.findUnique({ where: { id } });
    return row ? toSport(row) : null;
  }

  async findBySport(sport: Sport): Promise<SportConfig | null> {
    const row = await this.prisma.sport.findUnique({ where: { sport } });
    return row ? toSport(row) : null;
  }

  async findAll(): Promise<SportConfig[]> {
    const rows = await this.prisma.sport.findMany({ orderBy: { sport: 'asc' } });
    return rows.map(toSport);
  }
}

export class PrismaSportLeagueRepository implements SportLeagueRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<SportLeague | null> {
    return memoizedRead(this.prisma, `${ReadMemoKey.sportLeague}${id}`, async () => {
      const row = await this.prisma.sportLeague.findUnique({ where: { id } });
      return row ? toSportLeague(row) : null;
    });
  }

  async findByIds(ids: readonly string[]): Promise<SportLeague[]> {
    if (ids.length === 0) {
      return [];
    }
    return memoizedReadMany(this.prisma, ReadMemoKey.sportLeague, ids, async (missing) => {
      const rows = await this.prisma.sportLeague.findMany({ where: { id: { in: [...missing] } } });
      return rows.map(toSportLeague);
    });
  }

  async findAll(filters: SportLeagueFilters): Promise<SportLeague[]> {
    const rows = await this.prisma.sportLeague.findMany({
      where: {
        ...(filters.sportId !== undefined && { sportId: filters.sportId }),
        ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(toSportLeague);
  }

  async findBySportAndName(sportId: string, name: string): Promise<SportLeague | null> {
    const row = await this.prisma.sportLeague.findUnique({ where: { sportId_name: { sportId, name } } });
    return row ? toSportLeague(row) : null;
  }

  async create(input: Pick<SportLeague, 'sportId' | 'name' | 'matchKeyword' | 'bracketAdvancement'>): Promise<SportLeague> {
    return toSportLeague(await this.prisma.sportLeague.create({
      data: { sportId: input.sportId, name: input.name, matchKeyword: input.matchKeyword, bracketAdvancement: input.bracketAdvancement },
    }));
  }

  async update(id: string, updates: SportLeagueUpdate): Promise<SportLeague> {
    const write = () => this.prisma.sportLeague.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.matchKeyword !== undefined && { matchKeyword: updates.matchKeyword }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.currentEventYear !== undefined && { currentEventYear: updates.currentEventYear }),
        ...(updates.bracketAdvancement !== undefined && { bracketAdvancement: updates.bracketAdvancement }),
      },
    });
    // A sport event's read carries its sport league's settings, so those are forgotten too.
    return toSportLeague(await forgettingReads([ReadMemoKey.sportEvent, ReadMemoKey.sportLeague], write));
  }
}

export class PrismaParticipantLeagueAffiliationRepository implements ParticipantLeagueAffiliationRepository {
  constructor(private readonly prisma: Db) {}

  async findBySportLeague(sportLeagueId: string): Promise<ParticipantLeagueAffiliation[]> {
    const rows = await this.prisma.participantLeagueAffiliation.findMany({
      where: { sportLeagueId },
      orderBy: [{ ranking: { sort: 'asc', nulls: 'last' } }, { participant: { name: 'asc' } }],
      include: { participant: true },
    });
    return rows.map(toAffiliation);
  }

  async find(sportLeagueId: string, participantId: string): Promise<ParticipantLeagueAffiliation | null> {
    const row = await this.prisma.participantLeagueAffiliation.findUnique({
      where: { participantId_sportLeagueId: { participantId, sportLeagueId } },
      include: { participant: true },
    });
    return row ? toAffiliation(row) : null;
  }

  async create(sportLeagueId: string, participantId: string): Promise<ParticipantLeagueAffiliation> {
    return toAffiliation(await this.prisma.participantLeagueAffiliation.create({
      data: { participantId, sportLeagueId },
      include: { participant: true },
    }));
  }

  async delete(sportLeagueId: string, participantId: string): Promise<void> {
    await this.prisma.participantLeagueAffiliation.delete({
      where: { participantId_sportLeagueId: { participantId, sportLeagueId } },
    });
  }

  async updateRankings(sportLeagueId: string, rankings: readonly ParticipantRanking[]): Promise<void> {
    await this.rewriteRankings(sportLeagueId, rankings, { createMissing: false });
  }

  async upsertRankings(sportLeagueId: string, rankings: readonly ParticipantRanking[]): Promise<void> {
    await this.rewriteRankings(sportLeagueId, rankings, { createMissing: true });
  }

  /**
   * Each ranking written in a fixed number of statements, whatever the list's length (#1252):
   * Prisma has no update of many rows to different values, and nothing points at an
   * affiliation row, so the rows named are deleted and inserted again, each keeping its id and
   * creation time. A ranking for a participant with no affiliation is added when
   * `createMissing`, and is an error otherwise, as an update of a missing row is.
   */
  private async rewriteRankings(
    sportLeagueId: string,
    rankings: readonly ParticipantRanking[],
    { createMissing }: { createMissing: boolean },
  ): Promise<void> {
    // A participant ranked twice keeps the later ranking, as two updates in a row would leave it.
    const latest = [...new Map(rankings.map((entry) => [entry.participantId, entry])).values()];
    if (latest.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.participantLeagueAffiliation.findMany({
        where: { sportLeagueId, participantId: { in: latest.map((entry) => entry.participantId) } },
        select: { id: true, participantId: true, createdAt: true },
      });
      const existingByParticipantId = new Map(existing.map((row) => [row.participantId, row]));
      const missing = latest.filter((entry) => !existingByParticipantId.has(entry.participantId));
      if (!createMissing && missing.length > 0) {
        throw new Error(`No ${sportLeagueId} affiliation to rank for participant(s) ${missing.map((entry) => entry.participantId).join(', ')}.`);
      }
      await tx.participantLeagueAffiliation.deleteMany({ where: { id: { in: existing.map((row) => row.id) } } });
      await tx.participantLeagueAffiliation.createMany({
        data: latest.map((entry) => ({
          ...existingByParticipantId.get(entry.participantId),
          participantId: entry.participantId,
          sportLeagueId,
          ranking: entry.ranking,
        })),
      });
    });
  }

  async countBySportLeagues(sportLeagueIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.participantLeagueAffiliation.groupBy({
      by: ['sportLeagueId'],
      where: { sportLeagueId: { in: [...sportLeagueIds] } },
      _count: { _all: true },
    });
    return countMap(sportLeagueIds, groups.map((group) => [group.sportLeagueId, group._count._all]));
  }
}

export class PrismaSportEventRepository implements SportEventRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<SportEvent | null> {
    return memoizedRead(this.prisma, `${ReadMemoKey.sportEvent}${id}`, async () => {
      const row = await this.prisma.sportEvent.findUnique({ where: { id }, include: SPORT_EVENT_INCLUDE });
      return row ? toSportEvent(row) : null;
    });
  }

  async findByIds(ids: readonly string[]): Promise<SportEvent[]> {
    if (!ids.length) {
      return [];
    }
    return memoizedReadMany(this.prisma, ReadMemoKey.sportEvent, ids, async (missing) => {
      const rows = await this.prisma.sportEvent.findMany({ where: { id: { in: [...missing] } }, include: SPORT_EVENT_INCLUDE });
      return rows.map(toSportEvent);
    });
  }

  async findByProviderRef(providerId: string, externalId: string): Promise<SportEvent | null> {
    const row = await this.prisma.sportEvent.findFirst({ where: { providerId, externalId }, include: SPORT_EVENT_INCLUDE });
    return row ? toSportEvent(row) : null;
  }

  async findByProviderRefs(providerId: string, externalIds: readonly string[]): Promise<SportEvent[]> {
    if (externalIds.length === 0) return [];
    const rows = await this.prisma.sportEvent.findMany({
      where: { providerId, externalId: { in: [...externalIds] } },
      include: SPORT_EVENT_INCLUDE,
    });
    return rows.map(toSportEvent);
  }

  async findAll(filters: SportEventFilters): Promise<SportEvent[]> {
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        ...(filters.sport !== undefined && { sport: filters.sport }),
        ...(filters.statuses !== undefined && { status: { in: [...filters.statuses] } }),
        ...(filters.sportLeagueId !== undefined && { eventSeries: { sportLeagueId: filters.sportLeagueId } }),
        ...(filters.eventYear !== undefined && { eventYear: filters.eventYear }),
        ...(filters.q !== undefined && { name: { contains: filters.q, mode: 'insensitive' as const } }),
        ...(filters.releasedOnly && { NOT: { status: SportEventStatus.DRAFT } }),
        ...((filters.startsFrom !== undefined || filters.startsBefore !== undefined) && {
          startDate: { gte: filters.startsFrom, lt: filters.startsBefore },
        }),
      },
      include: SPORT_EVENT_INCLUDE,
      orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toSportEvent);
  }

  async findEventYears(sportLeagueId: string, options: { releasedOnly: boolean }): Promise<number[]> {
    // groupBy deduplicates in Postgres; findMany's `distinct` would return a row per event.
    const rows = await this.prisma.sportEvent.groupBy({
      by: ['eventYear'],
      where: {
        eventSeries: { sportLeagueId },
        ...(options.releasedOnly && { NOT: { status: SportEventStatus.DRAFT } }),
      },
      orderBy: { eventYear: 'asc' },
    });
    return rows.map((row) => row.eventYear);
  }

  async createMany(inputs: readonly SportEventCreate[]): Promise<SportEvent[]> {
    if (inputs.length === 0) return [];
    // Each event is given its id here, so the rows the insert answers can be put back in the
    // order given whatever order the database returns them in.
    const ids = inputs.map(() => randomUUID());
    const rows = await this.prisma.sportEvent.createManyAndReturn({
      data: inputs.map((input, index) => ({
        id: ids[index],
        externalId: input.externalId,
        providerId: input.providerId,
        sport: input.sport,
        name: input.name,
        venue: input.venue ?? null,
        location: input.location ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        status: input.status,
        rounds: input.rounds ?? null,
        roundsPar: input.roundsPar ?? null,
        eventSeriesId: input.eventSeriesId,
        eventYear: input.eventYear,
        syncScope: input.syncScope,
        autoLifecycleEnabled: input.autoLifecycleEnabled,
      })),
      include: SPORT_EVENT_INCLUDE,
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => {
      const row = rowById.get(id);
      if (!row) throw new Error(`The insert did not answer sport event ${id}.`);
      return toSportEvent(row);
    });
  }

  async update(id: string, updates: SportEventUpdate): Promise<SportEvent> {
    return toSportEvent(await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.sportEvent.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.venue !== undefined && { venue: updates.venue }),
        ...(updates.location !== undefined && { location: updates.location }),
        ...(updates.startDate !== undefined && { startDate: updates.startDate }),
        ...(updates.endDate !== undefined && { endDate: updates.endDate }),
        ...(updates.rounds !== undefined && { rounds: updates.rounds }),
        ...(updates.roundsPar !== undefined && { roundsPar: updates.roundsPar }),
        ...(updates.autoLifecycleEnabled !== undefined && { autoLifecycleEnabled: updates.autoLifecycleEnabled }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.providerId !== undefined && { providerId: updates.providerId }),
        ...(updates.externalId !== undefined && { externalId: updates.externalId }),
        ...(updates.syncScope !== undefined && { syncScope: updates.syncScope }),
      },
      include: SPORT_EVENT_INCLUDE,
    })));
  }

  async transitionStatus(id: string, transition: SportEventStatusTransition): Promise<SportEvent | null> {
    const result = await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.sportEvent.updateMany({
      where: { id, status: transition.from },
      data: {
        status: transition.to,
        ...(transition.endDate && { endDate: transition.endDate }),
      },
    }));
    return result.count > 0 ? this.findById(id) : null;
  }

  async delete(id: string): Promise<void> {
    // Every child holds a RESTRICT foreign key, so they go first, extension rows before
    // their core rows. Deleting only the event row failed for any event with a round.
    const field = { sportEventParticipant: { sportEventId: id } };
    await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.$transaction([
      // The bracket first: its matches name field rows and rounds.
      this.prisma.sportEventMatch.deleteMany({ where: { sportEventId: id } }),
      this.prisma.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: field } }),
      this.prisma.sportEventParticipantStatLine.deleteMany({ where: { participantRound: field } }),
      this.prisma.sportEventParticipantRound.deleteMany({ where: field }),
      this.prisma.sportEventParticipantGolfStanding.deleteMany({ where: { standing: field } }),
      this.prisma.sportEventParticipantStanding.deleteMany({ where: field }),
      this.prisma.sportEventParticipantValuation.deleteMany({ where: field }),
      this.prisma.sportEventParticipant.deleteMany({ where: { sportEventId: id } }),
      this.prisma.sportEventRound.deleteMany({ where: { sportEventId: id } }),
      this.prisma.sportEventTier.deleteMany({ where: { sportEventId: id } }),
      this.prisma.sportEvent.delete({ where: { id } }),
    ]));
  }

  async countParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEventParticipant.groupBy({
      by: ['sportEventId'],
      where: { sportEventId: { in: [...sportEventIds] } },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.map((group) => [group.sportEventId, group._count._all]));
  }

  async countUntieredActiveParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEventParticipant.groupBy({
      by: ['sportEventId'],
      where: {
        sportEventId: { in: [...sportEventIds] },
        isActive: true,
        OR: [{ valuation: null }, { valuation: { sportEventTierId: null } }],
      },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.map((group) => [group.sportEventId, group._count._all]));
  }

  async countUnpricedActiveParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEventParticipant.groupBy({
      by: ['sportEventId'],
      where: {
        sportEventId: { in: [...sportEventIds] },
        isActive: true,
        OR: [{ valuation: null }, { valuation: { price: null } }],
      },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.map((group) => [group.sportEventId, group._count._all]));
  }

  async countTiers(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEventTier.groupBy({
      by: ['sportEventId'],
      where: { sportEventId: { in: [...sportEventIds] } },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.map((group) => [group.sportEventId, group._count._all]));
  }

  async findEmptyTierLabels(sportEventIds: readonly string[]): Promise<Map<string, string[]>> {
    const rows = await this.prisma.sportEventTier.findMany({
      where: {
        sportEventId: { in: [...sportEventIds] },
        valuations: { none: { sportEventParticipant: { isActive: true } } },
      },
      select: { sportEventId: true, label: true },
      orderBy: { tierNumber: 'asc' },
    });
    const labels = new Map<string, string[]>(sportEventIds.map((id) => [id, []]));
    for (const row of rows) {
      labels.get(row.sportEventId)?.push(row.label);
    }
    return labels;
  }

  async countContests(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    // A contest covers its events through contest_sport_events (#713): one row per contest and event.
    const groups = await this.prisma.contestSportEvent.groupBy({
      by: ['sportEventId'],
      where: { sportEventId: { in: [...sportEventIds] } },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.map((group) => [group.sportEventId, group._count._all]));
  }

  async countBySportLeagues(
    sportLeagueIds: readonly string[],
    filters: { eventYear?: number } = {},
  ): Promise<Map<string, number>> {
    // groupBy cannot group through a relation, so the events are counted per series and
    // the series folded into their sport league.
    const series = await this.prisma.eventSeries.findMany({
      where: { sportLeagueId: { in: [...sportLeagueIds] } },
      select: { id: true, sportLeagueId: true },
    });
    const groups = await this.prisma.sportEvent.groupBy({
      by: ['eventSeriesId'],
      where: {
        eventSeriesId: { in: series.map((row) => row.id) },
        ...(filters.eventYear !== undefined && { eventYear: filters.eventYear }),
      },
      _count: { _all: true },
    });
    const leagueBySeries = new Map(series.map((row) => [row.id, row.sportLeagueId]));
    const counts = new Map(sportLeagueIds.map((id) => [id, 0]));
    for (const group of groups) {
      const sportLeagueId = leagueBySeries.get(group.eventSeriesId);
      if (sportLeagueId) counts.set(sportLeagueId, (counts.get(sportLeagueId) ?? 0) + group._count._all);
    }
    return counts;
  }

  async sportLeagueHasLoadedBracket(sportLeagueId: string): Promise<boolean> {
    const match = await this.prisma.sportEventMatch.findFirst({
      where: { sportEvent: { eventSeries: { sportLeagueId } } },
      select: { id: true },
    });
    return match !== null;
  }

  async summarizeByProviders(providerIds: readonly string[]): Promise<Map<string, SportEventProviderSummary>> {
    const [active, latest] = await Promise.all([
      this.prisma.sportEvent.groupBy({
        by: ['providerId'],
        where: { providerId: { in: [...providerIds] }, status: { in: [SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS] } },
        _count: { _all: true },
      }),
      this.prisma.sportEvent.groupBy({
        by: ['providerId'],
        where: { providerId: { in: [...providerIds] } },
        _max: { updatedAt: true },
      }),
    ]);
    const activeCounts = new Map(active.map((group) => [group.providerId, group._count._all]));
    const lastChanged = new Map(latest.map((group) => [group.providerId, group._max.updatedAt]));
    return new Map(providerIds.map((id) => [id, {
      activeEventCount: activeCounts.get(id) ?? 0,
      lastChangedAt: lastChanged.get(id) ?? null,
    }]));
  }

  async findAutoLifecycleCandidates(): Promise<SportEvent[]> {
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        autoLifecycleEnabled: true,
        status: { in: [SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS] },
      },
      include: SPORT_EVENT_INCLUDE,
    });
    return rows.map(toSportEvent);
  }
}

export class PrismaEventSeriesRepository implements EventSeriesRepository {
  constructor(private readonly prisma: Db) {}

  async findOrCreateMany(sportLeagueId: string, names: readonly string[]): Promise<EventSeries[]> {
    if (names.length === 0) return [];
    await this.prisma.eventSeries.createMany({
      data: names.map((name) => ({ sportLeagueId, name })),
      skipDuplicates: true,
    });
    const rows = await this.prisma.eventSeries.findMany({ where: { sportLeagueId, name: { in: [...names] } } });
    return rows.map((row) => ({
      id: row.id,
      sportLeagueId: row.sportLeagueId,
      name: row.name,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}

export class PrismaSportEventRoundRepository implements SportEventRoundRepository {
  constructor(private readonly prisma: Db) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventRound[]> {
    const rows = await this.prisma.sportEventRound.findMany({
      where: { sportEventId },
      orderBy: { roundNumber: 'asc' },
    });
    return rows.map(toSportEventRound);
  }

  async findBySportEvents(sportEventIds: readonly string[]): Promise<Map<string, SportEventRound[]>> {
    const rounds = new Map<string, SportEventRound[]>(sportEventIds.map((id) => [id, []]));
    if (sportEventIds.length === 0) return rounds;
    const rows = await this.prisma.sportEventRound.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      orderBy: { roundNumber: 'asc' },
    });
    for (const row of rows) rounds.get(row.sportEventId)?.push(toSportEventRound(row));
    return rounds;
  }

  async createMany(rounds: readonly SportEventRoundCreate[]): Promise<void> {
    if (rounds.length === 0) return;
    await this.prisma.sportEventRound.createMany({
      data: rounds.map((round) => ({
        sportEventId: round.sportEventId,
        roundNumber: round.roundNumber,
        scheduledDate: round.scheduledDate,
        scheduledEndAt: round.scheduledEndAt ?? null,
      })),
    });
  }

  async reschedule(sportEventId: string, rounds: readonly SportEventRoundSchedule[]): Promise<void> {
    // poolmaster-allow-query-in-loop: one event's handful of rounds (per-row values, one transaction)
    await this.prisma.$transaction(rounds.map((round) => this.prisma.sportEventRound.update({
      where: { sportEventId_roundNumber: { sportEventId, roundNumber: round.roundNumber } },
      data: {
        scheduledDate: round.scheduledDate,
        ...(round.scheduledEndAt !== undefined && { scheduledEndAt: round.scheduledEndAt }),
      },
    })));
  }

  async findOrCreate(sportEventId: string, roundNumber: number): Promise<SportEventRound> {
    return toSportEventRound(await this.prisma.sportEventRound.upsert({
      where: { sportEventId_roundNumber: { sportEventId, roundNumber } },
      create: { sportEventId, roundNumber, scheduledDate: new Date() },
      update: {},
    }));
  }
}

/** A field in seed order, unseeded last, then by name. */
const FIELD_ORDER = [
  { seedNumber: { sort: 'asc', nulls: 'last' } },
  { participant: { name: 'asc' } },
] satisfies Prisma.SportEventParticipantOrderByWithRelationInput[];

/**
 * Everything a field row is read with (#1163). Prisma 6 reads each relation with its own
 * statement on one connection, so the whole field is a handful of sequential queries; empty
 * relations, such as a golf event's race results, return nothing. Affiliation is read as ids.
 */
function fieldRowInclude(sportLeagueId: string) {
  return {
    participant: { include: { leagueAffiliations: { where: { sportLeagueId }, select: { id: true } } } },
    valuation: true,
    standing: { include: { golf: true } },
    rounds: {
      include: { sportEventRound: { select: { roundNumber: true } }, golf: true, statLines: { orderBy: { stat: 'asc' } } },
      orderBy: { sportEventRound: { roundNumber: 'asc' } },
    },
    raceResult: true,
    homeMatches: { include: MATCH_INCLUDE },
    awayMatches: { include: MATCH_INCLUDE },
  } satisfies Prisma.SportEventParticipantInclude;
}

type FieldRow = Prisma.SportEventParticipantGetPayload<{ include: ReturnType<typeof fieldRowInclude> }>;

function toFieldRow(row: FieldRow): SportEventParticipantView {
  const { participant, valuation, standing, rounds, raceResult, homeMatches, awayMatches, ...entry } = row;
  const { leagueAffiliations, ...participantRow } = participant;
  return {
    entry: toSportEventParticipant(entry),
    participant: mapToParticipant(participantRow),
    valuation: valuation ? toValuation(valuation) : null,
    standing: standing
      ? {
        standing: {
          id: standing.id,
          sportEventParticipantId: standing.sportEventParticipantId,
          position: standing.position,
          displayPosition: standing.displayPosition,
          status: standing.status,
          asOf: standing.asOf,
          currentRound: standing.currentRound,
          createdAt: standing.createdAt,
          updatedAt: standing.updatedAt,
        },
        golf: standing.golf ? toGolfStanding(standing.golf) : null,
      }
      : null,
    rounds: rounds.map((round) => ({
      round: {
        id: round.id,
        sportEventParticipantId: round.sportEventParticipantId,
        sportEventRoundId: round.sportEventRoundId,
        roundNumber: round.sportEventRound.roundNumber,
        status: round.status,
        completedAt: round.completedAt,
        createdAt: round.createdAt,
        updatedAt: round.updatedAt,
      },
      golf: round.golf ? toGolfRound(round.golf) : null,
      statLines: round.statLines.map(toStatLine),
    })),
    raceResult: raceResult ? toRaceResult(raceResult) : null,
    matches: [...homeMatches, ...awayMatches]
      .sort((left, right) => left.matchNumber - right.matchNumber)
      .map(toSportEventMatch),
    affiliatedWithSportLeague: leagueAffiliations.length > 0,
  };
}

export class PrismaSportEventParticipantRepository implements SportEventParticipantRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<SportEventParticipant | null> {
    const row = await this.prisma.sportEventParticipant.findUnique({ where: { id } });
    return row ? toSportEventParticipant(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<SportEventParticipant[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.sportEventParticipant.findMany({ where: { id: { in: [...ids] } } });
    return rows.map(toSportEventParticipant);
  }

  async findBySportEvent(sportEventId: string): Promise<SportEventParticipant[]> {
    const rows = await this.prisma.sportEventParticipant.findMany({ where: { sportEventId }, orderBy: FIELD_ORDER });
    return rows.map(toSportEventParticipant);
  }

  async findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventParticipant[]> {
    if (sportEventIds.length === 0) return [];
    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      orderBy: [{ sportEventId: 'asc' }, ...FIELD_ORDER],
    });
    return rows.map(toSportEventParticipant);
  }

  async findFieldForEvent(sportEventId: string, sportLeagueId: string): Promise<SportEventParticipantView[]> {
    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId },
      include: fieldRowInclude(sportLeagueId),
      orderBy: FIELD_ORDER,
    });
    return rows.map(toFieldRow);
  }

  async findFieldRow(sportEventId: string, sportEventParticipantId: string, sportLeagueId: string): Promise<SportEventParticipantView | null> {
    const row = await this.prisma.sportEventParticipant.findFirst({
      where: { id: sportEventParticipantId, sportEventId },
      include: fieldRowInclude(sportLeagueId),
    });
    return row ? toFieldRow(row) : null;
  }

  async countDistinctParticipants(sportEventIds: readonly string[]): Promise<number> {
    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      distinct: ['participantId'],
      select: { participantId: true },
    });
    return rows.length;
  }

  async createMany(sportEventId: string, rows: readonly SportEventParticipantCreate[]): Promise<void> {
    await this.prisma.sportEventParticipant.createMany({
      data: rows.map((row) => ({ sportEventId, participantId: row.participantId, ...fieldPatch(row) })),
    });
  }

  /**
   * One save of the field grid (#1252): rows given the same change share one update, and every
   * manual price is written with the valuations' fixed-count rewrite. A row whose patch is empty
   * writes nothing.
   */
  async updateMany(entries: readonly SportEventParticipantFieldUpdate[]): Promise<void> {
    const idsByPatch = new Map<string, { data: ReturnType<typeof fieldPatch>; ids: string[] }>();
    for (const entry of entries) {
      const data = fieldPatch(entry.updates);
      if (Object.keys(data).length === 0) continue;
      const key = JSON.stringify(data);
      const group = idsByPatch.get(key) ?? { data, ids: [] };
      group.ids.push(entry.id);
      idsByPatch.set(key, group);
    }
    const prices = entries.flatMap((entry) => (entry.price === undefined
      ? []
      : [{ sportEventParticipantId: entry.id, price: entry.price, priceAssignedSource: ValuationSource.MANUAL }]));
    await this.prisma.$transaction(async (tx) => {
      const groups = [...idsByPatch.values()];
      // poolmaster-allow-query-in-loop: one updateMany per distinct patch; rows given the same values share one
      const results = await Promise.all(groups.map(({ data, ids }) => tx.sportEventParticipant.updateMany({ where: { id: { in: ids } }, data })));
      // An update of a missing row fails, as one update per row would, so none of the save stands.
      if (results.some((result, index) => result.count !== new Set(groups[index].ids).size)) {
        throw new Error('A field row to update does not exist.');
      }
      await rewriteValuations(tx, prices);
    });
  }

  async delete(id: string): Promise<void> {
    const own = { sportEventParticipantId: id };
    await this.prisma.$transaction([
      this.prisma.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: own } }),
      this.prisma.sportEventParticipantStatLine.deleteMany({ where: { participantRound: own } }),
      this.prisma.sportEventParticipantRound.deleteMany({ where: own }),
      this.prisma.sportEventParticipantGolfStanding.deleteMany({ where: { standing: own } }),
      this.prisma.sportEventParticipantStanding.deleteMany({ where: own }),
      this.prisma.sportEventParticipantValuation.deleteMany({ where: own }),
      this.prisma.sportEventParticipant.delete({ where: { id } }),
    ]);
  }

  async countPicks(id: string): Promise<number> {
    return this.prisma.contestEntryPick.count({ where: { sportEventParticipantId: id } });
  }

  async fillPlayInSlot(input: { id: string; winnerParticipantId: string; pairingParticipantId: string }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.sportEventParticipant.update({ where: { id: input.id }, data: { participantId: input.winnerParticipantId, isPlayInPlace: false } }),
      this.prisma.participant.update({ where: { id: input.pairingParticipantId }, data: { status: ParticipantStatus.INACTIVE } }),
    ]);
  }

  async replaceWithdrawn(input: {
    withdrawnId: string;
    matchId: string;
    side: MatchSide;
    replacementParticipantId: string;
    valuation: ReplacementValuation | null;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const withdrawn = await tx.sportEventParticipant.update({
        where: { id: input.withdrawnId },
        data: { isActive: false, inactiveReason: ParticipantInactiveReason.WITHDRAWN },
      });
      const { valuation } = input;
      const replacement = await tx.sportEventParticipant.create({
        data: {
          sportEventId: withdrawn.sportEventId,
          participantId: input.replacementParticipantId,
          ...(valuation && {
            valuation: {
              create: {
                sportEventTierId: valuation.sportEventTierId,
                tierOrderIndex: valuation.tierOrderIndex,
                tierAssignedSource: valuation.sportEventTierId === null ? null : ValuationSource.MANUAL,
                price: valuation.price,
                priceAssignedSource: valuation.price === null ? null : ValuationSource.MANUAL,
              },
            },
          }),
        },
      });
      await tx.sportEventMatch.update({
        where: { id: input.matchId },
        data: input.side === MatchSide.HOME
          ? { homeSportEventParticipantId: replacement.id }
          : { awaySportEventParticipantId: replacement.id },
      });
      return replacement.id;
    });
  }
}

export class PrismaSportEventTierRepository implements SportEventTierRepository {
  constructor(private readonly prisma: Db) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventTier[]> {
    const rows = await this.prisma.sportEventTier.findMany({ where: { sportEventId }, orderBy: { tierNumber: 'asc' } });
    return rows.map(toTier);
  }

  async findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventTier[]> {
    if (sportEventIds.length === 0) return [];
    const rows = await this.prisma.sportEventTier.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      orderBy: [{ sportEventId: 'asc' }, { tierNumber: 'asc' }],
    });
    return rows.map(toTier);
  }

  async createMany(tiers: readonly SportEventTierCreate[]): Promise<void> {
    if (tiers.length === 0) return;
    await this.prisma.sportEventTier.createMany({
      data: tiers.map((tier) => ({ sportEventId: tier.sportEventId, ...tierColumns(tier) })),
    });
  }

  async replace(sportEventId: string, tiers: readonly SportEventTierDefinition[], reassignTo?: string): Promise<void> {
    const keep = new Set(tiers.map((tier) => tier.tierKey));
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.sportEventTier.findMany({ where: { sportEventId } });
      const existingByKey = new Map(existing.map((tier) => [tier.tierKey, tier]));
      const removed = existing.filter((tier) => !keep.has(tier.tierKey));
      const changed = tiers.flatMap((tier) => {
        const before = existingByKey.get(tier.tierKey);
        return before && (before.label !== tier.label || before.tierNumber !== tier.tierNumber) ? [{ id: before.id, tier }] : [];
      });
      const added = tiers.filter((tier) => !existingByKey.has(tier.tierKey));
      // Park every number that moves or goes away below zero in one statement first (tier numbers
      // start at 1), so two tiers swapping numbers, or a new tier taking a removed one's, never
      // collide on the (sportEventId, tierNumber) unique index.
      const parkedIds = [...changed.map(({ id }) => id), ...removed.map((tier) => tier.id)];
      if (parkedIds.length > 0) {
        await tx.sportEventTier.updateMany({ where: { id: { in: parkedIds } }, data: { tierNumber: { multiply: -1 } } });
      }
      // Each changed tier takes its own label and number, so these stay one statement apiece;
      // valuations point at a tier, so a tier cannot be deleted and inserted again instead.
      for (const { id, tier } of changed) {
        // poolmaster-allow-query-in-loop: only the tiers whose label or number changed, of an event's handful
        await tx.sportEventTier.update({ where: { id }, data: { label: tier.label, tierNumber: tier.tierNumber } });
      }
      if (added.length > 0) {
        await tx.sportEventTier.createMany({ data: added.map((tier) => ({ sportEventId, ...tierColumns(tier) })) });
      }
      if (removed.length === 0) {
        return;
      }
      const target = reassignTo
        ? existingByKey.get(reassignTo)
          ?? await tx.sportEventTier.findUniqueOrThrow({ where: { sportEventId_tierKey: { sportEventId, tierKey: reassignTo } } })
        : null;
      const removedIds = removed.map((tier) => tier.id);
      await tx.sportEventParticipantValuation.updateMany({
        where: { sportEventTierId: { in: removedIds } },
        data: { sportEventTierId: target?.id ?? null, tierOrderIndex: null },
      });
      await tx.sportEventTier.deleteMany({ where: { id: { in: removedIds } } });
    });
  }

  async countValuations(sportEventId: string): Promise<Map<string, number>> {
    const tiers = await this.prisma.sportEventTier.findMany({
      where: { sportEventId },
      select: { id: true, _count: { select: { valuations: true } } },
    });
    return new Map(tiers.map((tier) => [tier.id, tier._count.valuations]));
  }
}

export class PrismaSportEventParticipantValuationRepository implements SportEventParticipantValuationRepository {
  constructor(private readonly prisma: Db) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventParticipantValuation[]> {
    return this.findBySportEvents([sportEventId]);
  }

  async findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventParticipantValuation[]> {
    if (sportEventIds.length === 0) return [];
    const rows = await this.prisma.sportEventParticipantValuation.findMany({
      where: { sportEventParticipant: { sportEventId: { in: [...sportEventIds] } } },
      orderBy: [{ sportEventTier: { tierNumber: 'asc' } }, { tierOrderIndex: 'asc' }],
    });
    return rows.map(toValuation);
  }

  async assignTiers(assignments: readonly TierAssignment[]): Promise<void> {
    await this.prisma.$transaction((tx) => rewriteValuations(tx, assignments.map((assignment) => ({
      sportEventParticipantId: assignment.sportEventParticipantId,
      sportEventTierId: assignment.sportEventTierId,
      tierOrderIndex: assignment.tierOrderIndex,
      tierAssignedSource: assignment.source,
    }))));
  }

  async assignEventPrices(input: {
    sportEventId: string;
    pricingConfig: EventPricingConfig;
    assignments: readonly PriceAssignment[];
  }): Promise<void> {
    await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.$transaction(async (tx) => {
      await rewriteValuations(tx, input.assignments.map((assignment) => ({
        sportEventParticipantId: assignment.sportEventParticipantId,
        price: assignment.price,
        priceAssignedSource: assignment.source,
      })));
      await tx.sportEvent.update({
        where: { id: input.sportEventId },
        data: { pricingConfig: input.pricingConfig },
      });
    }));
  }
}

/** A change to one field row's valuation: its tier columns, its price columns, or both. */
type ValuationChange = { sportEventParticipantId: string } & Partial<Pick<
  Prisma.SportEventParticipantValuationUncheckedCreateInput,
  'sportEventTierId' | 'tierOrderIndex' | 'tierAssignedSource' | 'price' | 'priceAssignedSource'
>>;

/**
 * Writes each field row's valuation change in three statements, however many rows change
 * (#1252). Prisma has no update of many rows to different values, and nothing points at a
 * valuation row, so the changed rows are read, deleted and inserted again with the change
 * applied, each keeping its id, its creation time and the columns the change leaves alone. A
 * row with no valuation yet gets one. Runs inside the caller's transaction.
 */
async function rewriteValuations(tx: Prisma.TransactionClient, changes: readonly ValuationChange[]): Promise<void> {
  // A row changed twice keeps the later change, as two upserts in a row would leave it.
  const changeById = new Map<string, ValuationChange>();
  for (const change of changes) {
    changeById.set(change.sportEventParticipantId, { ...changeById.get(change.sportEventParticipantId), ...change });
  }
  if (changeById.size === 0) return;
  const existing = await tx.sportEventParticipantValuation.findMany({
    where: { sportEventParticipantId: { in: [...changeById.keys()] } },
  });
  const existingById = new Map(existing.map(({ updatedAt: _updatedAt, ...row }) => [row.sportEventParticipantId, row]));
  if (existing.length > 0) {
    await tx.sportEventParticipantValuation.deleteMany({ where: { id: { in: existing.map((row) => row.id) } } });
  }
  await tx.sportEventParticipantValuation.createMany({
    data: [...changeById.values()].map((change) => ({ ...existingById.get(change.sportEventParticipantId), ...change })),
  });
}

function countMap(ids: readonly string[], counted: Array<[string, number]>): Map<string, number> {
  const counts = new Map(ids.map((id) => [id, 0]));
  for (const [id, count] of counted) {
    counts.set(id, count);
  }
  return counts;
}

function toSport(row: Prisma.SportGetPayload<object>): SportConfig {
  return {
    id: row.id,
    sport: row.sport,
    participantType: row.participantType,
    tournamentFormat: row.tournamentFormat,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSportLeague(row: Prisma.SportLeagueGetPayload<object>): SportLeague {
  return {
    id: row.id,
    sportId: row.sportId,
    name: row.name,
    matchKeyword: row.matchKeyword,
    currentEventYear: row.currentEventYear,
    isActive: row.isActive,
    bracketAdvancement: row.bracketAdvancement,
    roundNames: row.roundNames,
    tierCount: row.tierCount,
    matchPeriodLayout: row.matchPeriodLayout,
    squaresFromRound: row.squaresFromRound,
    noun: row.noun,
    displayName: row.displayName,
    displayOrder: row.displayOrder,
    participantType: row.participantType,
    scoringFamily: row.scoringFamily,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAffiliation(
  row: Prisma.ParticipantLeagueAffiliationGetPayload<{ include: { participant: true } }>,
): ParticipantLeagueAffiliation {
  return {
    id: row.id,
    participantId: row.participantId,
    sportLeagueId: row.sportLeagueId,
    ranking: row.ranking,
    participant: mapToParticipant(row.participant),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Every SportEvent read carries its series' sport league, the event's one path to it, and what
 * the league plays differently from its sport: its period layout, first squares round,
 * participant type and scoring family.
 */
const SPORT_EVENT_INCLUDE = {
  eventSeries: {
    select: {
      sportLeagueId: true,
      sportLeague: { select: { matchPeriodLayout: true, squaresFromRound: true, participantType: true, scoringFamily: true } },
    },
  },
} as const;

function toSportEvent(row: Prisma.SportEventGetPayload<{ include: typeof SPORT_EVENT_INCLUDE }>): SportEvent {
  return {
    id: row.id,
    externalId: row.externalId,
    providerId: row.providerId,
    sport: row.sport as Sport,
    name: row.name,
    venue: row.venue ?? undefined,
    location: row.location ?? undefined,
    startDate: row.startDate,
    endDate: row.endDate ?? undefined,
    status: row.status as SportEventStatus,
    rounds: row.rounds ?? undefined,
    roundsPar: row.roundsPar ?? undefined,
    participantCount: row.participantCount ?? undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    eventSeriesId: row.eventSeriesId,
    eventYear: row.eventYear,
    sportLeagueId: row.eventSeries.sportLeagueId,
    ...(row.eventSeries.sportLeague.matchPeriodLayout !== null && { matchPeriodLayout: row.eventSeries.sportLeague.matchPeriodLayout }),
    ...(row.eventSeries.sportLeague.squaresFromRound !== null && { squaresFromRound: row.eventSeries.sportLeague.squaresFromRound }),
    ...(row.eventSeries.sportLeague.participantType !== null && { participantType: row.eventSeries.sportLeague.participantType }),
    ...(row.eventSeries.sportLeague.scoringFamily !== null && { scoringFamily: row.eventSeries.sportLeague.scoringFamily }),
    syncScope: row.syncScope as SportEventSyncScope,
    autoLifecycleEnabled: row.autoLifecycleEnabled,
    ...(row.pricingConfig !== null && { pricingConfig: EventPricingConfigSchema.parse(row.pricingConfig) }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSportEventRound(row: Prisma.SportEventRoundGetPayload<object>): SportEventRound {
  return {
    id: row.id,
    sportEventId: row.sportEventId,
    roundNumber: row.roundNumber,
    scheduledDate: row.scheduledDate,
    scheduledEndAt: row.scheduledEndAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The field columns a patch sets; undefined leaves one alone, null clears it. */
function fieldPatch(patch: SportEventParticipantPatch) {
  return {
    ...(patch.isActive !== undefined && { isActive: patch.isActive }),
    ...(patch.inactiveReason !== undefined && { inactiveReason: patch.inactiveReason }),
    ...(patch.ranking !== undefined && { ranking: patch.ranking }),
    ...(patch.oddsToWin !== undefined && { oddsToWin: patch.oddsToWin }),
    ...(patch.seedNumber !== undefined && { seedNumber: patch.seedNumber }),
    ...(patch.isPlayInPlace !== undefined && { isPlayInPlace: patch.isPlayInPlace }),
  };
}

export function toSportEventParticipant(row: Prisma.SportEventParticipantGetPayload<object>): SportEventParticipant {
  return {
    id: row.id,
    sportEventId: row.sportEventId,
    participantId: row.participantId,
    isActive: row.isActive,
    inactiveReason: (row.inactiveReason ?? undefined) as ParticipantInactiveReason | undefined,
    ranking: row.ranking ?? undefined,
    oddsToWin: row.oddsToWin === null ? undefined : Number(row.oddsToWin),
    seedNumber: row.seedNumber ?? undefined,
    isPlayInPlace: row.isPlayInPlace,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function tierColumns(tier: SportEventTierDefinition) {
  return { tierKey: tier.tierKey, label: tier.label, tierNumber: tier.tierNumber };
}

function toTier(row: Prisma.SportEventTierGetPayload<object>): SportEventTier {
  return {
    id: row.id,
    sportEventId: row.sportEventId,
    ...tierColumns(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toValuation(row: Prisma.SportEventParticipantValuationGetPayload<object>): SportEventParticipantValuation {
  return {
    id: row.id,
    sportEventParticipantId: row.sportEventParticipantId,
    sportEventTierId: row.sportEventTierId,
    tierOrderIndex: row.tierOrderIndex,
    tierAssignedSource: row.tierAssignedSource as ValuationSource | null,
    price: row.price === null ? null : Number(row.price),
    priceAssignedSource: row.priceAssignedSource as ValuationSource | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
