/**
 * An in-memory PlatformRuntimeConfigRepository (#450), for service tests that assert what the
 * settings service leaves stored rather than which repository calls it made. The Prisma adapter
 * behind the same port is tested against Postgres in platform-settings.integration.
 *
 * `updatedAt` advances by one millisecond per save, so two saves never share a concurrency token.
 */

import type {
  PlatformRuntimeConfigRepository,
  PlatformRuntimeConfigSave,
  PlatformRuntimeConfigSaveResult,
} from '@poolmaster/shared/db';
import type { PlatformRuntimeConfig, PlatformRuntimeConfigChange } from '@poolmaster/shared/domain';

export interface InMemoryRuntimeConfigs extends PlatformRuntimeConfigRepository {
  rows: Map<string, PlatformRuntimeConfig>;
  history: PlatformRuntimeConfigChange[];
  /** Stores a row directly, as a save on another core-api task (or an old release) would have. */
  put(configKey: string, configJson: unknown): PlatformRuntimeConfig;
  /** Makes the next `findAll` fail, as a database blip would. */
  failNextRead(): void;
}

export function inMemoryRuntimeConfigs(): InMemoryRuntimeConfigs {
  const rows = new Map<string, PlatformRuntimeConfig>();
  const history: PlatformRuntimeConfigChange[] = [];
  let clock = Date.parse('2026-10-01T00:00:00.000Z');
  let failRead = false;

  const write = (configKey: string, configJson: unknown, updatedById: string | null): PlatformRuntimeConfig => {
    clock += 1;
    const existing = rows.get(configKey);
    const row: PlatformRuntimeConfig = {
      id: existing?.id ?? `runtime-config-${rows.size + 1}`,
      configKey,
      configJson: structuredClone(configJson),
      updatedById,
      createdAt: existing?.createdAt ?? new Date(clock),
      updatedAt: new Date(clock),
    };
    rows.set(configKey, row);
    return row;
  };

  return {
    rows,
    history,
    put: (configKey, configJson) => write(configKey, configJson, null),
    failNextRead: () => {
      failRead = true;
    },
    findAll: async () => {
      if (failRead) {
        failRead = false;
        throw new Error('connection reset');
      }
      return [...rows.values()].map((row) => structuredClone(row));
    },
    save: async (input: PlatformRuntimeConfigSave): Promise<PlatformRuntimeConfigSaveResult> => {
      const current = rows.get(input.configKey) ?? null;
      if (input.expectedUpdatedAt !== undefined
        && (current?.updatedAt.getTime() ?? null) !== (input.expectedUpdatedAt?.getTime() ?? null)) {
        return { status: 'conflict', current: current ? structuredClone(current) : null };
      }
      const saved = write(input.configKey, input.configJson, input.changedById);
      history.push({
        // UUID-shaped, as the table's ids are, so a change maps through the published DTO.
        id: `00000000-0000-4000-8000-${String(history.length + 1).padStart(12, '0')}`,
        configKey: input.configKey,
        previousJson: current ? structuredClone(current.configJson) : null,
        newJson: structuredClone(input.configJson),
        changedById: input.changedById,
        changedAt: saved.updatedAt,
      });
      return { status: 'saved', config: structuredClone(saved) };
    },
    findRecentChanges: async (configKey, limit) => history
      .filter((change) => change.configKey === configKey)
      .reverse()
      .slice(0, limit)
      .map((change) => structuredClone(change)),
  };
}
