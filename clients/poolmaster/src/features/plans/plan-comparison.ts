import { PlanCap, type PlanFeatureGroup } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import type { PlanEntitlementsDto, PlanFeatureGroupDto } from '@/lib/api';
import {
  EVERY_PLAN_INCLUDES,
  PLAN_CAP_DESCRIPTION,
  PLAN_FEATURE_DESCRIPTION,
  formatPlanLimit,
} from './plan-labels';

/** What the comparison table needs of one plan: its caps and the features it has. */
export type ComparedPlan = Pick<PlanEntitlementsDto, 'plan' | 'caps' | 'features'>;

export interface PlanComparisonRow {
  key: string;
  label: string;
  /** One line on what the row is (#971). */
  description: string;
  /** The cap a limits row shows; null for a feature or an "In every plan" row. */
  cap: PlanCap | null;
  /** One cell per plan, in the plans' order: a limit's text, or whether the plan has the feature. */
  cells: ReadonlyArray<string | boolean>;
}

export interface PlanComparisonSection {
  key: string;
  title: string;
  /** The feature group a section shows, which the table can fold to a count; null for limits and "In every plan". */
  group: PlanFeatureGroup | null;
  rows: PlanComparisonRow[];
}

/**
 * The comparison table (#945, #971): the limits, what every plan includes, then each group of
 * features, one column per plan in the order given. Built from what the API says each plan has
 * and which group each feature is in, never from the plan's name.
 */
export function buildPlanComparison(
  plans: readonly ComparedPlan[],
  featureGroups: readonly PlanFeatureGroupDto[],
  locale: string,
): PlanComparisonSection[] {
  const limits: PlanComparisonSection = {
    key: 'limits',
    title: 'Limits',
    group: null,
    rows: Object.values(PlanCap).map((cap) => ({
      key: cap,
      cap,
      label: enumLabel('PlanCap', cap),
      description: PLAN_CAP_DESCRIPTION[cap],
      cells: plans.map((plan) => formatPlanLimit(plan.caps[cap], locale)),
    })),
  };
  const included: PlanComparisonSection = {
    key: 'included',
    title: 'In every plan',
    group: null,
    rows: EVERY_PLAN_INCLUDES.map((row) => ({
      key: row.key,
      cap: null,
      label: row.label,
      description: row.description,
      cells: plans.map(() => row.value),
    })),
  };
  const groups = featureGroups.map(({ group, features }) => ({
    key: group,
    title: enumLabel('PlanFeatureGroup', group),
    group,
    rows: features
      .map((feature) => ({
        key: feature,
        cap: null,
        label: enumLabel('PlanFeature', feature),
        description: PLAN_FEATURE_DESCRIPTION[feature],
        cells: plans.map((plan) => plan.features.includes(feature)),
      })),
  }));
  return [limits, included, ...groups];
}
