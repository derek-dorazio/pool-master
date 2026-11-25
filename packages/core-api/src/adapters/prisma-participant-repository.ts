/**
 * Prisma adapter for ParticipantRepository port.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  ParticipantFeedId,
  ParticipantMatchQuery,
  ParticipantRanking,
  ParticipantRepository,
  ParticipantSearchFilters,
} from '@poolmaster/shared/db';
import type { BackgroundJobRequest, Participant, InjuryStatus, ParticipantType, ParticipantStatus } from '@poolmaster/shared/domain';
import { backgroundJobsInsert } from './prisma-background-job-repository';

export class PrismaParticipantRepository implements ParticipantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Participant | null> {
    const row = await this.prisma.participant.findUnique({ where: { id } });
    return row ? mapToParticipant(row) : null;
  }

  async search(query: string, filters: ParticipantSearchFilters): Promise<Participant[]> {
    const where: Prisma.ParticipantWhereInput = {
      ...(filters.sportLeagueId && { sportLeagueId: filters.sportLeagueId }),
      ...(filters.status && { status: filters.status }),
    };

    // Full-text search on name fields
    if (query.trim()) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { shortName: { contains: query, mode: 'insensitive' } },
        { teamAffiliation: { contains: query, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.participant.findMany({ where, orderBy: { name: 'asc' } });
    return rows.map(mapToParticipant);
  }

  async findMatchingAny(sportLeagueId: string, queries: readonly ParticipantMatchQuery[]): Promise<Participant[]> {
    if (queries.length === 0) return [];
    const rows = await this.prisma.participant.findMany({
      where: {
        sportLeagueId,
        // A ranking upload ranks the roster; a test participant is on none (#2096).
        isTestData: false,
        OR: queries.map((query) => ({
          ...(query.id !== undefined && { id: query.id }),
          // A feed id is the provider's, kept only on the participant's provider mappings (#2040).
          ...(query.externalId !== undefined && { providerMappings: { some: { sportLeagueId, externalId: query.externalId } } }),
          ...(query.name !== undefined && { name: { equals: query.name, mode: 'insensitive' as const } }),
        })),
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(mapToParticipant);
  }

  async findBySportLeague(sportLeagueId: string): Promise<Participant[]> {
    const rows = await this.prisma.participant.findMany({
      // The roster: a test participant is on none (#2096).
      where: { sportLeagueId, isTestData: false },
      orderBy: [{ ranking: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    });
    return rows.map(mapToParticipant);
  }

  /**
   * Every ranking in one statement, whatever the list's length (#1252), scoped to the sport league
   * so a participant of another league is never re-ranked: a ranking for one is an error, as an
   * update of a missing row is, and leaves every ranking as it was. Raw because Prisma has no
   * update of many rows to different values, as the standings email positions' record is.
   */
  async updateRankings(sportLeagueId: string, rankings: readonly ParticipantRanking[]): Promise<void> {
    // A participant ranked twice keeps the later ranking, as two updates in a row would leave it.
    const latest = [...new Map(rankings.map((entry) => [entry.participantId, entry])).values()];
    if (latest.length === 0) return;
    const ids = latest.map((entry) => entry.participantId);
    const ranks = latest.map((entry) => entry.ranking);
    await this.prisma.$transaction(async (tx) => {
      // poolmaster-allow-raw-sql: a set-based update from unnest arrays: Prisma can't update many rows to different values in one statement
      const updated = await tx.$executeRaw`
        UPDATE "participants" AS participant
        SET "ranking" = ranked.ranking, "updated_at" = now()
        FROM unnest(${ids}::uuid[], ${ranks}::int[]) AS ranked(id, ranking)
        WHERE participant.id = ranked.id AND participant.sport_league_id = ${sportLeagueId}::uuid`;
      if (updated !== latest.length) {
        throw new Error(`Only ${updated} of the ${latest.length} participants to rank are in sport league ${sportLeagueId}.`);
      }
    });
  }

  async countBySportLeagues(sportLeagueIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.participant.groupBy({
      by: ['sportLeagueId'],
      where: { sportLeagueId: { in: [...sportLeagueIds] }, isTestData: false },
      _count: { _all: true },
    });
    const counts = new Map(sportLeagueIds.map((id) => [id, 0]));
    for (const group of groups) counts.set(group.sportLeagueId, group._count._all);
    return counts;
  }

  async findByIds(ids: readonly string[]): Promise<Participant[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.participant.findMany({ where: { id: { in: [...ids] } }, orderBy: { name: 'asc' } });
    return rows.map(mapToParticipant);
  }

  async create(participant: Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>): Promise<Participant> {
    const row = await this.prisma.participant.create({ data: toParticipantCreateData(participant) });
    return mapToParticipant(row);
  }

  async deleteUnfieldedTestParticipants(sportLeagueId: string): Promise<number> {
    // A test participant never has a provider mapping, so its field rows are all that can hold it.
    const { count } = await this.prisma.participant.deleteMany({ where: { sportLeagueId, isTestData: true, sportEventParticipants: { none: {} } } });
    return count;
  }

  async createWithProviderMapping(
    participant: Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>,
    feedId: ParticipantFeedId,
    jobs: readonly BackgroundJobRequest[] = [],
  ): Promise<Participant | null> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.participant.create({ data: toParticipantCreateData(participant) });
        await tx.participantProviderMapping.create({
          data: {
            participantId: created.id,
            sportLeagueId: participant.sportLeagueId,
            participantType: participant.participantType,
            providerId: feedId.providerId,
            externalId: feedId.externalId,
            mappedAt: new Date(),
          },
        });
        if (jobs.length > 0) await backgroundJobsInsert(tx, jobs);
        return created;
      });
      return mapToParticipant(row);
    } catch (error) {
      // P2002: another participant of the league already holds the feed id.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  async update(id: string, updates: Partial<Participant>): Promise<Participant> {
    const row = await this.prisma.participant.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.firstName !== undefined && { firstName: updates.firstName }),
        ...(updates.lastName !== undefined && { lastName: updates.lastName }),
        ...(updates.shortName !== undefined && { shortName: updates.shortName }),
        ...(updates.nationality !== undefined && { nationality: updates.nationality }),
        ...(updates.role !== undefined && { role: updates.role }),
        ...(updates.teamAffiliation !== undefined && { teamAffiliation: updates.teamAffiliation }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.ranking !== undefined && { ranking: updates.ranking }),
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed: Prisma's JSON input type has an index signature this interface lacks; the rule misreads it inside the conditional spread.
        ...(updates.injuryStatus !== undefined && { injuryStatus: updates.injuryStatus as object }),
        ...(updates.photoUrl !== undefined && { photoUrl: updates.photoUrl }),
        ...(updates.photoLastUpdated !== undefined && { photoLastUpdated: updates.photoLastUpdated }),
      },
    });
    return mapToParticipant(row);
  }

  async deleteUnlessOnAField(id: string): Promise<number | null> {
    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE conflicts with the FOR KEY SHARE a field row's insert takes on the participant:
      // one added meanwhile either committed first and is counted, or waits and then fails.
      // poolmaster-allow-raw-sql: a row lock (SELECT … FOR UPDATE): Prisma has no row locks
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "participants" WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) return null;
      const fieldEntries = await tx.sportEventParticipant.count({ where: { participantId: id } });
      if (fieldEntries > 0) return fieldEntries;
      await tx.participantProviderMapping.deleteMany({ where: { participantId: id } });
      await tx.participant.delete({ where: { id } });
      return 0;
    });
  }
}

export function mapToParticipant(row: {
  id: string;
  sportLeagueId: string;
  ranking: number | null;
  name: string;
  participantType: ParticipantType;
  firstName: string | null;
  lastName: string | null;
  shortName: string | null;
  nationality: string | null;
  role: string | null;
  teamAffiliation: string | null;
  status: ParticipantStatus;
  injuryStatus: unknown;
  photoUrl: string | null;
  photoLastUpdated: Date | null;
  isTestData: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Participant {
  return {
    id: row.id,
    sportLeagueId: row.sportLeagueId,
    ranking: row.ranking,
    name: row.name,
    participantType: row.participantType,
    firstName: row.firstName ?? undefined,
    lastName: row.lastName ?? undefined,
    shortName: row.shortName ?? undefined,
    nationality: row.nationality ?? undefined,
    role: row.role ?? undefined,
    teamAffiliation: row.teamAffiliation ?? undefined,
    status: row.status,
    injuryStatus: toInjuryStatus(row.injuryStatus),
    photoUrl: row.photoUrl ?? undefined,
    photoLastUpdated: row.photoLastUpdated ?? undefined,
    isTestData: row.isTestData,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// The JSON column holds the injury dates as ISO strings; the domain type holds Dates.
type StoredInjuryStatus = Omit<InjuryStatus, 'expectedReturn' | 'updatedAt'> & {
  expectedReturn?: string;
  updatedAt?: string;
};

function toInjuryStatus(value: unknown): InjuryStatus {
  const { expectedReturn, updatedAt, ...fields } = (value ?? { status: 'HEALTHY' }) as StoredInjuryStatus;
  return {
    ...fields,
    ...(expectedReturn !== undefined && { expectedReturn: new Date(expectedReturn) }),
    ...(updatedAt !== undefined && { updatedAt: new Date(updatedAt) }),
  };
}

function toParticipantCreateData(participant: Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>) {
  return {
    sportLeagueId: participant.sportLeagueId,
    ranking: participant.ranking,
    name: participant.name,
    participantType: participant.participantType,
    firstName: participant.firstName,
    lastName: participant.lastName,
    shortName: participant.shortName,
    nationality: participant.nationality,
    role: participant.role,
    teamAffiliation: participant.teamAffiliation,
    status: participant.status,
    injuryStatus: participant.injuryStatus as object,
    photoUrl: participant.photoUrl,
    photoLastUpdated: participant.photoLastUpdated,
    isTestData: participant.isTestData,
  };
}
