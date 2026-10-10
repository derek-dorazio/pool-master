/**
 * BUDGET_PRICING_CONFIG (#93): the named pricing profiles a root admin prices an event's field
 * with for budget contests. The price dialog on the tournament's Tiers page starts on the first
 * profile and lets the admin change any value before assigning; the values used are then stored
 * on the event, so editing a profile here never moves an event's prices.
 */

import { BudgetPricingConfigSchema, type BudgetPricingConfig } from '@poolmaster/shared/dto';
import { DEFAULT_BUDGET_PRICING_PROFILES, findBudgetPricingProblem } from '@poolmaster/shared/domain';
import { defineSettingsGroup } from '../platform/settings-group';

/** The stored shape, plus what a JSON schema can't say: unique names, and values that agree. */
const BudgetPricingSettingsSchema = BudgetPricingConfigSchema.superRefine((config, context) => {
  const seen = new Set<string>();
  config.profiles.forEach((profile, index) => {
    const name = profile.name.toLowerCase();
    if (seen.has(name)) {
      context.addIssue({ code: 'custom', path: ['profiles', index, 'name'], message: `Another profile is already named "${profile.name}".` });
    }
    seen.add(name);
    const problem = findBudgetPricingProblem(profile);
    if (problem) {
      context.addIssue({ code: 'custom', path: ['profiles', index], message: problem });
    }
  });
});

export const BUDGET_PRICING_SETTINGS = defineSettingsGroup<BudgetPricingConfig>({
  key: 'BUDGET_PRICING_CONFIG',
  title: 'Budget pricing',
  description: 'The pricing profiles an event\'s field is priced with for budget contests.',
  schema: BudgetPricingSettingsSchema,
  defaults: () => ({ profiles: DEFAULT_BUDGET_PRICING_PROFILES.map((profile) => ({ ...profile })) }),
});
