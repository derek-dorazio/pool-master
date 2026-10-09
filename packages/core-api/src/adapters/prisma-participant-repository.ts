/**
 * Prisma adapter for ParticipantRepository port.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { ParticipantMatchQuery, ParticipantRepository, ParticipantSearchFilters } from '@poolmaster/shared/db';
import type { Participant, InjuryStatus, ParticipantType, ParticipantStatus } from '@poolmaster/shared/domain';

export class PrismaParticipantRepository implements ParticipantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Participant | null> {
    const row = await this.prisma.participant.findUnique({ where: { id } });
    return row ? mapToParticipant(row) : null;
  }

  async search(query: string, filters: ParticipantSearchFilters): Promise<Participant[]> {
    const where: Prisma.ParticipantWhereInput = {};

    if (filters.sportId) {
      where.sportId = filters.sportId;
    }
    if (filters.status && filters.status.length > 0) {
      where.status = { in: filters.status };
    }
    if (filters.role && filters.role.length > 0) {
      where.role = { in: filters.role };
    }
    if (filters.teamAffiliation && filters.teamAffiliation.length > 0) {
      where.teamAffiliation = { in: filters.teamAffiliation };
    }
    if (filters.nationality && filters.nationality.length > 0) {
      where.nationality = { in: filters.nationality };
    }

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

  async findMatching(sportId: string, query: ParticipantMatchQuery): Promise<Participant[]> {
    const rows = await this.prisma.participant.findMany({
      where: {
        sportId,
        ...(query.id !== undefined && { id: query.id }),
        ...(query.externalId !== undefined && { externalId: query.externalId }),
        ...(query.name !== undefined && { name: { equals: query.name, mode: 'insensitive' } }),
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(mapToParticipant);
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
        ...(updates.injuryStatus !== undefined && { injuryStatus: updates.injuryStatus as object }),
        ...(updates.photoUrl !== undefined && { photoUrl: updates.photoUrl }),
        ...(updates.photoLastUpdated !== undefined && { photoLastUpdated: updates.photoLastUpdated }),
        ...(updates.externalIds !== undefined && { externalIds: updates.externalIds as object }),
        ...(updates.externalId !== undefined && { externalId: updates.externalId }),
      },
    });
    return mapToParticipant(row);
  }
}

export function mapToParticipant(row: {
  id: string;
  sportId: string;
  name: string;
  participantType: ParticipantType;
  externalId: string | null;
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
  externalIds: unknown;
  createdAt: Date;
  updatedAt: Date;
}): Participant {
  return {
    id: row.id,
    sportId: row.sportId,
    name: row.name,
    participantType: row.participantType,
    externalId: row.externalId ?? undefined,
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
    externalIds: (row.externalIds ?? {}) as Record<string, string>,
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
    sportId: participant.sportId,
    name: participant.name,
    participantType: participant.participantType,
    externalId: participant.externalId,
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
    externalIds: participant.externalIds as object,
  };
}
