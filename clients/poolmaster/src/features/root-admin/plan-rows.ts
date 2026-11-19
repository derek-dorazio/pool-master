import { z } from 'zod';
import {
  LeaguePlan,
  PLAN_FEATURE_GROUP,
  PlanCap,
  PlanFeature,
  type PlanFeatureGroup,
} from '@poolmaster/shared/domain';
import type { PlanConfig } from '@/lib/api';
import { PLAN_CAP_LABEL, PLAN_FEATURE_LABEL } from '@/features/plans/plan-labels';
import {
  PlanSettingsDraftSchema,
  toPlanConfig,
  toPlanSettingsDraft,
  type PlanCapCellDraft,
} from './plan-settings-draft';

/** One row of the Plans page's Caps grid (#1884): a cap and its limit on each plan, null for Unlimited. */
export type PlanCapGridRow = {
  cap: PlanCap;
  name: string;
  limits: Readonly<Record<LeaguePlan, number | null>>;
};

/** One row of the Features grid (#1884): a feature, its group and the first plan that has it. */
export type PlanFeatureGridRow = {
  feature: PlanFeature;
  name: string;
  group: PlanFeatureGroup;
  startsAt: LeaguePlan;
};

export function planCapRows(config: PlanConfig): PlanCapGridRow[] {
  return Object.values(PlanCap).map((cap) => ({ cap, name: PLAN_CAP_LABEL[cap], limits: config.caps[cap] }));
}

export function planFeatureRows(config: PlanConfig): PlanFeatureGridRow[] {
  return Object.values(PlanFeature).map((feature) => ({
    feature,
    name: PLAN_FEATURE_LABEL[feature],
    group: PLAN_FEATURE_GROUP[feature],
    startsAt: config.features[feature],
  }));
}

/** A cap dialog's form: Unlimited, or the number typed in, for each plan. */
export type PlanCapFormValues = Record<LeaguePlan, PlanCapCellDraft>;

export function planCapFormValues(config: PlanConfig, cap: PlanCap): PlanCapFormValues {
  return toPlanSettingsDraft(config).caps[cap];
}

/** The whole PLAN_CONFIG record with only this cap's row changed, as its Save sends it. */
export function withPlanCap(config: PlanConfig, cap: PlanCap, values: PlanCapFormValues): PlanConfig {
  const draft = toPlanSettingsDraft(config);
  return toPlanConfig({ ...draft, caps: { ...draft.caps, [cap]: values } });
}

/** The whole PLAN_CONFIG record with only this feature's starting plan changed. */
export function withPlanFeature(config: PlanConfig, feature: PlanFeature, startsAt: LeaguePlan): PlanConfig {
  return { ...config, features: { ...config.features, [feature]: startsAt } };
}

/**
 * The cap form's checks: the same ones the whole record gets (whole numbers in range, and no
 * plan allowing less than the one below it), each placed on the plan it is about. The rest of
 * the record is checked too, as it stands.
 */
export function planCapFormSchema(config: PlanConfig, cap: PlanCap) {
  return z.custom<PlanCapFormValues>().superRefine((values, context) => {
    const draft = toPlanSettingsDraft(config);
    const parsed = PlanSettingsDraftSchema.safeParse({ ...draft, caps: { ...draft.caps, [cap]: values } });
    if (parsed.success) {
      return;
    }
    // Each issue is on ['caps', cap, plan, 'limit']; this form holds one cap's plans.
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'caps' && issue.path[1] === cap) {
        context.addIssue({ code: 'custom', path: issue.path.slice(2), message: issue.message });
      }
    }
  });
}

/** A feature dialog's Starts at choices: the plan it starts at, and the plans above it that have it too. */
export const FEATURE_STARTS_AT_LABEL: Readonly<Record<LeaguePlan, string>> = {
  [LeaguePlan.FREE]: 'Every plan',
  [LeaguePlan.PRO]: 'Pro and up',
  [LeaguePlan.PREMIUM]: 'Premium and up',
  [LeaguePlan.PLATINUM]: 'Platinum only',
};
