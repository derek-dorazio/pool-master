import type { AdminListContestConfigTemplatesResponses } from '@/lib/api';

export type ContestConfigTemplate = AdminListContestConfigTemplatesResponses[200]['templates'][number];

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
 * golf-tier-service.getEffectiveTiersForContest — never a per-contest or
 * per-template override (plans/124 §4.6/§4.6a). A GOLF_TIERED template only
 * ever says "how many picks, how many count," not the tier structure
 * itself.
 */
export function updateTieredTemplateConfiguration(
  template: ContestConfigTemplate,
  updates: {
    rosterSize?: number;
    countedScores?: number;
  },
): ContestConfigTemplate {
  if (template.configuration.mode !== 'GOLF_TIERED') {
    return template;
  }

  return {
    ...template,
    configuration: {
      ...template.configuration,
      rosterSize: updates.rosterSize ?? template.configuration.rosterSize,
      countedScores: updates.countedScores ?? template.configuration.countedScores,
    },
  };
}
