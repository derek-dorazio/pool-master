import { createColumnHelper } from '@tanstack/react-table';
import { explicitOrderValues, type LeaguePlan, LeaguePlanOrder, type PlanFeatureGroup, PlanFeatureGroupOrder } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { formatPlanLimit } from '@/features/plans/plan-labels';
import type { PlanCapGridRow, PlanFeatureGridRow } from './plan-rows';

const capColumn = createColumnHelper<PlanCapGridRow>();
const featureColumn = createColumnHelper<PlanFeatureGridRow>();

/** The Caps grid's columns (#1884): the cap, then its limit on each plan, Unlimited as text. */
export function planCapColumns(locale: string) {
  return [
    capColumn.accessor('name', {
      header: 'Cap',
      meta: { info: 'What the plan limits.', type: { kind: 'text' } },
    }),
    // Unlimited sorts and filters as the largest limit: above every number, in both directions.
    ...explicitOrderValues(LeaguePlanOrder).map((plan) => capColumn.accessor((row) => row.limits[plan] ?? Number.POSITIVE_INFINITY, {
      id: plan,
      header: enumLabel('LeaguePlan', plan),
      meta: { info: `The most a league on ${enumLabel('LeaguePlan', plan)} may have. Unlimited: no cap.`, type: { kind: 'number' } },
      cell: ({ row }) => formatPlanLimit(row.original.limits[plan], locale),
    })),
  ];
}

/** The Features grid's columns (#1884): the feature, its group, and the first plan that has it. */
export const planFeatureColumns = [
  featureColumn.accessor('name', {
    header: 'Feature',
    meta: { info: 'What the plan unlocks.', type: { kind: 'text' } },
  }),
  featureColumn.accessor('group', {
    header: 'Group',
    meta: {
      info: 'Emails, Championships or History.',
      type: { kind: 'enum', order: PlanFeatureGroupOrder, label: (group) => enumLabel('PlanFeatureGroup', group as PlanFeatureGroup) },
    },
    cell: ({ getValue }) => enumLabel('PlanFeatureGroup', getValue()),
  }),
  featureColumn.accessor('startsAt', {
    header: 'Starts at',
    meta: {
      info: 'The first plan with it; every plan above has it too.',
      type: { kind: 'enum', order: LeaguePlanOrder, label: (plan) => enumLabel('LeaguePlan', plan as LeaguePlan) },
    },
    cell: ({ getValue }) => enumLabel('LeaguePlan', getValue()),
  }),
];
