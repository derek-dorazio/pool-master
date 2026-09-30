/**
 * Prisma adapters for the cross-sport catalog and event-core ports (#235, #236):
 * Sport, SportLeague, Season, ParticipantLeagueAffiliation, SportEvent, LeagueEvent,
 * SportEventRound, SportEventParticipant, SportEventTier,
 * SportEventParticipantValuation, and the core SportEventParticipantRound / Standing rows.
 *
 * Sport extension rows (the golf round and standing tables) are not read here —
 * a core row never carries a sport particular.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  LeagueEventRepository,
  ParticipantLeagueAffiliationRepository,
  ParticipantRanking,
  PriceAssignment,
  SeasonFilters,
  SeasonRepository,
  SeasonUpdate,
  SportEventCreate,
  SportEventFieldRecordCounts,
  SportEventFilters,
  SportEventParticipantCreate,
  SportEventParticipantFieldUpdate,
  SportEventParticipantPatch,
  SportEventParticipantRepository,
  SportEventParticipantRoundRepository,
  SportEventParticipantValuationRepository,
  SportEventParticipantStandingRepository,
  SportEventProviderSummary,
  SportEventRepository,
  SportEventRoundRepository,
  SportEventRoundSchedule,
  SportEventTierDefinition,
  SportEventTierRepository,
  SportEventUpdate,
  SportLeagueFilters,
  SportLeagueRepository,
  SportLeagueUpdate,
  SportRepository,
  TierAssignment,
} from '@poolmaster/shared/db';
import type {
  LeagueEvent,
  ParticipantInactiveReason,
  ParticipantLeagueAffiliation,
  ParticipantType,
  Season,
  Sport,
  SportCategory,
  SportConfig,
  SportEvent,
  SportEventParticipant,
  SportEventParticipantRound,
  SportEventParticipantStanding,
  SportEventParticipantValuation,
  SportEventRound,
  SportEventTier,
  SportLeague,
  TournamentFormat,
  ValuationSource,
} from '@poolmaster/shared/domain';
import { SportEventStatus, SportEventSyncScope } from '@poolmaster/shared/domain';
import { mapToParticipant } from './prisma-participant-repository';

type Db = PrismaClient;

export class PrismaSportRepository implements SportRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<SportConfig | null> {
    const row = await this.prisma.sport.findUnique({ where: { id } });
    return row ? toSport(row) : null;
  }

  async findByName(name: Sport): Promise<SportConfig | null> {
    const row = await this.prisma.sport.findUnique({ where: { name } });
    return row ? toSport(row) : null;
  }

  async findAll(): Promise<SportConfig[]> {
    const rows = await this.prisma.sport.findMany({ orderBy: { name: 'asc' } });
    return rows.map(toSport);
  }
}

export class PrismaSportLeagueRepository implements SportLeagueRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<SportLeague | null> {
    const row = await this.prisma.sportLeague.findUnique({ where: { id } });
    return row ? toSportLeague(row) : null;
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

  async create(input: Pick<SportLeague, 'sportId' | 'name' | 'matchKeyword'>): Promise<SportLeague> {
    return toSportLeague(await this.prisma.sportLeague.create({
      data: { sportId: input.sportId, name: input.name, matchKeyword: input.matchKeyword },
    }));
  }

  async update(id: string, updates: SportLeagueUpdate): Promise<SportLeague> {
    return toSportLeague(await this.prisma.sportLeague.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.matchKeyword !== undefined && { matchKeyword: updates.matchKeyword }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.currentSeasonId !== undefined && { currentSeasonId: updates.currentSeasonId }),
      },
    }));
  }
}

export class PrismaSeasonRepository implements SeasonRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<Season | null> {
    const row = await this.prisma.season.findUnique({ where: { id } });
    return row ? toSeason(row) : null;
  }

  async findAll(filters: SeasonFilters): Promise<Season[]> {
    const rows = await this.prisma.season.findMany({
      where: {
        ...(filters.sportId !== undefined && { sportLeague: { sportId: filters.sportId } }),
        ...(filters.sportLeagueId !== undefined && { sportLeagueId: filters.sportLeagueId }),
        ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      },
      orderBy: [{ sportLeagueId: 'asc' }, { year: 'desc' }],
    });
    return rows.map(toSeason);
  }

  async findBySportLeagueAndYear(sportLeagueId: string, year: number): Promise<Season | null> {
    const row = await this.prisma.season.findUnique({ where: { sportLeagueId_year: { sportLeagueId, year } } });
    return row ? toSeason(row) : null;
  }

  async create(input: Pick<Season, 'sportLeagueId' | 'name' | 'year' | 'startDate' | 'endDate'>): Promise<Season> {
    return toSeason(await this.prisma.season.create({
      data: {
        sportLeagueId: input.sportLeagueId,
        name: input.name,
        year: input.year,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    }));
  }

  async update(id: string, updates: SeasonUpdate): Promise<Season> {
    return toSeason(await this.prisma.season.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.startDate !== undefined && { startDate: updates.startDate }),
        ...(updates.endDate !== undefined && { endDate: updates.endDate }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
      },
    }));
  }

  async countBySportLeagues(sportLeagueIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.season.groupBy({
      by: ['sportLeagueId'],
      where: { sportLeagueId: { in: [...sportLeagueIds] } },
      _count: { _all: true },
    });
    return countMap(sportLeagueIds, groups.map((group) => [group.sportLeagueId, group._count._all]));
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
    await this.prisma.$transaction(rankings.map((entry) => this.prisma.participantLeagueAffiliation.update({
      where: { participantId_sportLeagueId: { participantId: entry.participantId, sportLeagueId } },
      data: { ranking: entry.ranking },
    })));
  }

  async upsertRankings(sportLeagueId: string, rankings: readonly ParticipantRanking[]): Promise<void> {
    await this.prisma.$transaction(rankings.map((entry) => this.prisma.participantLeagueAffiliation.upsert({
      where: { participantId_sportLeagueId: { participantId: entry.participantId, sportLeagueId } },
      create: { participantId: entry.participantId, sportLeagueId, ranking: entry.ranking },
      update: { ranking: entry.ranking },
    })));
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
    const row = await this.prisma.sportEvent.findUnique({ where: { id } });
    return row ? toSportEvent(row) : null;
  }

  async findByProviderRef(providerId: string, externalId: string): Promise<SportEvent | null> {
    const row = await this.prisma.sportEvent.findFirst({ where: { providerId, externalId } });
    return row ? toSportEvent(row) : null;
  }

  async findAll(filters: SportEventFilters): Promise<SportEvent[]> {
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        ...(filters.sport !== undefined && { sport: filters.sport }),
        ...(filters.status !== undefined && { status: filters.status }),
        ...(filters.seasonId !== undefined && { seasonId: filters.seasonId }),
        ...(filters.q !== undefined && { name: { contains: filters.q, mode: 'insensitive' as const } }),
      },
      orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toSportEvent);
  }

  async create(input: SportEventCreate): Promise<SportEvent> {
    return toSportEvent(await this.prisma.sportEvent.create({
      data: {
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
        releaseAt: input.releaseAt,
        fieldLocksAt: input.fieldLocksAt,
        seasonId: input.seasonId ?? null,
        leagueEventId: input.leagueEventId ?? null,
        syncScope: input.syncScope,
        autoLifecycleEnabled: input.autoLifecycleEnabled,
      },
    }));
  }

  async update(id: string, updates: SportEventUpdate): Promise<SportEvent> {
    return toSportEvent(await this.prisma.sportEvent.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.venue !== undefined && { venue: updates.venue }),
        ...(updates.location !== undefined && { location: updates.location }),
        ...(updates.startDate !== undefined && { startDate: updates.startDate }),
        ...(updates.endDate !== undefined && { endDate: updates.endDate }),
        ...(updates.rounds !== undefined && { rounds: updates.rounds }),
        ...(updates.releaseAt !== undefined && { releaseAt: updates.releaseAt }),
        ...(updates.fieldLocksAt !== undefined && { fieldLocksAt: updates.fieldLocksAt }),
        ...(updates.autoLifecycleEnabled !== undefined && { autoLifecycleEnabled: updates.autoLifecycleEnabled }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.providerId !== undefined && { providerId: updates.providerId }),
        ...(updates.externalId !== undefined && { externalId: updates.externalId }),
        ...(updates.syncScope !== undefined && { syncScope: updates.syncScope }),
      },
    }));
  }

  async delete(id: string): Promise<void> {
    // Every child holds a RESTRICT foreign key, so they go first, extension rows before
    // their core rows. Deleting only the event row failed for any event with a round.
    const field = { sportEventParticipant: { sportEventId: id } };
    await this.prisma.$transaction([
      this.prisma.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: field } }),
      this.prisma.sportEventParticipantRound.deleteMany({ where: field }),
      this.prisma.sportEventParticipantGolfStanding.deleteMany({ where: { standing: field } }),
      this.prisma.sportEventParticipantStanding.deleteMany({ where: field }),
      this.prisma.sportEventParticipantValuation.deleteMany({ where: field }),
      this.prisma.sportEventParticipant.deleteMany({ where: { sportEventId: id } }),
      this.prisma.sportEventRound.deleteMany({ where: { sportEventId: id } }),
      this.prisma.sportEventTier.deleteMany({ where: { sportEventId: id } }),
      this.prisma.sportEvent.delete({ where: { id } }),
    ]);
  }

  async countParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEventParticipant.groupBy({
      by: ['sportEventId'],
      where: { sportEventId: { in: [...sportEventIds] } },
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

  async countContests(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.contest.groupBy({
      by: ['sportEventId'],
      where: { sportEventId: { in: [...sportEventIds] } },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.flatMap((group) => (group.sportEventId ? [[group.sportEventId, group._count._all] as [string, number]] : [])));
  }

  async countBySeasons(seasonIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEvent.groupBy({
      by: ['seasonId'],
      where: { seasonId: { in: [...seasonIds] } },
      _count: { _all: true },
    });
    return countMap(seasonIds, groups.flatMap((group) => (group.seasonId ? [[group.seasonId, group._count._all] as [string, number]] : [])));
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

  async countFieldRecords(sportEventIds: readonly string[]): Promise<Map<string, SportEventFieldRecordCounts>> {
    const participants = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      select: {
        sportEventId: true,
        valuation: { select: { id: true } },
        _count: { select: { picks: true, rounds: true } },
      },
    });
    const counts = new Map<string, SportEventFieldRecordCounts>(
      sportEventIds.map((id) => [id, { valuations: 0, rounds: 0, picks: 0 }]),
    );
    for (const participant of participants) {
      const eventCounts = counts.get(participant.sportEventId);
      if (!eventCounts) continue;
      // valuation is 1:1 with the participant, so this counts participants that have one.
      if (participant.valuation) eventCounts.valuations += 1;
      eventCounts.rounds += participant._count.rounds;
      eventCounts.picks += participant._count.picks;
    }
    return counts;
  }

  async findAutoLifecycleCandidates(): Promise<SportEvent[]> {
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        autoLifecycleEnabled: true,
        syncScope: { not: SportEventSyncScope.FULL },
        status: { in: [SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS] },
      },
    });
    return rows.map(toSportEvent);
  }
}

export class PrismaLeagueEventRepository implements LeagueEventRepository {
  constructor(private readonly prisma: Db) {}

  async findOrCreate(sportLeagueId: string, name: string): Promise<LeagueEvent> {
    const row = await this.prisma.leagueEvent.upsert({
      where: { sportLeagueId_name: { sportLeagueId, name } },
      create: { sportLeagueId, name },
      update: {},
    });
    return { id: row.id, sportLeagueId: row.sportLeagueId, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt };
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

  async createMany(sportEventId: string, rounds: readonly SportEventRoundSchedule[]): Promise<void> {
    await this.prisma.$transaction(rounds.map((round) => this.prisma.sportEventRound.create({
      data: {
        sportEventId,
        roundNumber: round.roundNumber,
        scheduledDate: round.scheduledDate,
        scheduledEndAt: round.scheduledEndAt ?? null,
      },
    })));
  }

  async reschedule(sportEventId: string, rounds: readonly SportEventRoundSchedule[]): Promise<void> {
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

export class PrismaSportEventParticipantRepository implements SportEventParticipantRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<SportEventParticipant | null> {
    const row = await this.prisma.sportEventParticipant.findUnique({ where: { id } });
    return row ? toSportEventParticipant(row) : null;
  }

  async findBySportEvent(sportEventId: string): Promise<SportEventParticipant[]> {
    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId },
      orderBy: [{ seedNumber: { sort: 'asc', nulls: 'last' } }, { participant: { name: 'asc' } }],
    });
    return rows.map(toSportEventParticipant);
  }

  async create(
    participant: Omit<SportEventParticipant, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SportEventParticipant> {
    return toSportEventParticipant(await this.prisma.sportEventParticipant.create({
      data: {
        sportEventId: participant.sportEventId,
        participantId: participant.participantId,
        isActive: participant.isActive,
        inactiveReason: participant.inactiveReason,
        ranking: participant.ranking,
        oddsToWin: participant.oddsToWin,
        seedNumber: participant.seedNumber,
        metadata: participant.metadata as object,
      },
    }));
  }

  async update(id: string, updates: Partial<SportEventParticipant>): Promise<SportEventParticipant> {
    return toSportEventParticipant(await this.prisma.sportEventParticipant.update({
      where: { id },
      data: {
        ...fieldPatch(updates),
        ...(updates.metadata !== undefined && { metadata: updates.metadata as object }),
      },
    }));
  }

  async createMany(sportEventId: string, rows: readonly SportEventParticipantCreate[]): Promise<void> {
    await this.prisma.$transaction(rows.map((row) => this.prisma.sportEventParticipant.create({
      data: { sportEventId, participantId: row.participantId, ...fieldPatch(row) },
    })));
  }

  async upsertMany(sportEventId: string, rows: readonly SportEventParticipantCreate[]): Promise<void> {
    await this.prisma.$transaction(rows.map((row) => this.prisma.sportEventParticipant.upsert({
      where: { sportEventId_participantId: { sportEventId, participantId: row.participantId } },
      create: { sportEventId, participantId: row.participantId, ...fieldPatch(row) },
      update: fieldPatch(row),
    })));
  }

  async updateMany(entries: readonly SportEventParticipantFieldUpdate[]): Promise<void> {
    await this.prisma.$transaction(entries.map((entry) => this.prisma.sportEventParticipant.update({
      where: { id: entry.id },
      data: {
        ...fieldPatch(entry.updates),
        ...(entry.price !== undefined && {
          valuation: {
            upsert: {
              create: { price: entry.price, priceAssignedSource: 'MANUAL' },
              update: { price: entry.price, priceAssignedSource: 'MANUAL' },
            },
          },
        }),
      },
    })));
  }

  async delete(id: string): Promise<void> {
    const own = { sportEventParticipantId: id };
    await this.prisma.$transaction([
      this.prisma.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: own } }),
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
}

export class PrismaSportEventTierRepository implements SportEventTierRepository {
  constructor(private readonly prisma: Db) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventTier[]> {
    const rows = await this.prisma.sportEventTier.findMany({ where: { sportEventId }, orderBy: { tierNumber: 'asc' } });
    return rows.map(toTier);
  }

  async createMany(sportEventId: string, tiers: readonly SportEventTierDefinition[]): Promise<void> {
    await this.prisma.$transaction(tiers.map((tier) => this.prisma.sportEventTier.create({
      data: { sportEventId, ...tierColumns(tier) },
    })));
  }

  async replace(sportEventId: string, tiers: readonly SportEventTierDefinition[], reassignTo?: string): Promise<void> {
    const keep = new Set(tiers.map((tier) => tier.tierKey));
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.sportEventTier.findMany({ where: { sportEventId } });
      // Park every current tier number out of range first, so two tiers swapping numbers
      // never collide on the (sportEventId, tierNumber) unique index.
      for (const tier of existing) {
        await tx.sportEventTier.update({ where: { id: tier.id }, data: { tierNumber: -(tier.tierNumber + 1) } });
      }
      for (const tier of tiers) {
        await tx.sportEventTier.upsert({
          where: { sportEventId_tierKey: { sportEventId, tierKey: tier.tierKey } },
          create: { sportEventId, ...tierColumns(tier) },
          update: { label: tier.label, tierNumber: tier.tierNumber, defaultPickCount: tier.defaultPickCount },
        });
      }
      const removedIds = existing.filter((tier) => !keep.has(tier.tierKey)).map((tier) => tier.id);
      if (removedIds.length === 0) {
        return;
      }
      const target = reassignTo
        ? await tx.sportEventTier.findUniqueOrThrow({ where: { sportEventId_tierKey: { sportEventId, tierKey: reassignTo } } })
        : null;
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
    const rows = await this.prisma.sportEventParticipantValuation.findMany({
      where: { sportEventParticipant: { sportEventId } },
      orderBy: [{ sportEventTier: { tierNumber: 'asc' } }, { tierOrderIndex: 'asc' }],
    });
    return rows.map(toValuation);
  }

  async assignTiers(assignments: readonly TierAssignment[]): Promise<void> {
    await this.prisma.$transaction(assignments.map((assignment) => {
      const tier = {
        sportEventTierId: assignment.sportEventTierId,
        tierOrderIndex: assignment.tierOrderIndex,
        tierAssignedSource: assignment.source,
      };
      return this.prisma.sportEventParticipantValuation.upsert({
        where: { sportEventParticipantId: assignment.sportEventParticipantId },
        create: { sportEventParticipantId: assignment.sportEventParticipantId, ...tier },
        update: tier,
      });
    }));
  }

  async assignPrices(assignments: readonly PriceAssignment[]): Promise<void> {
    await this.prisma.$transaction(assignments.map((assignment) => {
      const price = { price: assignment.price, priceAssignedSource: assignment.source };
      return this.prisma.sportEventParticipantValuation.upsert({
        where: { sportEventParticipantId: assignment.sportEventParticipantId },
        create: { sportEventParticipantId: assignment.sportEventParticipantId, ...price },
        update: price,
      });
    }));
  }
}

const PARTICIPANT_ROUND_INCLUDE = { sportEventRound: { select: { roundNumber: true } } } as const;

export class PrismaSportEventParticipantRoundRepository implements SportEventParticipantRoundRepository {
  constructor(private readonly prisma: Db) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventParticipantRound[]> {
    const rows = await this.prisma.sportEventParticipantRound.findMany({
      where: { sportEventParticipant: { sportEventId } },
      include: PARTICIPANT_ROUND_INCLUDE,
      orderBy: [{ sportEventParticipantId: 'asc' }, { sportEventRound: { roundNumber: 'asc' } }],
    });
    return rows.map(toParticipantRound);
  }

  async findBySportEventParticipant(sportEventParticipantId: string): Promise<SportEventParticipantRound[]> {
    const rows = await this.prisma.sportEventParticipantRound.findMany({
      where: { sportEventParticipantId },
      include: PARTICIPANT_ROUND_INCLUDE,
      orderBy: { sportEventRound: { roundNumber: 'asc' } },
    });
    return rows.map(toParticipantRound);
  }

  async findBySportEventRound(sportEventRoundId: string): Promise<SportEventParticipantRound[]> {
    const rows = await this.prisma.sportEventParticipantRound.findMany({
      where: { sportEventRoundId },
      include: PARTICIPANT_ROUND_INCLUDE,
      orderBy: { sportEventParticipantId: 'asc' },
    });
    return rows.map(toParticipantRound);
  }
}

export class PrismaSportEventParticipantStandingRepository implements SportEventParticipantStandingRepository {
  constructor(private readonly prisma: Db) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventParticipantStanding[]> {
    const rows = await this.prisma.sportEventParticipantStanding.findMany({
      where: { sportEventParticipant: { sportEventId } },
      orderBy: [{ position: { sort: 'asc', nulls: 'last' } }, { sportEventParticipantId: 'asc' }],
    });
    return rows.map(toStanding);
  }

  async findBySportEventParticipant(sportEventParticipantId: string): Promise<SportEventParticipantStanding | null> {
    const row = await this.prisma.sportEventParticipantStanding.findUnique({ where: { sportEventParticipantId } });
    return row ? toStanding(row) : null;
  }
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
    name: row.name as Sport,
    participantType: row.participantType as ParticipantType,
    category: row.category as SportCategory,
    tournamentFormat: row.tournamentFormat as TournamentFormat,
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
    currentSeasonId: row.currentSeasonId,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSeason(row: Prisma.SeasonGetPayload<object>): Season {
  return {
    id: row.id,
    sportLeagueId: row.sportLeagueId,
    name: row.name,
    year: row.year,
    startDate: row.startDate,
    endDate: row.endDate,
    isActive: row.isActive,
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

function toSportEvent(row: Prisma.SportEventGetPayload<object>): SportEvent {
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
    participantCount: row.participantCount ?? undefined,
    fieldLocked: row.fieldLocked,
    releaseAt: row.releaseAt,
    fieldLocksAt: row.fieldLocksAt,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    seasonId: row.seasonId ?? undefined,
    leagueEventId: row.leagueEventId ?? undefined,
    syncScope: row.syncScope as SportEventSyncScope,
    autoLifecycleEnabled: row.autoLifecycleEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toParticipantRound(
  row: Prisma.SportEventParticipantRoundGetPayload<{ include: typeof PARTICIPANT_ROUND_INCLUDE }>,
): SportEventParticipantRound {
  return {
    id: row.id,
    sportEventParticipantId: row.sportEventParticipantId,
    sportEventRoundId: row.sportEventRoundId,
    roundNumber: row.sportEventRound.roundNumber,
    status: row.status,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStanding(row: Prisma.SportEventParticipantStandingGetPayload<object>): SportEventParticipantStanding {
  return {
    id: row.id,
    sportEventParticipantId: row.sportEventParticipantId,
    position: row.position,
    displayPosition: row.displayPosition,
    status: row.status,
    asOf: row.asOf,
    currentRound: row.currentRound,
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
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function tierColumns(tier: SportEventTierDefinition) {
  return { tierKey: tier.tierKey, label: tier.label, tierNumber: tier.tierNumber, defaultPickCount: tier.defaultPickCount };
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
