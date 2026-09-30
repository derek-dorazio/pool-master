/**
 * Prisma adapter for PlatformRuntimeConfigRepository — one JSON document per setting key.
 */

import type { Prisma, PrismaClient, PlatformRuntimeConfig as PlatformRuntimeConfigRow } from '@prisma/client';
import type { PlatformRuntimeConfigRepository } from '@poolmaster/shared/db';
import type { PlatformRuntimeConfig } from '@poolmaster/shared/domain';

export class PrismaPlatformRuntimeConfigRepository implements PlatformRuntimeConfigRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByKey(configKey: string): Promise<PlatformRuntimeConfig | null> {
    const row = await this.prisma.platformRuntimeConfig.findUnique({ where: { configKey } });
    return row ? toPlatformRuntimeConfig(row) : null;
  }

  async create(input: {
    configKey: string;
    configJson: unknown;
    updatedById?: string | null;
  }): Promise<PlatformRuntimeConfig> {
    return toPlatformRuntimeConfig(await this.prisma.platformRuntimeConfig.create({
      data: {
        configKey: input.configKey,
        configJson: input.configJson as Prisma.InputJsonValue,
        updatedById: input.updatedById ?? null,
      },
    }));
  }

  async update(input: {
    configKey: string;
    configJson: unknown;
    updatedById?: string | null;
  }): Promise<PlatformRuntimeConfig> {
    const data = {
      configJson: input.configJson as Prisma.InputJsonValue,
      updatedById: input.updatedById ?? null,
    };
    return toPlatformRuntimeConfig(await this.prisma.platformRuntimeConfig.upsert({
      where: { configKey: input.configKey },
      create: { configKey: input.configKey, ...data },
      update: data,
    }));
  }
}

function toPlatformRuntimeConfig(row: PlatformRuntimeConfigRow): PlatformRuntimeConfig {
  return {
    id: row.id,
    configKey: row.configKey,
    configJson: row.configJson,
    updatedById: row.updatedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
