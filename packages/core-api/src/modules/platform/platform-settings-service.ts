/**
 * PlatformSettingsService — the root-admin operations on settings groups by key (#450): list,
 * read, save, reset, and recent history, each naming the admin behind the stored value.
 *
 * The values themselves are owned by `AppSettingsService`; this service resolves a key to its
 * registered group and attaches who changed it.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { PlatformRuntimeConfigRepository, UserRepository } from '@poolmaster/shared/db';
import type { PlatformRuntimeConfigChange } from '@poolmaster/shared/domain';
import { SETTINGS_HISTORY_LIMIT } from '@poolmaster/shared/dto/settings.dto';
import { formatUserFullName } from '../../core/user-name';
import type { AppSettingsService, SettingsState } from './app-settings-service';
import type { SettingsGroup } from './settings-group';

export interface SettingsActorView {
  id: string;
  name: string;
}

export interface SettingsGroupView {
  group: SettingsGroup<unknown>;
  state: SettingsState<unknown>;
  updatedBy: SettingsActorView | null;
}

export interface SettingsChangeView {
  change: PlatformRuntimeConfigChange;
  changedBy: SettingsActorView | null;
}

export class SettingsGroupNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'SETTINGS_GROUP_NOT_FOUND';

  constructor(key: string) {
    super(`There is no settings group ${key}.`);
    this.name = 'SettingsGroupNotFoundError';
  }
}

export class SettingsKeyMismatchError extends Error {
  readonly statusCode = 400;
  readonly code = 'SETTINGS_KEY_MISMATCH';

  constructor(pathKey: string, bodyKey: string) {
    super(`The request body is for ${bodyKey} but the path names ${pathKey}.`);
    this.name = 'SettingsKeyMismatchError';
  }
}

export interface PlatformSettingsServiceDeps {
  settings: AppSettingsService;
  runtimeConfigs: PlatformRuntimeConfigRepository;
  users: UserRepository;
  logger?: FastifyBaseLogger;
}

export class PlatformSettingsService {
  constructor(private readonly deps: PlatformSettingsServiceDeps) {}

  async list(): Promise<SettingsGroupView[]> {
    const groups = this.deps.settings.groups();
    const states = groups.map((group) => this.deps.settings.getState(group));
    const actors = await this.actors(states.map((state) => state.updatedById));
    return groups.map((group, index) => ({
      group,
      state: states[index],
      updatedBy: actorFor(actors, states[index].updatedById),
    }));
  }

  async get(key: string): Promise<SettingsGroupView> {
    const group = this.group(key);
    return this.view(group, this.deps.settings.getState(group));
  }

  async save(
    key: string,
    request: { key: string; value: unknown; expectedUpdatedAt: Date | null },
    rootAdminUserId: string,
  ): Promise<SettingsGroupView> {
    const group = this.group(key);
    if (request.key !== key) {
      throw new SettingsKeyMismatchError(key, request.key);
    }
    this.deps.logger?.debug({
      action: 'adminSettings.save.start',
      data: { key },
    }, 'Saving settings group');
    const state = await this.deps.settings.save(group, request.value, {
      changedById: rootAdminUserId,
      expectedUpdatedAt: request.expectedUpdatedAt,
    });
    this.deps.logger?.info({
      action: 'adminSettings.save.success',
      data: { key },
    }, 'Saved settings group');
    return this.view(group, state);
  }

  async reset(key: string, rootAdminUserId: string): Promise<SettingsGroupView> {
    const group = this.group(key);
    this.deps.logger?.debug({
      action: 'adminSettings.reset.start',
      data: { key },
    }, 'Resetting settings group');
    const state = await this.deps.settings.reset(group, { changedById: rootAdminUserId });
    this.deps.logger?.info({
      action: 'adminSettings.reset.success',
      data: { key },
    }, 'Reset settings group');
    return this.view(group, state);
  }

  /**
   * A change whose stored values no longer pass the group's schema (saved by an older release,
   * before a field was added) is logged and left out, the way a stale stored value is: the
   * published history types each value by its group, and one old row must not fail the rest.
   */
  async history(key: string): Promise<SettingsChangeView[]> {
    const group = this.group(key);
    const stored = await this.deps.runtimeConfigs.findRecentChanges(group.key, SETTINGS_HISTORY_LIMIT);
    const changes = stored.filter((change) => {
      const valid = group.schema.safeParse(change.newJson).success
        && (change.previousJson === null || group.schema.safeParse(change.previousJson).success);
      if (!valid) {
        this.deps.logger?.warn({
          action: 'adminSettings.history.changeSkipped',
          data: { key, changeId: change.id },
        }, 'Left a settings change out of the history: its stored values no longer validate');
      }
      return valid;
    });
    const actors = await this.actors(changes.map((change) => change.changedById));
    return changes.map((change) => ({ change, changedBy: actorFor(actors, change.changedById) }));
  }

  private group(key: string): SettingsGroup<unknown> {
    const group = this.deps.settings.findGroup(key);
    if (!group) {
      throw new SettingsGroupNotFoundError(key);
    }
    return group;
  }

  private async view(group: SettingsGroup<unknown>, state: SettingsState<unknown>): Promise<SettingsGroupView> {
    const actors = await this.actors([state.updatedById]);
    return { group, state, updatedBy: actorFor(actors, state.updatedById) };
  }

  /** The named admins behind a set of user ids. A deleted user is simply absent. */
  private async actors(ids: ReadonlyArray<string | null>): Promise<Map<string, SettingsActorView>> {
    const distinct = [...new Set(ids.filter((id): id is string => id !== null))];
    const users = await Promise.all(distinct.map((id) => this.deps.users.findById(id)));
    const actors = new Map<string, SettingsActorView>();
    for (const user of users) {
      if (user) {
        actors.set(user.id, { id: user.id, name: formatUserFullName(user.firstName, user.lastName) });
      }
    }
    return actors;
  }
}

function actorFor(actors: Map<string, SettingsActorView>, id: string | null): SettingsActorView | null {
  return id ? actors.get(id) ?? null : null;
}
