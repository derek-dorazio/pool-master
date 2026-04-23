import type { PrismaClient } from '@prisma/client';

export interface PlatformRuntimeConfigRecord {
  id: string;
  configKey: string;
  configJson: unknown;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaPlatformRuntimeConfigRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByKey(configKey: string): Promise<PlatformRuntimeConfigRecord | null> {
    const row = await this.prisma.platformRuntimeConfig.findUnique({
      where: { configKey },
    });

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      configKey: row.configKey,
      configJson: row.configJson,
      updatedById: row.updatedById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(input: {
    configKey: string;
    configJson: unknown;
    updatedById?: string | null;
  }): Promise<PlatformRuntimeConfigRecord> {
    const row = await this.prisma.platformRuntimeConfig.create({
      data: {
        configKey: input.configKey,
        configJson: input.configJson as object,
        updatedById: input.updatedById ?? null,
      },
    });

    return {
      id: row.id,
      configKey: row.configKey,
      configJson: row.configJson,
      updatedById: row.updatedById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async update(input: {
    configKey: string;
    configJson: unknown;
    updatedById?: string | null;
  }): Promise<PlatformRuntimeConfigRecord> {
    const row = await this.prisma.platformRuntimeConfig.upsert({
      where: { configKey: input.configKey },
      create: {
        configKey: input.configKey,
        configJson: input.configJson as object,
        updatedById: input.updatedById ?? null,
      },
      update: {
        configJson: input.configJson as object,
        updatedById: input.updatedById ?? null,
      },
    });

    return {
      id: row.id,
      configKey: row.configKey,
      configJson: row.configJson,
      updatedById: row.updatedById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
