/**
 * AppSettingsService — the one owner of every settings group (#450).
 *
 * Reads are synchronous and come from memory, so hot paths (a mail send, a
 * scheduler tick) never wait on the database. The cache is loaded once before the server reports
 * ready and then refreshed from one query every 30 seconds, which is how a save on one core-api
 * task reaches the others. Reads never write: a missing row means the group's defaults, and a
 * stored row that no longer validates is logged and left alone for an admin to fix while the
 * defaults are used in its place.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { PlatformRuntimeConfigRepository } from '@poolmaster/shared/db';
import type { PlatformRuntimeConfig } from '@poolmaster/shared/domain';
import type { SettingsEnvironment, SettingsGroup } from './settings-group';

export const SETTINGS_REFRESH_INTERVAL_MS = 30_000;

/** What a group currently resolves to, and where that value came from. */
export interface SettingsState<T> {
  value: T;
  defaults: T;
  /** `stored` when a valid saved payload is in use; `defaults` when none is stored or it is invalid. */
  source: 'stored' | 'defaults';
  /** The stored row's `updatedAt`, or null when nothing is stored. The token a save checks against. */
  updatedAt: Date | null;
  updatedById: string | null;
}

export interface SaveSettingsOptions {
  changedById: string;
  /**
   * The `updatedAt` the caller last read (`null` for "nothing stored"). When another save has
   * landed since, the save is refused with `SettingsConflictError`. Omitted, the save does not
   * check.
   */
  expectedUpdatedAt?: Date | null;
}

export class SettingsConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'SETTINGS_CONFLICT';

  constructor(key: string) {
    super(`Settings group ${key} was changed by someone else; reload and try again.`);
    this.name = 'SettingsConflictError';
  }
}

export class SettingsValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'SETTINGS_INVALID';

  /** The Zod issues; the error handler sends a 400's `validation` as the envelope's `details`. */
  constructor(key: string, readonly validation: unknown) {
    super(`The payload for settings group ${key} is invalid.`);
    this.name = 'SettingsValidationError';
  }
}

export interface AppSettingsServiceOptions {
  repository: PlatformRuntimeConfigRepository;
  groups: readonly SettingsGroup<unknown>[];
  env: SettingsEnvironment;
  logger?: FastifyBaseLogger;
  refreshIntervalMs?: number;
}

interface GroupEntry {
  group: SettingsGroup<unknown>;
  state: SettingsState<unknown>;
  /** The `updatedAt` of the invalid stored row last logged, so a bad row is logged once, not every refresh. */
  invalidRowLoggedFor: number | null;
}

export class AppSettingsService {
  private readonly entries = new Map<string, GroupEntry>();
  private readonly repository: PlatformRuntimeConfigRepository;
  private readonly logger?: FastifyBaseLogger;
  private readonly refreshIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private loaded = false;

  constructor(options: AppSettingsServiceOptions) {
    this.repository = options.repository;
    this.logger = options.logger;
    this.refreshIntervalMs = options.refreshIntervalMs ?? SETTINGS_REFRESH_INTERVAL_MS;

    for (const group of options.groups) {
      if (this.entries.has(group.key)) {
        throw new Error(`Settings group ${group.key} is declared twice`);
      }
      const defaults = group.schema.parse(group.defaults(options.env));
      this.entries.set(group.key, {
        group,
        state: { value: defaults, defaults, source: 'defaults', updatedAt: null, updatedById: null },
        invalidRowLoggedFor: null,
      });
    }
  }

  /** Every registered group, in registry order. */
  groups(): SettingsGroup<unknown>[] {
    return [...this.entries.values()].map((entry) => entry.group);
  }

  /** The registered group stored under `key`, or null. */
  findGroup(key: string): SettingsGroup<unknown> | null {
    return this.entries.get(key)?.group ?? null;
  }

  /** The value a group currently resolves to. A copy: changing it changes nothing. */
  get<T>(group: SettingsGroup<T>): T {
    return structuredClone(this.entry(group).state.value as T);
  }

  getState<T>(group: SettingsGroup<T>): SettingsState<T> {
    return structuredClone(this.entry(group).state as SettingsState<T>);
  }

  /** The first load, before the server reports ready. A database failure here fails startup. */
  async load(): Promise<void> {
    this.applyRows(await this.repository.findAll());
    this.loaded = true;
  }

  /** Re-reads every group in one query. A failure keeps the last good values and is logged. */
  async refresh(): Promise<void> {
    let rows: PlatformRuntimeConfig[];
    try {
      rows = await this.repository.findAll();
    } catch (error) {
      this.logger?.warn({
        action: 'appSettings.refresh.failed',
        err: error,
      }, 'Settings refresh failed; keeping the last loaded values');
      return;
    }
    this.applyRows(rows);
  }

  /** Starts the background refresh. The timer never keeps the process alive on its own. */
  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.refreshIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Validates and stores a whole payload, recording the change in the history in the same
   * transaction. The saving task sees the new value at once; the others at their next refresh.
   */
  async save<T>(group: SettingsGroup<T>, value: T, options: SaveSettingsOptions): Promise<SettingsState<T>> {
    const entry = this.entry(group);
    const parsed = group.schema.safeParse(value);
    if (!parsed.success) {
      throw new SettingsValidationError(group.key, parsed.error.issues);
    }

    this.logger?.debug({
      action: 'appSettings.save.start',
      data: { key: group.key },
    }, 'Saving settings group');
    const result = await this.repository.save({
      configKey: group.key,
      configJson: parsed.data,
      changedById: options.changedById,
      expectedUpdatedAt: options.expectedUpdatedAt,
    });
    if (result.status === 'conflict') {
      // The conflict carries the stored row that won, so this task is current again at once.
      this.applyRow(entry, result.current);
      this.logger?.info({
        action: 'appSettings.save.conflict',
        data: { key: group.key },
      }, 'Settings group was saved by someone else first');
      throw new SettingsConflictError(group.key);
    }

    this.applyRow(entry, result.config);
    this.logger?.info({
      action: 'appSettings.save.success',
      data: { key: group.key },
    }, 'Saved settings group');
    return this.getState(group);
  }

  /**
   * Changes part of a group's value. `change` is applied to the stored version this task holds
   * and saved against that version, so a save another task made since this task's last refresh is
   * never silently overwritten: on a conflict the cache takes the newer version and `change` is
   * applied to it once more. A second conflict in a row is refused.
   */
  async update<T>(group: SettingsGroup<T>, change: (current: T) => T, options: { changedById: string }): Promise<SettingsState<T>> {
    for (let attempt = 1; ; attempt += 1) {
      const current = this.getState(group);
      try {
        return await this.save(group, change(current.value), {
          changedById: options.changedById,
          expectedUpdatedAt: current.updatedAt,
        });
      } catch (error) {
        if (!(error instanceof SettingsConflictError) || attempt >= 2) {
          throw error;
        }
      }
    }
  }

  /** Stores the group's defaults as its value; recorded in the history like any other save. */
  async reset<T>(group: SettingsGroup<T>, options: SaveSettingsOptions): Promise<SettingsState<T>> {
    return this.save(group, this.entry(group).state.defaults as T, options);
  }

  private entry(group: SettingsGroup<unknown> | { key: string }): GroupEntry {
    const entry = this.entries.get(group.key);
    if (!entry) {
      throw new Error(`Settings group ${group.key} is not registered`);
    }
    return entry;
  }

  private applyRows(rows: readonly PlatformRuntimeConfig[]): void {
    const byKey = new Map(rows.map((row) => [row.configKey, row]));
    for (const entry of this.entries.values()) {
      this.applyRow(entry, byKey.get(entry.group.key) ?? null);
    }
  }

  private applyRow(entry: GroupEntry, row: PlatformRuntimeConfig | null): void {
    const previous = entry.state.value;
    const { defaults } = entry.state;

    if (!row) {
      entry.state = { value: defaults, defaults, source: 'defaults', updatedAt: null, updatedById: null };
    } else {
      const parsed = parseStored(entry.group, defaults, row.configJson);
      if (parsed.success) {
        entry.state = {
          value: parsed.data,
          defaults,
          source: 'stored',
          updatedAt: row.updatedAt,
          updatedById: row.updatedById,
        };
        entry.invalidRowLoggedFor = null;
      } else {
        if (entry.invalidRowLoggedFor !== row.updatedAt.getTime()) {
          entry.invalidRowLoggedFor = row.updatedAt.getTime();
          this.logger?.error({
            action: 'appSettings.load.invalidStoredValue',
            data: { key: entry.group.key },
            issues: parsed.issues,
          }, 'Stored settings value is invalid; using the defaults until an admin saves a valid one');
        }
        entry.state = {
          value: defaults,
          defaults,
          source: 'defaults',
          updatedAt: row.updatedAt,
          updatedById: row.updatedById,
        };
      }
    }

    if (this.loaded && JSON.stringify(previous) !== JSON.stringify(entry.state.value)) {
      this.notifyChange(entry, previous);
    }
  }

  private notifyChange(entry: GroupEntry, previous: unknown): void {
    if (!entry.group.onChange) {
      return;
    }
    try {
      entry.group.onChange(structuredClone(entry.state.value), structuredClone(previous));
    } catch (error) {
      this.logger?.error({
        action: 'appSettings.onChange.failed',
        data: { key: entry.group.key },
        err: error,
      }, 'Settings change hook failed');
    }
  }
}

/**
 * A stored payload is read over the defaults, nested objects included, so a field added to a
 * group since the row was saved takes its default instead of invalidating the row. Unknown keys
 * are dropped by the schema.
 */
function parseStored<T>(
  group: SettingsGroup<T>,
  defaults: T,
  stored: unknown,
): { success: true; data: T } | { success: false; issues: unknown } {
  if (!isPlainObject(stored) || !isPlainObject(defaults)) {
    return { success: false, issues: [{ message: 'Stored settings value is not an object' }] };
  }
  const parsed = group.schema.safeParse(overDefaults(defaults, stored));
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, issues: parsed.error.issues };
}

/** `stored` over `defaults`, object by object: a nested field missing from `stored` takes its default. Arrays replace. */
function overDefaults(defaults: Record<string, unknown>, stored: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(stored)) {
    const fallback = defaults[key];
    merged[key] = isPlainObject(fallback) && isPlainObject(value) ? overDefaults(fallback, value) : value;
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
