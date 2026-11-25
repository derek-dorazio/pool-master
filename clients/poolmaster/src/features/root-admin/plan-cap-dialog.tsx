import { zodResolver } from '@hookform/resolvers/zod';
import { explicitOrderValues, LeaguePlanOrder } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { Checkbox, FormField, Input, Text, useDisplayPreferences } from '@/features/shared/ui';
import { formatPlanLimit, UNLIMITED_LABEL } from '@/features/plans/plan-labels';
import { PlanRowDialog, type PlanSettingsGroup } from './plan-row-dialog';
import { planCapFormSchema, planCapFormValues, withPlanCap, type PlanCapFormValues, type PlanCapGridRow } from './plan-rows';

/** One cap's dialog (#1884): its limit on each plan; Edit offers a number or Unlimited for each. */
export function PlanCapDialog({ group, onClose, row }: { group: PlanSettingsGroup; onClose: () => void; row: PlanCapGridRow }) {
  const { locale } = useDisplayPreferences();
  const testId = 'root-admin-plan-cap-dialog';

  return (
    <PlanRowDialog<PlanCapFormValues>
      facts={explicitOrderValues(LeaguePlanOrder).map((plan) => ({
        id: plan,
        label: enumLabel('LeaguePlan', plan),
        value: formatPlanLimit(row.limits[plan], locale),
        testId: `${testId}-${plan}`,
      }))}
      group={group}
      name={row.name}
      onClose={onClose}
      resolver={zodResolver(planCapFormSchema(group.value, row.cap))}
      testId={testId}
      toForm={(config) => planCapFormValues(config, row.cap)}
      toValue={(values) => withPlanCap(group.value, row.cap, values)}
    >
      {(form) => explicitOrderValues(LeaguePlanOrder).map((plan) => (
        <div className="grid gap-2" key={plan}>
          <FormField error={form.formState.errors[plan]?.limit?.message} label={enumLabel('LeaguePlan', plan)}>
            {form.watch(`${plan}.unlimited`)
              ? <Input data-testid={`${testId}-${plan}-limit`} disabled value={UNLIMITED_LABEL} />
              : <Input data-testid={`${testId}-${plan}-limit`} inputMode="numeric" {...form.register(`${plan}.limit`)} />}
          </FormField>
          <label className="flex items-center gap-2">
            <Checkbox data-testid={`${testId}-${plan}-unlimited`} {...form.register(`${plan}.unlimited`)} />
            <Text as="span">Unlimited on {enumLabel('LeaguePlan', plan)}</Text>
          </label>
        </div>
      ))}
    </PlanRowDialog>
  );
}
