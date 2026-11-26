import { PlanCap, type LeaguePlan, type PlanFeature } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import type { PlanFeatureGroupDto } from '@/lib/api';
import type { ComparedPlan } from './plan-comparison';
import { EVERY_CONTEST_TYPE_LABEL, formatPlanCapHighlight, formatPlanFeatureGroupHighlight } from './plan-labels';

/** A group with this many features to list on one card shows as one counted line instead. */
const GROUP_COUNT_THRESHOLD = 3;

export interface PlanHighlights {
  plan: LeaguePlan;
  /** The plan below, whose card this one adds to ("Everything in Pro, plus"), or null for the lowest. */
  adds: LeaguePlan | null;
  lines: string[];
}

/**
 * Features as lines to read, group by group as the API groups them (#2110): each by name, or one
 * counted line ("7 emails") for a group with three or more of them. Plan cards and the move
 * confirm (#972) both list this way.
 */
export function buildFeatureLines(features: readonly PlanFeature[], featureGroups: readonly PlanFeatureGroupDto[], isAddition: boolean): string[] {
  return featureGroups.flatMap(({ group, features: grouped }) => {
    const inGroup = grouped.filter((feature) => features.includes(feature));
    return inGroup.length >= GROUP_COUNT_THRESHOLD
      ? [formatPlanFeatureGroupHighlight(group, inGroup.length, isAddition)]
      : inGroup.map((feature) => enumLabel('PlanFeature', feature));
  });
}

/**
 * Each plan card's highlights (#971), lowest plan first, built from what the API says each plan
 * has and never from a plan's name, so a change on the root admin Plans page moves its line.
 * The lowest plan lists its caps, every contest type and its features; each plan above lists
 * the caps that differ from the plan below and the features it adds.
 */
export function buildPlanHighlights(
  plans: readonly ComparedPlan[],
  featureGroups: readonly PlanFeatureGroupDto[],
  locale: string,
): PlanHighlights[] {
  return plans.map((plan, index) => {
    const below = index > 0 ? plans[index - 1] : undefined;
    const caps = Object.values(PlanCap)
      .filter((cap) => !below || below.caps[cap] !== plan.caps[cap])
      .map((cap) => formatPlanCapHighlight(cap, plan.caps[cap], locale));
    if (!below) {
      return {
        plan: plan.plan,
        adds: null,
        lines: [...caps, EVERY_CONTEST_TYPE_LABEL, ...buildFeatureLines(plan.features, featureGroups, false)],
      };
    }
    const added = plan.features.filter((feature) => !below.features.includes(feature));
    return { plan: plan.plan, adds: below.plan, lines: [...caps, ...buildFeatureLines(added, featureGroups, true)] };
  });
}
