import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BudgetPricingProfileSchema, findBudgetPricingProblem } from '@poolmaster/shared/domain';
import { updateSettingsGroup, type BudgetPricingConfig, type SettingsGroup } from '@/lib/api';
import { Alert, Button, FormField, Input } from '@/features/shared/ui';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { ApiError, throwApiError, extractErrorMessage } from '@/lib/errors';

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
  { key: 'topSharePercent', label: 'Best golfer (% of cap)', step: 'any' },
  { key: 'floorSharePercent', label: 'Worst golfer (% of cap)', step: 'any' },
  { key: 'steepness', label: 'Steepness', step: 'any' },
] as const;

/**
 * The BUDGET_PRICING_CONFIG card's form (#93): the pricing profiles an admin prices a
 * tournament's field with. The first profile is the one the price dialog starts on. Changing a
 * profile never re-prices an event; each event keeps the values it was priced with. The draft is
 * taken from the group once, like the Email form, and a 409 offers to load the newer value.
 */
export function BudgetPricingSettingsForm({ group }: { group: BudgetPricingSettingsGroup }) {
  const queryClient = useQueryClient();
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(group.updatedAt);
  const form = useForm<BudgetPricingConfig>({
    resolver: zodResolver(BudgetPricingFormSchema),
    defaultValues: group.value,
  });
  const profiles = useFieldArray({ control: form.control, name: 'profiles' });

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: BudgetPricingConfig) => {
      const response = await updateSettingsGroup({
        path: { key: 'BUDGET_PRICING_CONFIG' },
        body: { key: 'BUDGET_PRICING_CONFIG', value: values, expectedUpdatedAt: baseUpdatedAt },
      });
      if (response.data?.key !== 'BUDGET_PRICING_CONFIG') {
        throwApiError(response.error, 'Budget pricing settings response is missing data.');
      }
      return response.data;
    },
    onSuccess: (saved) => {
      setBaseUpdatedAt(saved.updatedAt);
      form.reset(saved.value);
    },
    invalidates: [QueryKeys.rootAdmin.settings],
  });

  const conflicted = saveMutation.error instanceof ApiError && saveMutation.error.code === 'SETTINGS_CONFLICT';

  async function loadLatest() {
    await queryClient.refetchQueries({ queryKey: QueryKeys.rootAdmin.settings, exact: true });
    const latest = queryClient
      .getQueryData<SettingsGroup[]>(QueryKeys.rootAdmin.settings)
      ?.find((candidate): candidate is BudgetPricingSettingsGroup => candidate.key === 'BUDGET_PRICING_CONFIG');
    if (!latest) {
      return;
    }
    setBaseUpdatedAt(latest.updatedAt);
    form.reset(latest.value);
    saveMutation.reset();
  }

  const { errors } = form.formState;

  return (
    <form
      className="space-y-5"
      data-testid="root-admin-budget-pricing-settings-form"
      noValidate
      onSubmit={(event) => void form.handleSubmit((values) => saveMutation.mutate(values))(event)}
    >
      <p className="text-sm text-muted-foreground">
        Prices fall from the best golfer&apos;s share of the cap to the worst&apos;s, in seed order.
        Changing a profile doesn&apos;t re-price a tournament: each keeps the values it was priced with.
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
      {saveMutation.isError ? (
        <Alert
          action={conflicted ? (
            <Button onClick={() => void loadLatest()} type="button" variant="secondary">
              Load the latest settings
            </Button>
          ) : undefined}
          data-testid="root-admin-budget-pricing-settings-error"
          tone="danger"
        >
          {extractErrorMessage(saveMutation.error, { fallback: 'We could not save the budget pricing settings.' })}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button data-testid="root-admin-budget-pricing-settings-save" disabled={saveMutation.isPending} type="submit">
          {saveMutation.isPending ? 'Saving...' : 'Save budget pricing'}
        </Button>
        {profiles.fields.length < MAX_PROFILES ? (
          <Button
            data-testid="root-admin-budget-pricing-add"
            onClick={() => {
              const [first] = form.getValues('profiles');
              profiles.append({ ...(first ?? group.defaults.profiles[0]), name: '' });
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
