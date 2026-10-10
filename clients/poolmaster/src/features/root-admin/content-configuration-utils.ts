import { SelectionType } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto } from '@/lib/api';

export type ContestConfigTemplate = ContestConfigTemplateDto;

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
 * Tiers and prices are event-owned data, resolved per tournament — never a per-contest or
 * per-template override (plans/124 §4.6/§4.6a). A template only says how big the roster is
 * (picks per tier for tiered rules, golfers per entry for budget rules) and how many scores
 * count. An update for the other selection type's size is ignored.
 */
export function updateTemplateRules(
  template: ContestConfigTemplate,
  updates: {
    picksPerTier?: number;
    rosterSize?: number;
    countedScores?: number;
  },
): ContestConfigTemplate {
  const { configuration } = template;
  const countedScores = updates.countedScores ?? configuration.countedScores;
  switch (configuration.selectionType) {
    case SelectionType.TIERED:
      return {
        ...template,
        configuration: { ...configuration, picksPerTier: updates.picksPerTier ?? configuration.picksPerTier, countedScores },
      };
    case SelectionType.BUDGET_PICK:
      return {
        ...template,
        configuration: { ...configuration, rosterSize: updates.rosterSize ?? configuration.rosterSize, countedScores },
      };
  }
}
