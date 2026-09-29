/**
 * Prisma adapters for the cross-sport catalog and event-core ports (#235):
 * Sport, SportLeague, Season, ParticipantLeagueAffiliation, SportEvent,
 * SportEventRound, and the core SportEventParticipantRound / Standing rows.
 *
 * Sport extension rows (the golf round and standing tables) are not read here —
 * a core row never carries a sport particular.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ParticipantLeagueAffiliationRepository,
  ParticipantRanking,
  SeasonFilters,
  SeasonRepository,
  SeasonUpdate,
  SportEventFilters,
  SportEventParticipantRoundRepository,
  SportEventParticipantStandingRepository,
  SportEventRepository,
  SportEventRoundRepository,
  SportLeagueFilters,
  SportLeagueRepository,
  SportLeagueUpdate,
  SportRepository,
} from '@poolmaster/shared/db';
import type {
  ParticipantLeagueAffiliation,
  ParticipantType,
  Season,
  Sport,
  SportCategory,
  SportConfig,
  SportEvent,
  SportEventParticipantRound,
  SportEventParticipantStanding,
  SportEventRound,
  SportEventStatus,
  SportEventSyncScope,
  SportLeague,
  TournamentFormat,
} from '@poolmaster/shared/domain';
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

  async findAll(filters: SportEventFilters): Promise<SportEvent[]> {
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        ...(filters.sport !== undefined && { sport: filters.sport }),
        ...(filters.status !== undefined && { status: filters.status }),
        ...(filters.seasonId !== undefined && { seasonId: filters.seasonId }),
      },
      orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toSportEvent);
  }

  async countParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEventParticipant.groupBy({
      by: ['sportEventId'],
      where: { sportEventId: { in: [...sportEventIds] } },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.map((group) => [group.sportEventId, group._count._all]));
  }

  async countBySeasons(seasonIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEvent.groupBy({
      by: ['seasonId'],
      where: { seasonId: { in: [...seasonIds] } },
      _count: { _all: true },
    });
    return countMap(seasonIds, groups.flatMap((group) => (group.seasonId ? [[group.seasonId, group._count._all] as [string, number]] : [])));
  }
}

export class PrismaSportEventRoundRepository implements SportEventRoundRepository {
  constructor(private readonly prisma: Db) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventRound[]> {
    const rows = await this.prisma.sportEventRound.findMany({
      where: { sportEventId },
      orderBy: { roundNumber: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      sportEventId: row.sportEventId,
      roundNumber: row.roundNumber,
      scheduledDate: row.scheduledDate,
      scheduledEndAt: row.scheduledEndAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}

const PARTICIPANT_ROUND_INCLUDE = { sportEventRound: { select: { roundNumber: true } } } as const;

export class PrismaSportEventParticipantRoundRepository implements SportEventParticipantRoundRepository {
  constructor(private readonly prisma: Db) {}

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
