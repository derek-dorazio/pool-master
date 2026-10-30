import { useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BudgetPricingProfileSchema, findBudgetPricingProblem, formatDollars } from '@poolmaster/shared/domain';
import type { BudgetPricingConfig, SettingsGroup } from '@/lib/api';
import { Button, FormField, Input } from '@/features/shared/ui';
import { numberFieldErrors } from '@/lib/number-field-errors';
import { SettingsSaveError } from './settings-save-error';
import { useSettingsGroupForm } from './use-settings-group-form';

type BudgetPricingSettingsGroup = Extract<SettingsGroup, { key: 'BUDGET_PRICING_CONFIG' }>;

const MAX_PROFILES = 10;

/** The stored shape with the server's own checks: unique names, and values that agree. */
const BudgetPricingFormSchema = z.object({
  profiles: z.array(BudgetPricingProfileSchema.superRefine((profile, context) => {
    const problem = findBudgetPricingProblem(profile);
    if (problem) {
      context.addIssue({ code: 'custom', path: ['floorSharePercent'], message: problem });
    }
  })).min(1).max(MAX_PROFILES),
}).superRefine((config, context) => {
  const seen = new Set<string>();
  config.profiles.forEach((profile, index) => {
    const name = profile.name.trim().toLowerCase();
    if (seen.has(name)) {
      context.addIssue({ code: 'custom', path: ['profiles', index, 'name'], message: 'Another profile already has this name.' });
    }
    seen.add(name);
  });
});

const NUMBER_FIELDS = [
  { key: 'salaryCap', label: 'Salary cap ($)', step: '1' },
  { key: 'unit', label: 'Round prices to ($)', step: '1' },
  { key: 'topSharePercent', label: 'Best participant (% of cap)', step: 'any' },
  { key: 'floorSharePercent', label: 'Worst participant (% of cap)', step: 'any' },
  { key: 'steepness', label: 'Steepness', step: 'any' },
] as const;

const dollarsRange = (min: number, max: number) => `From ${formatDollars(min)} to ${formatDollars(max)}.`;
const shareRange = (min: number, max: number) => `From ${min}% to ${max}% of the cap.`;
const { shape } = BudgetPricingProfileSchema;

const pricingErrors = numberFieldErrors({
  salaryCap: { schema: shape.salaryCap, range: dollarsRange, blank: 'Enter a salary cap.', whole: 'Whole dollars only.' },
  unit: { schema: shape.unit, range: dollarsRange, blank: 'Enter a rounding unit.', whole: 'Whole dollars only.' },
  topSharePercent: { schema: shape.topSharePercent, range: shareRange, blank: 'Enter a share of the cap.' },
  floorSharePercent: { schema: shape.floorSharePercent, range: shareRange, blank: 'Enter a share of the cap.' },
  steepness: { schema: shape.steepness, range: (min, max) => `From ${min} to ${max}.`, blank: 'Enter a steepness.' },
});

/**
 * The BUDGET_PRICING_CONFIG card's form (#93): the pricing profiles an admin prices a
 * tournament's field with. The first profile is the one the price dialog starts on. Changing a
 * profile never re-prices an event; each event keeps the values it was priced with. The draft is
 * taken from the group once, like the Email form, and a 409 offers to load the newer value.
 */
export function BudgetPricingSettingsForm({ group }: { group: BudgetPricingSettingsGroup }) {
  const { conflicted, form, loadLatest, saveMutation, submit } = useSettingsGroupForm({
    group,
    resolver: zodResolver(BudgetPricingFormSchema, { error: pricingErrors }),
    subject: 'Budget pricing settings',
    toForm: (value: BudgetPricingConfig) => value,
    toValue: (values: BudgetPricingConfig) => values,
  });
  const profiles = useFieldArray({ control: form.control, name: 'profiles' });

  const { errors } = form.formState;

  return (
    <form
      className="space-y-5"
      data-testid="root-admin-budget-pricing-settings-form"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <p className="text-sm text-muted-foreground">
        Prices fall from the best participant&apos;s share of the cap to the worst&apos;s, in seed order.
        Changing a profile doesn&apos;t re-price an event: each keeps the values it was priced with.
      </p>
      {profiles.fields.map((profile, index) => {
        const profileErrors = errors.profiles?.[index];
        return (
          <fieldset className="space-y-3 rounded-xl border border-border p-4" data-testid={`root-admin-budget-pricing-profile-${index}`} key={profile.id}>
            <legend className="px-1 text-sm font-medium">{index === 0 ? 'Default profile' : `Profile ${index + 1}`}</legend>
            <div className="flex flex-wrap items-end gap-3">
              <FormField className="min-w-48 flex-1" error={profileErrors?.name?.message} label="Name">
                <Input data-testid={`root-admin-budget-pricing-name-${index}`} {...form.register(`profiles.${index}.name`)} />
              </FormField>
              {profiles.fields.length > 1 ? (
                <Button
                  data-testid={`root-admin-budget-pricing-remove-${index}`}
                  onClick={() => profiles.remove(index)}
                  type="button"
                  variant="secondary"
                >
                  Remove
                </Button>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {NUMBER_FIELDS.map((field) => (
                <FormField error={profileErrors?.[field.key]?.message} key={field.key} label={field.label}>
                  <Input
                    data-testid={`root-admin-budget-pricing-${field.key}-${index}`}
                    step={field.step}
                    type="number"
                    {...form.register(`profiles.${index}.${field.key}`, { valueAsNumber: true })}
                  />
                </FormField>
              ))}
            </div>
          </fieldset>
        );
      })}
      <SettingsSaveError
        conflicted={conflicted}
        error={saveMutation.error}
        fallback="We could not save the budget pricing settings."
        onLoadLatest={loadLatest}
        testId="root-admin-budget-pricing-settings-error"
      />
      <div className="flex flex-wrap gap-3">
        <Button data-testid="root-admin-budget-pricing-settings-save" disabled={saveMutation.isPending} type="submit">
          {saveMutation.isPending ? 'Saving...' : 'Save budget pricing'}
        </Button>
        {profiles.fields.length < MAX_PROFILES ? (
          <Button
            data-testid="root-admin-budget-pricing-add"
            onClick={() => {
              const first = form.getValues('profiles').at(0) ?? group.defaults.profiles.at(0);
              if (first) profiles.append({ ...first, name: '' });
            }}
            type="button"
            variant="secondary"
          >
            Add a profile
          </Button>
        ) : null}
      </div>
    </form>
  );
}
