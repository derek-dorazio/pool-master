/**
 * Prisma adapter for ParticipantProviderMappingRepository port.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { ParticipantProviderMappingRepository, ProviderMappingScope } from '@poolmaster/shared/db';
import type { ParticipantProviderMapping, MappingConfidence } from '@poolmaster/shared/domain';

export class PrismaParticipantProviderMappingRepository implements ParticipantProviderMappingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByParticipant(participantId: string): Promise<ParticipantProviderMapping[]> {
    const rows = await this.prisma.participantProviderMapping.findMany({
      where: { participantId },
    });
    return rows.map(mapToMapping);
  }

  async findByProviderExternalIds(providerId: string, scope: ProviderMappingScope, externalIds: readonly string[]): Promise<ParticipantProviderMapping[]> {
    if (externalIds.length === 0) return [];
    const rows = await this.prisma.participantProviderMapping.findMany({
      where: { providerId, externalId: { in: [...externalIds] }, ...scopeWhere(scope) },
    });
    return rows.map(mapToMapping);
  }

  async findByProviderAndSportLeague(providerId: string, sportLeagueId: string): Promise<ParticipantProviderMapping[]> {
    const rows = await this.prisma.participantProviderMapping.findMany({
      where: { providerId, sportLeagueId },
      orderBy: { externalId: 'asc' },
    });
    return rows.map(mapToMapping);
  }

  async bind(
    mapping: Omit<ParticipantProviderMapping, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ParticipantProviderMapping> {
    const binding = {
      participantId: mapping.participantId,
      confidence: mapping.confidence,
      mappedAt: mapping.mappedAt,
    };
    const row = await this.prisma.participantProviderMapping.upsert({
      where: { providerId_externalId_sportLeagueId: { providerId: mapping.providerId, externalId: mapping.externalId, sportLeagueId: mapping.sportLeagueId } },
      create: { ...binding, providerId: mapping.providerId, externalId: mapping.externalId, sportLeagueId: mapping.sportLeagueId },
      update: binding,
    });
    return mapToMapping(row);
  }
}

/** The mappings in a lookup's scope: the league's own column, or the league reached by its event or sport, in the same read. */
function scopeWhere(scope: ProviderMappingScope): Prisma.ParticipantProviderMappingWhereInput {
  if ('sportLeagueId' in scope) return { sportLeagueId: scope.sportLeagueId };
  if ('sportEventId' in scope) return { sportLeague: { eventSeries: { some: { sportEvents: { some: { id: scope.sportEventId } } } } } };
  return { sportLeague: { sport: { sport: scope.sport } } };
}

function mapToMapping(row: {
  id: string;
  participantId: string;
  sportLeagueId: string;
  providerId: string;
  externalId: string;
  confidence: MappingConfidence;
  mappedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): ParticipantProviderMapping {
  return {
    id: row.id,
    participantId: row.participantId,
    sportLeagueId: row.sportLeagueId,
    providerId: row.providerId,
    externalId: row.externalId,
    confidence: row.confidence,
    mappedAt: row.mappedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
