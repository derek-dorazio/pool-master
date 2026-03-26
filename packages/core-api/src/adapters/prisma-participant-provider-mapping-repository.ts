/**
 * Prisma adapter for ParticipantProviderMappingRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ParticipantProviderMappingRepository } from '@poolmaster/shared/db';
import type { ParticipantProviderMapping, MappingConfidence } from '@poolmaster/shared/domain';

export class PrismaParticipantProviderMappingRepository implements ParticipantProviderMappingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByProvider(
    providerId: string,
    externalId: string,
  ): Promise<ParticipantProviderMapping | null> {
    const row = await this.prisma.participantProviderMapping.findUnique({
      where: { providerId_externalId: { providerId, externalId } },
    });
    return row ? mapToMapping(row) : null;
  }

  async findByParticipant(participantId: string): Promise<ParticipantProviderMapping[]> {
    const rows = await this.prisma.participantProviderMapping.findMany({
      where: { participantId },
    });
    return rows.map(mapToMapping);
  }

  async create(
    mapping: Omit<ParticipantProviderMapping, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ParticipantProviderMapping> {
    const row = await this.prisma.participantProviderMapping.create({
      data: {
        participantId: mapping.participantId,
        providerId: mapping.providerId,
        externalId: mapping.externalId,
        confidence: mapping.confidence,
        mappedAt: mapping.mappedAt,
      },
    });
    return mapToMapping(row);
  }
}

function mapToMapping(row: {
  id: string;
  participantId: string;
  providerId: string;
  externalId: string;
  confidence: string;
  mappedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): ParticipantProviderMapping {
  return {
    id: row.id,
    participantId: row.participantId,
    providerId: row.providerId,
    externalId: row.externalId,
    confidence: row.confidence as MappingConfidence,
    mappedAt: row.mappedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
