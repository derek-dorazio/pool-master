/**
 * Prisma adapter for ParticipantRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ParticipantRepository, ParticipantSearchFilters } from '@poolmaster/shared/db';
import type { Participant, InjuryStatus } from '@poolmaster/shared/domain';
import type { ParticipantStatus } from '@poolmaster/shared/domain';

export class PrismaParticipantRepository implements ParticipantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Participant | null> {
    const row = await this.prisma.participant.findUnique({ where: { id } });
    return row ? mapToParticipant(row) : null;
  }

  async findBySport(sportId: string): Promise<Participant[]> {
    const rows = await this.prisma.participant.findMany({
      where: { sportId },
      orderBy: { name: 'asc' },
    });
    return rows.map(mapToParticipant);
  }

  async findByExternalId(providerId: string, externalId: string): Promise<Participant | null> {
    const mapping = await this.prisma.participantProviderMapping.findUnique({
      where: { providerId_externalId: { providerId, externalId } },
      include: { participant: true },
    });
    return mapping ? mapToParticipant(mapping.participant) : null;
  }

  async search(
    query: string,
    filters: ParticipantSearchFilters,
    limit = 50,
    offset = 0,
  ): Promise<{ participants: Participant[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (filters.sportId) {
      where.sportId = filters.sportId;
    }
    if (filters.status && filters.status.length > 0) {
      where.status = { in: filters.status };
    }
    if (filters.position && filters.position.length > 0) {
      where.position = { in: filters.position };
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

    const [rows, total] = await Promise.all([
      this.prisma.participant.findMany({
        where,
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.participant.count({ where }),
    ]);

    return { participants: rows.map(mapToParticipant), total };
  }

  async create(participant: Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>): Promise<Participant> {
    const row = await this.prisma.participant.create({
      data: {
        sportId: participant.sportId,
        name: participant.name,
        participantType: participant.participantType,
        externalId: participant.externalId,
        firstName: participant.firstName,
        lastName: participant.lastName,
        shortName: participant.shortName,
        nationality: participant.nationality,
        position: participant.position,
        teamAffiliation: participant.teamAffiliation,
        status: participant.status,
        injuryStatus: participant.injuryStatus as object,
        photoUrl: participant.photoUrl,
        photoLastUpdated: participant.photoLastUpdated,
        externalIds: participant.externalIds as object,
      },
    });
    return mapToParticipant(row);
  }

  async createMany(participants: Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<number> {
    const result = await this.prisma.participant.createMany({
      data: participants.map((p) => ({
        sportId: p.sportId,
        name: p.name,
        participantType: p.participantType,
        externalId: p.externalId,
        firstName: p.firstName,
        lastName: p.lastName,
        shortName: p.shortName,
        nationality: p.nationality,
        position: p.position,
        teamAffiliation: p.teamAffiliation,
        status: p.status,
        injuryStatus: p.injuryStatus as object,
        photoUrl: p.photoUrl,
        photoLastUpdated: p.photoLastUpdated,
        externalIds: p.externalIds as object,
      })),
      skipDuplicates: true,
    });
    return result.count;
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
        ...(updates.position !== undefined && { position: updates.position }),
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

function mapToParticipant(row: {
  id: string;
  sportId: string;
  name: string;
  participantType: string;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  shortName: string | null;
  nationality: string | null;
  position: string | null;
  teamAffiliation: string | null;
  status: string;
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
    participantType: row.participantType as Participant['participantType'],
    externalId: row.externalId ?? undefined,
    firstName: row.firstName ?? undefined,
    lastName: row.lastName ?? undefined,
    shortName: row.shortName ?? undefined,
    nationality: row.nationality ?? undefined,
    position: row.position ?? undefined,
    teamAffiliation: row.teamAffiliation ?? undefined,
    status: row.status as ParticipantStatus,
    injuryStatus: (row.injuryStatus ?? { status: 'HEALTHY' }) as InjuryStatus,
    photoUrl: row.photoUrl ?? undefined,
    photoLastUpdated: row.photoLastUpdated ?? undefined,
    externalIds: (row.externalIds ?? {}) as Record<string, string>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
