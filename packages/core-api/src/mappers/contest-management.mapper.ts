import type { ContestConfigTemplateDto } from '@poolmaster/shared/dto';
import type { ContestConfigTemplate } from '@poolmaster/shared/domain';

export function mapContestConfigTemplateDto(
  template: ContestConfigTemplate,
): ContestConfigTemplateDto {
  return {
    id: template.id,
    sport: template.sport,
    eventType: template.eventType ?? null,
    contestType: template.contestType,
    configMode: template.configMode,
    templateKey: template.templateKey,
    name: template.name,
    description: template.description,
    sortOrder: template.sortOrder,
    isDefault: template.isDefault,
    active: template.active,
    schemaVersion: template.schemaVersion,
    configuration: template.configJson,
  };
}
