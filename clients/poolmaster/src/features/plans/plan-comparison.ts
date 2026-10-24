import { PLAN_FEATURE_GROUP, PlanCap, PlanFeature, PlanFeatureGroup, type LeaguePlan } from '@poolmaster/shared/domain';
import { PLAN_CAP_LABEL, PLAN_FEATURE_GROUP_LABEL, PLAN_FEATURE_LABEL, formatPlanLimit } from './plan-labels';

/** What the comparison table needs of one plan: its caps and the features it has. */
export interface ComparedPlan {
  plan: LeaguePlan;
  caps: Readonly<Record<PlanCap, number | null>>;
  features: readonly PlanFeature[];
}

export interface PlanComparisonRow {
  key: string;
  label: string;
  /** One cell per plan, in the plans' order: a limit's text, or whether the plan has the feature. */
  cells: ReadonlyArray<string | boolean>;
}

export interface PlanComparisonSection {
  key: string;
  title: string;
  rows: PlanComparisonRow[];
}

/**
 * The comparison table (#945): the limits first, then each group of features, one column per
 * plan in the order given. Built from what the API says each plan has, never from the plan's name.
 */
export function buildPlanComparison(plans: readonly ComparedPlan[]): PlanComparisonSection[] {
  const limits: PlanComparisonSection = {
    key: 'limits',
    title: 'Limits',
    rows: Object.values(PlanCap).map((cap) => ({
      key: cap,
      label: PLAN_CAP_LABEL[cap],
      cells: plans.map((plan) => formatPlanLimit(plan.caps[cap])),
    })),
  };
  const groups = Object.values(PlanFeatureGroup).map((group) => ({
    key: group,
    title: PLAN_FEATURE_GROUP_LABEL[group],
    rows: Object.values(PlanFeature)
      .filter((feature) => PLAN_FEATURE_GROUP[feature] === group)
      .map((feature) => ({
        key: feature,
        label: PLAN_FEATURE_LABEL[feature],
        cells: plans.map((plan) => plan.features.includes(feature)),
      })),
  }));
  return [limits, ...groups];
}
