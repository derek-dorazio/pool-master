/**
 * Prisma adapter for PlatformRuntimeConfigRepository — one JSON document per settings group,
 * and the append-only history of saved changes (#450).
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient, PlatformRuntimeConfig as PlatformRuntimeConfigRow } from '@prisma/client';
import type {
  PlatformRuntimeConfigRepository,
  PlatformRuntimeConfigSave,
  PlatformRuntimeConfigSaveResult,
} from '@poolmaster/shared/db';
import type { PlatformRuntimeConfig } from '@poolmaster/shared/domain';

export class PrismaPlatformRuntimeConfigRepository implements PlatformRuntimeConfigRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<PlatformRuntimeConfig[]> {
    const rows = await this.prisma.platformRuntimeConfig.findMany({ orderBy: { configKey: 'asc' } });
    return rows.map(toPlatformRuntimeConfig);
  }

  async save(input: PlatformRuntimeConfigSave): Promise<PlatformRuntimeConfigSaveResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock the row so the concurrency check, the write and the history's previous value all
        // see the same version. A row that does not exist yet cannot be locked; two first saves
        // racing meet at the unique key instead, handled below.
        await tx.$queryRaw`SELECT id FROM "platform_runtime_configs" WHERE "config_key" = ${input.configKey} FOR UPDATE`;
        const current = await tx.platformRuntimeConfig.findUnique({ where: { configKey: input.configKey } });

        if (input.expectedUpdatedAt !== undefined
          && (current?.updatedAt.getTime() ?? null) !== (input.expectedUpdatedAt?.getTime() ?? null)) {
          return { status: 'conflict', current: current ? toPlatformRuntimeConfig(current) : null };
        }

        const configJson = input.configJson as Prisma.InputJsonValue;
        const saved = current
          ? await tx.platformRuntimeConfig.update({
            where: { configKey: input.configKey },
            data: { configJson, updatedById: input.changedById },
          })
          : await tx.platformRuntimeConfig.create({
            data: { configKey: input.configKey, configJson, updatedById: input.changedById },
          });
        await tx.platformRuntimeConfigHistory.create({
          data: {
            configKey: input.configKey,
            previousJson: current ? (current.configJson as Prisma.InputJsonValue) : Prisma.DbNull,
            newJson: configJson,
            changedById: input.changedById,
          },
        });
        return { status: 'saved', config: toPlatformRuntimeConfig(saved) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const current = await this.prisma.platformRuntimeConfig.findUnique({ where: { configKey: input.configKey } });
        return { status: 'conflict', current: current ? toPlatformRuntimeConfig(current) : null };
      }
      throw error;
    }
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
