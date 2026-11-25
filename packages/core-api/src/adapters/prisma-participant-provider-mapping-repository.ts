/**
 * Prisma adapter for ParticipantProviderMappingRepository port.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type { ParticipantProviderMappingRepository, ProviderMappingScope } from '@poolmaster/shared/db';
import type { ParticipantProviderMapping, ParticipantType, ProviderCode } from '@poolmaster/shared/domain';

/** The Provider's name, read with each mapping, which the API returns beside its id. */
const WITH_PROVIDER_NAME = { provider: { select: { name: true } } } as const;

export class PrismaParticipantProviderMappingRepository implements ParticipantProviderMappingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByParticipant(participantId: string): Promise<ParticipantProviderMapping[]> {
    const rows = await this.prisma.participantProviderMapping.findMany({
      where: { participantId },
      include: WITH_PROVIDER_NAME,
    });
    return rows.map(mapToMapping);
  }

  async findByParticipantIds(participantIds: readonly string[]): Promise<ParticipantProviderMapping[]> {
    if (participantIds.length === 0) return [];
    const rows = await this.prisma.participantProviderMapping.findMany({
      where: { participantId: { in: [...participantIds] } },
      include: WITH_PROVIDER_NAME,
    });
    return rows.map(mapToMapping);
  }

  async findByProviderExternalIds(providerCode: ProviderCode, scope: ProviderMappingScope, externalIds: readonly string[]): Promise<ParticipantProviderMapping[]> {
    if (externalIds.length === 0) return [];
    const rows = await this.prisma.participantProviderMapping.findMany({
      where: { provider: { code: providerCode }, externalId: { in: [...externalIds] }, ...scopeWhere(scope) },
      include: WITH_PROVIDER_NAME,
    });
    return rows.map(mapToMapping);
  }

  async findByProviderAndSportLeague(providerId: string, sportLeagueId: string): Promise<ParticipantProviderMapping[]> {
    const rows = await this.prisma.participantProviderMapping.findMany({
      where: { providerId, sportLeagueId },
      include: WITH_PROVIDER_NAME,
      orderBy: { externalId: 'asc' },
    });
    return rows.map(mapToMapping);
  }

  async bind(
    mapping: Omit<ParticipantProviderMapping, 'id' | 'createdAt' | 'updatedAt' | 'providerName'>,
  ): Promise<ParticipantProviderMapping | null> {
    const binding = {
      participantId: mapping.participantId,
      mappedAt: mapping.mappedAt,
    };
    const identity = {
      providerId: mapping.providerId,
      externalId: mapping.externalId,
      sportLeagueId: mapping.sportLeagueId,
      participantType: mapping.participantType,
    };
    try {
      const row = await this.prisma.participantProviderMapping.upsert({
        where: { providerId_externalId_sportLeagueId_participantType: identity },
        create: { ...binding, ...identity },
        update: binding,
        include: WITH_PROVIDER_NAME,
      });
      return mapToMapping(row);
    } catch (error) {
      // P2003: the provider id names no Provider row (the participant was read by the caller).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') return null;
      throw error;
    }
  }
}

/** The mappings in a lookup's scope: the league's own column, or the league reached by its event or sport, in the same read. */
function scopeWhere(scope: ProviderMappingScope): Prisma.ParticipantProviderMappingWhereInput {
  if ('sportLeagueId' in scope) return { sportLeagueId: scope.sportLeagueId };
  if ('sportEventId' in scope) return { sportLeague: { seasons: { some: { sportEvents: { some: { id: scope.sportEventId } } } } } };
  return { sportLeague: { sport: { sport: scope.sport } } };
}

function mapToMapping(row: {
  id: string;
  participantId: string;
  sportLeagueId: string;
  participantType: ParticipantType;
  providerId: string;
  externalId: string;
  mappedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  provider: { name: string };
}): ParticipantProviderMapping {
  return {
    id: row.id,
    participantId: row.participantId,
    sportLeagueId: row.sportLeagueId,
    participantType: row.participantType,
    providerId: row.providerId,
    providerName: row.provider.name,
    externalId: row.externalId,
    mappedAt: row.mappedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
