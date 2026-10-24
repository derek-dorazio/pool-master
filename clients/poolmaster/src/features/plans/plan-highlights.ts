import { PLAN_FEATURE_GROUP, PlanCap, PlanFeature, PlanFeatureGroup, type LeaguePlan } from '@poolmaster/shared/domain';
import type { ComparedPlan } from './plan-comparison';
import { EVERY_CONTEST_TYPE_LABEL, PLAN_FEATURE_LABEL, formatPlanCapHighlight, formatPlanFeatureGroupHighlight } from './plan-labels';

/** A group with this many features to list on one card shows as one counted line instead. */
const GROUP_COUNT_THRESHOLD = 3;

export interface PlanHighlights {
  plan: LeaguePlan;
  /** The plan below, whose card this one adds to ("Everything in Pro, plus"), or null for the lowest. */
  adds: LeaguePlan | null;
  lines: string[];
}

/**
 * Features as lines to read, in `PlanFeature` order: each by name, or one counted line ("7 emails")
 * for a group with three or more of them. Plan cards and the move confirm (#972) both list this way.
 */
export function buildFeatureLines(features: readonly PlanFeature[], isAddition: boolean): string[] {
  return Object.values(PlanFeatureGroup).flatMap((group) => {
    const inGroup = Object.values(PlanFeature).filter((feature) => PLAN_FEATURE_GROUP[feature] === group && features.includes(feature));
    return inGroup.length >= GROUP_COUNT_THRESHOLD
      ? [formatPlanFeatureGroupHighlight(group, inGroup.length, isAddition)]
      : inGroup.map((feature) => PLAN_FEATURE_LABEL[feature]);
  });
}

/**
 * Each plan card's highlights (#971), lowest plan first, built from what the API says each plan
 * has and never from a plan's name, so a change on the root admin Plans page moves its line.
 * The lowest plan lists its caps, every contest type and its features; each plan above lists
 * the caps that differ from the plan below and the features it adds.
 */
export function buildPlanHighlights(plans: readonly ComparedPlan[]): PlanHighlights[] {
  return plans.map((plan, index) => {
    const below = index > 0 ? plans[index - 1] : undefined;
    const caps = Object.values(PlanCap)
      .filter((cap) => !below || below.caps[cap] !== plan.caps[cap])
      .map((cap) => formatPlanCapHighlight(cap, plan.caps[cap]));
    if (!below) {
      return {
        plan: plan.plan,
        adds: null,
        lines: [...caps, EVERY_CONTEST_TYPE_LABEL, ...buildFeatureLines(plan.features, false)],
      };
    }
    const added = plan.features.filter((feature) => !below.features.includes(feature));
    return { plan: plan.plan, adds: below.plan, lines: [...caps, ...buildFeatureLines(added, true)] };
  });
}
