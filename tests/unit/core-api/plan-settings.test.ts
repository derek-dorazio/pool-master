import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import { PLAN_SETTINGS } from '../../../packages/core-api/src/modules/plans/plan-settings';

// The Plans settings group (#944): its starting values, and what a save is refused for beyond the JSON shape.

const defaults = PLAN_SETTINGS.defaults({});

describe('PLAN_SETTINGS', () => {
  it('starts at 20, 50 and 100 entries per contest and 1, 3 and 10 sports leagues a year, Free to Premium, with no values for Platinum', () => {
    expect(defaults.caps).toEqual({
      ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 100 },
      SPORTS_LEAGUES_PER_YEAR: { FREE: 1, PRO: 3, PREMIUM: 10 },
    });
  });

  it('starts the contest opening, receipt, results and event change emails on Free, the All years summary on Premium, the record book on Platinum, and every other feature on Pro', () => {
    const startingAt = (plan: LeaguePlan) =>
      Object.values(PlanFeature).filter((feature) => defaults.features[feature] === plan).sort();

    expect(startingAt(LeaguePlan.FREE)).toEqual([
      PlanFeature.EMAIL_CONTEST_ENTRY_COMPLETED,
      PlanFeature.EMAIL_CONTEST_EVENT_CHANGED,
      PlanFeature.EMAIL_CONTEST_OPENED,
      PlanFeature.EMAIL_CONTEST_RESULTS,
    ]);
    expect(startingAt(LeaguePlan.PREMIUM)).toEqual([PlanFeature.ALL_TIME_SUMMARY]);
    expect(startingAt(LeaguePlan.PLATINUM)).toEqual([PlanFeature.RECORD_BOOK]);
    expect(startingAt(LeaguePlan.PRO)).toHaveLength(Object.values(PlanFeature).length - 6);
  });

  it('accepts its own defaults', () => {
    expect(PLAN_SETTINGS.schema.safeParse(defaults).success).toBe(true);
  });

  it('refuses a cap that is lower on a higher plan, naming the plan where it falls', () => {
    const result = PLAN_SETTINGS.schema.safeParse({
      ...defaults,
      caps: { ...defaults.caps, ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 40 } },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['caps', 'ENTRIES_PER_CONTEST', LeaguePlan.PREMIUM]);
  });

  it('refuses a number on a plan above an unlimited one, since unlimited is above every number', () => {
    const result = PLAN_SETTINGS.schema.safeParse({
      ...defaults,
      caps: { ...defaults.caps, SPORTS_LEAGUES_PER_YEAR: { FREE: 1, PRO: null, PREMIUM: 10 } },
    });

    expect(result.error?.issues[0]?.path).toEqual(['caps', 'SPORTS_LEAGUES_PER_YEAR', LeaguePlan.PREMIUM]);
  });

  it('drops a Platinum limit sent with a save, since Platinum is always unlimited and has no value to store', () => {
    const result = PLAN_SETTINGS.schema.safeParse({
      ...defaults,
      caps: { ...defaults.caps, ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 100, PLATINUM: 500 } },
    });

    expect(result.data?.caps.ENTRIES_PER_CONTEST).toEqual({ FREE: 20, PRO: 50, PREMIUM: 100 });
  });

  it('refuses a cap of zero, since a plan that allows nothing is not a plan', () => {
    const result = PLAN_SETTINGS.schema.safeParse({
      ...defaults,
      caps: { ...defaults.caps, ENTRIES_PER_CONTEST: { FREE: 0, PRO: 50, PREMIUM: 100 } },
    });

    expect(result.success).toBe(false);
  });

  it('accepts equal limits on neighbouring plans', () => {
    const result = PLAN_SETTINGS.schema.safeParse({
      ...defaults,
      caps: { ...defaults.caps, ENTRIES_PER_CONTEST: { FREE: 50, PRO: 50, PREMIUM: null } },
    });

    expect(result.success).toBe(true);
  });
});
