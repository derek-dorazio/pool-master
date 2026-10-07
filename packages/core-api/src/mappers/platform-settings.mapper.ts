import {
  SettingsGroupKeySchema,
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

export function toSettingsChangeDto(view: SettingsChangeView): SettingsChange {
  return {
    id: view.change.id,
    key: SettingsGroupKeySchema.parse(view.change.configKey),
    previousValue: view.change.previousJson === null ? null : view.change.previousJson as Record<string, unknown>,
    newValue: view.change.newJson as Record<string, unknown>,
    changedAt: view.change.changedAt.toISOString(),
    changedBy: view.changedBy,
  };
}

export function toSettingsChangeListDto(views: SettingsChangeView[]): SettingsChangeList {
  return { changes: views.map(toSettingsChangeDto) };
}
