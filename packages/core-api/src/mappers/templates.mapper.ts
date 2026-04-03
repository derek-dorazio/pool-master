import type { ContestTemplate } from '@poolmaster/shared/domain';

function toIso(value?: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

export function mapContestTemplateToDto(template: ContestTemplate) {
  return {
    id: template.id,
    leagueId: template.leagueId,
    createdBy: template.createdBy,
    name: template.name,
    description: template.description,
    sport: template.sport,
    contestType: template.contestType,
    draftConfig: template.draftConfig,
    scoringConfig: template.scoringConfig,
    payoutConfig: template.payoutConfig,
    poolConfig: template.poolConfig,
    sharedWithTenant: template.sharedWithTenant,
    isPlatformTemplate: template.isPlatformTemplate,
    timesUsed: template.timesUsed,
    lastUsedAt: toIso(template.lastUsedAt),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}
