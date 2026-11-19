import { createColumnHelper } from '@tanstack/react-table';
import { LEAGUE_PLANS, LeaguePlanOrder, PlanFeatureGroupOrder, type LeaguePlan, type PlanFeatureGroup } from '@poolmaster/shared/domain';
import { formatPlanLimit, LEAGUE_PLAN_LABEL, PLAN_FEATURE_GROUP_LABEL } from '@/features/plans/plan-labels';
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
    ...LEAGUE_PLANS.map((plan) => capColumn.accessor((row) => row.limits[plan], {
      id: plan,
      header: LEAGUE_PLAN_LABEL[plan],
      meta: { info: `The most a league on ${LEAGUE_PLAN_LABEL[plan]} may have. Unlimited: no cap.`, type: { kind: 'number' } },
      cell: ({ getValue }) => formatPlanLimit(getValue(), locale),
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
      type: { kind: 'enum', order: PlanFeatureGroupOrder, label: (group) => PLAN_FEATURE_GROUP_LABEL[group as PlanFeatureGroup] },
    },
    cell: ({ getValue }) => PLAN_FEATURE_GROUP_LABEL[getValue()],
  }),
  featureColumn.accessor('startsAt', {
    header: 'Starts at',
    meta: {
      info: 'The first plan with it; every plan above has it too.',
      type: { kind: 'enum', order: LeaguePlanOrder, label: (plan) => LEAGUE_PLAN_LABEL[plan as LeaguePlan] },
    },
    cell: ({ getValue }) => LEAGUE_PLAN_LABEL[getValue()],
  }),
];
