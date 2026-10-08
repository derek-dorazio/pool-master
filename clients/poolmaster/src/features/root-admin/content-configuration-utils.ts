import type { ListContestConfigTemplatesResponses } from '@/lib/api';

export type ContestConfigTemplate = ListContestConfigTemplatesResponses[200]['templates'][number];

export function cloneContestTemplate(template: ContestConfigTemplate): ContestConfigTemplate {
  return {
    ...template,
    configuration: JSON.parse(JSON.stringify(template.configuration)) as ContestConfigTemplate['configuration'],
  };
}

export function toPositiveNumber(value: string) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

/**
 * Tiers/price are event-owned data now, resolved via
 * SportEventTierService.getEffectiveTiersForSportEvent — never a per-contest or
 * per-template override (plans/124 §4.6/§4.6a). A template only ever says
 * "how many picks per tier, how many count," not the tier structure itself.
 */
export function updateTieredTemplateConfiguration(
  template: ContestConfigTemplate,
  updates: {
    picksPerTier?: number;
    countedScores?: number;
  },
): ContestConfigTemplate {
  return {
    ...template,
    configuration: {
      ...template.configuration,
      picksPerTier: updates.picksPerTier ?? template.configuration.picksPerTier,
      countedScores: updates.countedScores ?? template.configuration.countedScores,
    },
  };
}
