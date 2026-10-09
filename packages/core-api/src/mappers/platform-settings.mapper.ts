import {
  SettingsChangeSchema,
  SettingsGroupSchema,
  type SettingsChange,
  type SettingsChangeList,
  type SettingsGroup,
  type SettingsGroupList,
} from '@poolmaster/shared/dto/settings.dto';
import type {
  SettingsChangeView,
  SettingsGroupView,
} from '../modules/platform/platform-settings-service';

/**
 * A group's payload is typed per key in the contract, and the registry holds it as `unknown`,
 * so the projection is parsed against the published union rather than cast: a registered group
 * the contract does not know, or a value that does not match its key, fails here.
 */
export function toSettingsGroupDto(view: SettingsGroupView): SettingsGroup {
  return SettingsGroupSchema.parse({
    key: view.group.key,
    title: view.group.title,
    description: view.group.description,
    source: view.state.source,
    updatedAt: view.state.updatedAt?.toISOString() ?? null,
    updatedBy: view.updatedBy,
    value: view.state.value,
    defaults: view.state.defaults,
  });
}

export function toSettingsGroupListDto(views: SettingsGroupView[]): SettingsGroupList {
  return { groups: views.map(toSettingsGroupDto) };
}

/** Parsed against the published union for the same reason: each value is typed by its key. */
export function toSettingsChangeDto(view: SettingsChangeView): SettingsChange {
  return SettingsChangeSchema.parse({
    id: view.change.id,
    key: view.change.configKey,
    previousValue: view.change.previousJson,
    newValue: view.change.newJson,
    changedAt: view.change.changedAt.toISOString(),
    changedBy: view.changedBy,
  });
}

export function toSettingsChangeListDto(views: SettingsChangeView[]): SettingsChangeList {
  return { changes: views.map(toSettingsChangeDto) };
}
