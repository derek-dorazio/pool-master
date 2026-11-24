import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LEAGUE_PLANS, LeaguePlan } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { FormField, Select } from '@/features/shared/ui';
import { PlanRowDialog, type PlanSettingsGroup } from './plan-row-dialog';
import { withPlanFeature, type PlanFeatureGridRow } from './plan-rows';

const featureFormSchema = z.object({ startsAt: z.enum(LeaguePlan) });
type FeatureFormValues = z.infer<typeof featureFormSchema>;

/** One feature's dialog (#1884): its group and the first plan that has it; Edit changes Starts at. */
export function PlanFeatureDialog({ group, onClose, row }: { group: PlanSettingsGroup; onClose: () => void; row: PlanFeatureGridRow }) {
  const testId = 'root-admin-plan-feature-dialog';

  return (
    <PlanRowDialog<FeatureFormValues>
      facts={[
        { id: 'group', label: 'Group', value: enumLabel('PlanFeatureGroup', row.group), testId: `${testId}-group` },
        { id: 'starts-at', label: 'Starts at', value: enumLabel('LeaguePlan', row.startsAt), testId: `${testId}-starts-at` },
      ]}
      group={group}
      name={row.name}
      onClose={onClose}
      resolver={zodResolver(featureFormSchema)}
      testId={testId}
      toForm={(config) => ({ startsAt: config.features[row.feature] })}
      toValue={(values) => withPlanFeature(group.value, row.feature, values.startsAt)}
    >
      {(form) => (
        <FormField help="The first plan with it; every plan above has it too." label="Starts at">
          <Select data-testid={`${testId}-starts-at-select`} {...form.register('startsAt')}>
            {LEAGUE_PLANS.map((plan) => (
              <option key={plan} value={plan}>{enumLabel('LeaguePlan', plan)}</option>
            ))}
          </Select>
        </FormField>
      )}
    </PlanRowDialog>
  );
}
