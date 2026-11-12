import { describe, expect, it } from 'vitest';
import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import { hasPlanFeature, lowestPlanIncluding } from './plan-features';

const PLANS = [
  { plan: LeaguePlan.FREE, features: [] },
  { plan: LeaguePlan.PRO, features: [PlanFeature.EMAIL_EVENT_READY_FOR_CONTESTS] },
  { plan: LeaguePlan.PREMIUM, features: [PlanFeature.EMAIL_EVENT_READY_FOR_CONTESTS, PlanFeature.CUP_SETTINGS] },
];

describe('lowestPlanIncluding', () => {
  it('names the first plan, lowest first, that includes the feature', () => {
    expect(lowestPlanIncluding(PLANS, [PlanFeature.CUP_SETTINGS])).toBe(LeaguePlan.PREMIUM);
  });

  it('names the first plan that includes any one of several features', () => {
    expect(lowestPlanIncluding(PLANS, [PlanFeature.CUP_SETTINGS, PlanFeature.EMAIL_EVENT_READY_FOR_CONTESTS])).toBe(LeaguePlan.PRO);
  });

  it('answers null when no plan includes the feature', () => {
    expect(lowestPlanIncluding(PLANS, [PlanFeature.RECORD_BOOK])).toBeNull();
  });
});

describe('hasPlanFeature', () => {
  it('answers false while the league has not loaded', () => {
    expect(hasPlanFeature(undefined, PlanFeature.CUP_SETTINGS)).toBe(false);
  });
});
