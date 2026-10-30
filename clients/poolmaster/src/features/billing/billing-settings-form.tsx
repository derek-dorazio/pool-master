import { useState } from 'react';
import { useFieldArray, type Control, type UseFormRegister, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LEAGUE_PLANS, type LeaguePlan } from '@poolmaster/shared/domain';
import type { BillingConfig, SettingsGroup } from '@/lib/api';
import { Button, FormField, Input } from '@/features/shared/ui';
import { LEAGUE_PLAN_LABEL } from '@/features/plans/plan-labels';
import { SettingsSaveError } from '@/features/root-admin/settings-save-error';
import { useSettingsGroupForm } from '@/features/root-admin/use-settings-group-form';

type BillingSettingsGroup = Extract<SettingsGroup, { key: 'BILLING_CONFIG' }>;

const MAX_BANDS = 10;

const BandSchema = z.object({
  // Zod 4 uses a schema's `error` for every issue without its own message, so each check
  // names its own; the schema's message is left for a blank or non-numeric cell.
  entriesPerContest: z.number({ error: 'Enter a number of entries.' }).int('Whole entries only.')
    .min(1, 'At least 1 entry.').max(100_000, 'At most 100,000 entries.'),
  dollars: z.number({ error: 'Enter a price.' }).min(0, 'Not below $0.').max(10_000, 'At most $10,000.')
    .multipleOf(0.01, 'Dollars and cents only.'),
});

/** The price lists in dollars, as the admin types them; saved in cents. */
const BillingFormSchema = z.object({
  FREE: z.array(BandSchema).max(MAX_BANDS),
  PRO: z.array(BandSchema).max(MAX_BANDS),
  PREMIUM: z.array(BandSchema).max(MAX_BANDS),
  PLATINUM: z.array(BandSchema).max(MAX_BANDS),
} satisfies Record<LeaguePlan, unknown>);
type BillingForm = z.infer<typeof BillingFormSchema>;

function toForm(config: BillingConfig): BillingForm {
  const plan = (key: LeaguePlan) => config.expansionPrices[key].map((band) => ({ entriesPerContest: band.entriesPerContest, dollars: band.priceCents / 100 }));
  return { FREE: plan('FREE'), PRO: plan('PRO'), PREMIUM: plan('PREMIUM'), PLATINUM: plan('PLATINUM') };
}

function toConfig(form: BillingForm, paymentsEnabled: boolean): BillingConfig {
  const plan = (key: LeaguePlan) => form[key].map((band) => ({ entriesPerContest: band.entriesPerContest, priceCents: Math.round(band.dollars * 100) }));
  return { paymentsEnabled, expansionPrices: { FREE: plan('FREE'), PRO: plan('PRO'), PREMIUM: plan('PREMIUM'), PLATINUM: plan('PLATINUM') } };
}

/** One plan's bands: entries and price per row, smallest first. */
function PlanBands({
  plan,
  control,
  register,
  errors,
}: {
  plan: LeaguePlan;
  control: Control<BillingForm>;
  register: UseFormRegister<BillingForm>;
  errors: FieldErrors<BillingForm>;
}) {
  const bands = useFieldArray({ control, name: plan });
  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-4" data-testid={`root-admin-billing-plan-${plan}`}>
      <legend className="px-1 text-sm font-medium">{LEAGUE_PLAN_LABEL[plan]}</legend>
      {bands.fields.length === 0 ? <p className="text-sm text-muted-foreground">No expansions on this plan.</p> : null}
      {bands.fields.map((band, index) => (
        <div className="flex flex-wrap items-end gap-3" key={band.id}>
          <FormField className="w-36" error={errors[plan]?.[index]?.entriesPerContest?.message} label="Entries">
            <Input
              data-testid={`root-admin-billing-${plan}-entries-${index}`}
              step="1"
              type="number"
              {...register(`${plan}.${index}.entriesPerContest`, { valueAsNumber: true })}
            />
          </FormField>
          <FormField className="w-36" error={errors[plan]?.[index]?.dollars?.message} label="Price ($)">
            <Input
              data-testid={`root-admin-billing-${plan}-price-${index}`}
              step="0.01"
              type="number"
              {...register(`${plan}.${index}.dollars`, { valueAsNumber: true })}
            />
          </FormField>
          <Button data-testid={`root-admin-billing-${plan}-remove-${index}`} onClick={() => bands.remove(index)} type="button" variant="secondary">
            Remove
          </Button>
        </div>
      ))}
      {bands.fields.length < MAX_BANDS ? (
        <Button
          data-testid={`root-admin-billing-${plan}-add`}
          onClick={() => bands.append({ entriesPerContest: Number.NaN, dollars: Number.NaN })}
          size="sm"
          type="button"
          variant="secondary"
        >
          Add a size
        </Button>
      ) : null}
    </fieldset>
  );
}

/**
 * The BILLING_CONFIG card's form (#987): each plan's expansion price list. Bands and prices must
 * rise down each list; the server says where they don't. Payments stay as they are: they are
 * switched on with checkout (#981). The draft is taken from the group once, like the other
 * settings forms, and a 409 offers to load the newer value.
 */
export function BillingSettingsForm({ group }: { group: BillingSettingsGroup }) {
  const [paymentsEnabled, setPaymentsEnabled] = useState(group.value.paymentsEnabled);
  const { conflicted, form, loadLatest, saveMutation, submit } = useSettingsGroupForm({
    group,
    onTaken: (taken) => setPaymentsEnabled(taken.value.paymentsEnabled),
    resolver: zodResolver(BillingFormSchema),
    subject: 'Payments settings',
    toForm,
    toValue: (values: BillingForm) => toConfig(values, paymentsEnabled),
  });

  return (
    <form
      className="space-y-5"
      data-testid="root-admin-billing-settings-form"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <p className="text-sm text-muted-foreground">
        What expanding one contest costs on each plan. A contest is offered the sizes above its cap,
        and a step up costs the difference. While payments are off, expanding is free.
      </p>
      {LEAGUE_PLANS.map((plan) => (
        <PlanBands control={form.control} errors={form.formState.errors} key={plan} plan={plan} register={form.register} />
      ))}
      <SettingsSaveError
        conflicted={conflicted}
        error={saveMutation.error}
        fallback="We could not save the payments settings."
        onLoadLatest={loadLatest}
        testId="root-admin-billing-settings-error"
      />
      <Button data-testid="root-admin-billing-settings-save" disabled={saveMutation.isPending} type="submit">
        {saveMutation.isPending ? 'Saving...' : 'Save prices'}
      </Button>
    </form>
  );
}
