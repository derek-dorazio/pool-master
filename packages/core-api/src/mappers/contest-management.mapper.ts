import type { ContestConfigTemplateDto, GolfEffectiveTierDto } from '@poolmaster/shared/dto';
import type { ContestConfigTemplate } from '@poolmaster/shared/domain';
import type { GolfTierGroup } from '../modules/golf/golf-tier-service';

export function mapContestConfigTemplateDto(
  template: ContestConfigTemplate,
): ContestConfigTemplateDto {
  return {
    id: template.id,
    sport: template.sport,
    eventType: template.eventType ?? null,
    contestFormat: template.contestFormat,
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

/**
 * Maps golf-tier-service's tier-grouped shape to the read-only
 * ContestManagementDetailDto.effectiveTiers echo (plans/124 §4.6/§5.3).
 * Structurally the same projection the root-admin toAdminGolfTierGroupDto
 * mapper does — the commissioner surface is read-only where the root-admin
 * one is editable, but both read through getEffectiveTiersForSportEvent.
 */
export function toGolfEffectiveTierDtoList(
  tiers: GolfTierGroup[],
): GolfEffectiveTierDto[] {
  return tiers.map((tier) => ({
    tierKey: tier.tierKey,
    label: tier.label,
    tierNumber: tier.tierNumber,
    defaultPickCount: tier.defaultPickCount,
    assignments: tier.participants.map((participant) => ({
      sportEventParticipantId: participant.sportEventParticipantId,
      participantId: participant.participantId,
      tierOrderIndex: participant.tierOrderIndex,
      price: participant.price,
    })),
  }));
}
