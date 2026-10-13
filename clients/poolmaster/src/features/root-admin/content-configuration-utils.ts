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
 * (picks per tier for tiered rules, golfers per entry for budget rules, golfers dealt per entry
 * for a random draw) and how many scores count. An update for another selection type's size is
 * ignored.
 */
export function updateTemplateRules(
  template: ContestConfigTemplate,
  updates: {
    picksPerEntry?: number;
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
    case SelectionType.RANDOM_DRAW:
      return {
        ...template,
        configuration: { ...configuration, picksPerEntry: updates.picksPerEntry ?? configuration.picksPerEntry, countedScores },
      };
  }
}

/** The one size field a template's rules carry, as `updateTemplateRules` takes it. */
type TemplateSizeKey = 'picksPerEntry' | 'picksPerTier' | 'rosterSize';

/**
 * How the template editor shows each selection type's size field. A `Record` over the enum, so a
 * new selection type without a size field fails the typecheck.
 */
export const TEMPLATE_SIZE_FIELDS: Record<SelectionType, { helperText?: string; key: TemplateSizeKey; label: string; testId: string }> = {
  [SelectionType.TIERED]: {
    key: 'picksPerTier',
    label: 'Picks per tier',
    testId: 'root-admin-content-config-picks-per-tier',
  },
  [SelectionType.BUDGET_PICK]: {
    helperText: "Every budget contest's salary cap is its tournament's.",
    key: 'rosterSize',
    label: 'Golfers per entry',
    testId: 'root-admin-content-config-roster-size',
  },
  [SelectionType.RANDOM_DRAW]: {
    helperText: 'The draw deals each entry this many golfers at random.',
    key: 'picksPerEntry',
    label: 'Golfers per entry',
    testId: 'root-admin-content-config-picks-per-entry',
  },
};

/** The template's size: picks per tier, golfers per entry, or golfers dealt per entry. */
export function getTemplateSize(configuration: ContestConfigTemplate['configuration']) {
  switch (configuration.selectionType) {
    case SelectionType.TIERED:
      return configuration.picksPerTier;
    case SelectionType.BUDGET_PICK:
      return configuration.rosterSize;
    case SelectionType.RANDOM_DRAW:
      return configuration.picksPerEntry;
  }
}
