import type { LeaguePlan } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import { DataGrid, QueryState, SectionCard, useDisplayPreferences } from '@/features/shared/ui';
import { useSettingsGroupQuery } from '@/features/root-admin/use-settings-groups';
import { extractErrorMessage } from '@/lib/errors';
import { planPriceColumns } from './plan-price-columns';
import { PlanPriceDialog } from './plan-price-dialog';
import { planPriceRows } from './plan-price-rows';

/**
 * The Pricing page's Plan prices (#1886): one row per plan with its yearly and monthly price, the
 * entries it includes (from the Plans page) and its expansion bands, a row opening the plan's
 * dialog to see and edit them. Read from the payments and plans settings groups.
 */
export function PlanPricesSection() {
  const { locale } = useDisplayPreferences();
  const billingQuery = useSettingsGroupQuery('BILLING_CONFIG');
  const plansQuery = useSettingsGroupQuery('PLAN_CONFIG');
  const [openPlan, setOpenPlan] = useState<LeaguePlan | null>(null);
  const billing = billingQuery.data;
  const plans = plansQuery.data;
  const rows = useMemo(() => (billing && plans ? planPriceRows(billing.value, plans.value, locale) : []), [billing, plans, locale]);
  const columns = useMemo(() => planPriceColumns(locale), [locale]);
  const openRow = rows.find((row) => row.plan === openPlan);

  return (
    <SectionCard padded testId="root-admin-plan-prices" title="Plan prices">
      <QueryState
        error={extractErrorMessage(billingQuery.error, { fallback: 'We could not load the plan prices right now.' })}
        loading="Loading plan prices..."
        query={billingQuery}
        testId="root-admin-plan-prices-state"
      >
        {() => (
          <QueryState
            error={extractErrorMessage(plansQuery.error, { fallback: 'We could not load the plans\' entries right now.' })}
            loading="Loading plans..."
            query={plansQuery}
            testId="root-admin-plan-prices-plans-state"
          >
            {() => (
              <DataGrid
                columns={columns}
                data={rows}
                emptyMessage="No plans."
                filterTestIdPrefix="root-admin-plan-prices-filter"
                getRowId={(row) => row.plan}
                openRowDialog={(row) => setOpenPlan(row.plan)}
                rowTestId={(row) => `root-admin-plan-price-${row.plan}`}
                tableTestId="root-admin-plan-prices-table"
                urlKey="planPrices"
              />
            )}
          </QueryState>
        )}
      </QueryState>
      {openRow && billing ? (
        <PlanPriceDialog group={billing} key={openRow.plan} onClose={() => setOpenPlan(null)} row={openRow} />
      ) : null}
    </SectionCard>
  );
}
