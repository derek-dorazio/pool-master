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

  async findByParticipants(participantIds: readonly string[]): Promise<ParticipantProviderMapping[]> {
    if (participantIds.length === 0) return [];
    const rows = await this.prisma.participantProviderMapping.findMany({
      where: { participantId: { in: [...participantIds] } },
      orderBy: [{ participantId: 'asc' }, { providerId: 'asc' }],
    });
    return rows.map(mapToMapping);
  }

  async findByProviderExternalIds(providerId: string, externalIds: readonly string[]): Promise<ParticipantProviderMapping[]> {
    if (externalIds.length === 0) return [];
    const rows = await this.prisma.participantProviderMapping.findMany({
      where: { providerId, externalId: { in: [...externalIds] } },
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

  async bind(
    mapping: Omit<ParticipantProviderMapping, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ParticipantProviderMapping> {
    const binding = {
      participantId: mapping.participantId,
      confidence: mapping.confidence,
      mappedAt: mapping.mappedAt,
    };
    const row = await this.prisma.participantProviderMapping.upsert({
      where: { providerId_externalId: { providerId: mapping.providerId, externalId: mapping.externalId } },
      create: { ...binding, providerId: mapping.providerId, externalId: mapping.externalId },
      update: binding,
    });
    return mapToMapping(row);
  }
}

function mapToMapping(row: {
  id: string;
  participantId: string;
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
    providerId: row.providerId,
    externalId: row.externalId,
    confidence: row.confidence,
    mappedAt: row.mappedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
