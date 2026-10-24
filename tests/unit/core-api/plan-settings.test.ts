import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import { AppSettingsService } from '../../../packages/core-api/src/modules/platform/app-settings-service';
import { PLAN_SETTINGS } from '../../../packages/core-api/src/modules/plans/plan-settings';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryRuntimeConfigs } from '../../support/in-memory-runtime-configs';

// The Plans settings group (#944): its starting values (the plan matrix, #986), and what a save is
// refused for beyond the JSON shape.

const defaults = PLAN_SETTINGS.defaults({});

describe('PLAN_SETTINGS', () => {
  it('starts at 20, 50, 100 and 500 entries per contest and 5, 15, 30 and 50 sports leagues a year, Free to Platinum', () => {
    expect(defaults.caps).toEqual({
      ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 100, PLATINUM: 500 },
      SPORTS_LEAGUES_PER_YEAR: { FREE: 5, PRO: 15, PREMIUM: 30, PLATINUM: 50 },
    });
  });

  it('starts the contest opening, receipt, results and event change emails on Free, the all-years summary and record book on Premium, and every other feature on Pro', () => {
    const startingAt = (plan: LeaguePlan) =>
      Object.values(PlanFeature).filter((feature) => defaults.features[feature] === plan).sort();

    expect(startingAt(LeaguePlan.FREE)).toEqual([
      PlanFeature.EMAIL_CONTEST_ENTRY_COMPLETED,
      PlanFeature.EMAIL_CONTEST_EVENT_CHANGED,
      PlanFeature.EMAIL_CONTEST_OPENED,
      PlanFeature.EMAIL_CONTEST_RESULTS,
    ]);
    expect(startingAt(LeaguePlan.PREMIUM)).toEqual([PlanFeature.ALL_TIME_SUMMARY, PlanFeature.RECORD_BOOK]);
    expect(startingAt(LeaguePlan.PLATINUM)).toEqual([]);
    expect(startingAt(LeaguePlan.PRO)).toHaveLength(Object.values(PlanFeature).length - 6);
  });

  it('loads a row saved before Platinum had caps, filling Platinum\'s from the defaults and keeping the rest as saved', async () => {
    const runtimeConfigs = inMemoryRuntimeConfigs();
    runtimeConfigs.put('PLAN_CONFIG', {
      caps: {
        ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 100 },
        SPORTS_LEAGUES_PER_YEAR: { FREE: 1, PRO: 3, PREMIUM: 10 },
      },
      features: { ...defaults.features, RECORD_BOOK: LeaguePlan.PLATINUM },
    });
    const settings = new AppSettingsService({ repository: runtimeConfigs, groups: [PLAN_SETTINGS], env: {}, logger: fakeLogger() });

    await settings.load();

    expect(settings.getState(PLAN_SETTINGS).source).toBe('stored');
    expect(settings.get(PLAN_SETTINGS).caps).toEqual({
      ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 100, PLATINUM: 500 },
      SPORTS_LEAGUES_PER_YEAR: { FREE: 1, PRO: 3, PREMIUM: 10, PLATINUM: 50 },
    });
    expect(settings.get(PLAN_SETTINGS).features.RECORD_BOOK).toBe(LeaguePlan.PLATINUM);
  });

  it('accepts its own defaults', () => {
    expect(PLAN_SETTINGS.schema.safeParse(defaults).success).toBe(true);
  });

  it('refuses a cap that is lower on a higher plan, naming the plan where it falls', () => {
    const result = PLAN_SETTINGS.schema.safeParse({
      ...defaults,
      caps: { ...defaults.caps, ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 40, PLATINUM: 500 } },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['caps', 'ENTRIES_PER_CONTEST', LeaguePlan.PREMIUM]);
  });

  it('refuses a number on a plan above an unlimited one, since unlimited is above every number', () => {
    const result = PLAN_SETTINGS.schema.safeParse({
      ...defaults,
      caps: { ...defaults.caps, SPORTS_LEAGUES_PER_YEAR: { FREE: 1, PRO: null, PREMIUM: 10, PLATINUM: 50 } },
    });

    expect(result.error?.issues[0]?.path).toEqual(['caps', 'SPORTS_LEAGUES_PER_YEAR', LeaguePlan.PREMIUM]);
  });

  it('refuses a Platinum cap below Premium\'s, since Platinum is capped like every plan', () => {
    const result = PLAN_SETTINGS.schema.safeParse({
      ...defaults,
      caps: { ...defaults.caps, ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 100, PLATINUM: 50 } },
    });

    expect(result.error?.issues[0]?.path).toEqual(['caps', 'ENTRIES_PER_CONTEST', LeaguePlan.PLATINUM]);
  });

  it('refuses a cap of zero, since a plan that allows nothing is not a plan', () => {
    const result = PLAN_SETTINGS.schema.safeParse({
      ...defaults,
      caps: { ...defaults.caps, ENTRIES_PER_CONTEST: { FREE: 0, PRO: 50, PREMIUM: 100, PLATINUM: 500 } },
    });

    expect(result.success).toBe(false);
  });

  it('accepts equal limits on neighbouring plans', () => {
    const result = PLAN_SETTINGS.schema.safeParse({
      ...defaults,
      caps: { ...defaults.caps, ENTRIES_PER_CONTEST: { FREE: 50, PRO: 50, PREMIUM: null, PLATINUM: null } },
    });

    expect(result.success).toBe(true);
  });
});
