import { describe, expect, it } from 'vitest';
import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import { buildPlanHighlights } from './plan-highlights';
import { buildPlanEntitlements } from './test/fixtures';

const FREE_EMAILS = [
  PlanFeature.EMAIL_CONTEST_OPENED,
  PlanFeature.EMAIL_CONTEST_ENTRY_COMPLETED,
  PlanFeature.EMAIL_CONTEST_RESULTS,
  PlanFeature.EMAIL_CONTEST_EVENT_CHANGED,
];

describe('buildPlanHighlights', () => {
  it('lists the lowest plan\'s caps, every contest type and its features, with three or more emails as one counted line', () => {
    const [free] = buildPlanHighlights([
      buildPlanEntitlements({ plan: LeaguePlan.FREE, caps: { ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 1 }, features: [...FREE_EMAILS, PlanFeature.PAST_YEARS] }),
    ]);

    expect(free).toEqual({
      plan: LeaguePlan.FREE,
      adds: null,
      lines: ['Up to 20 entries per contest', '1 sports league a year', 'Every contest type', '4 emails', 'Past years'],
    });
  });

  it('lists only the caps that differ from the plan below and the features a plan adds, naming that plan', () => {
    const [, pro] = buildPlanHighlights([
      buildPlanEntitlements({ plan: LeaguePlan.FREE, caps: { ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 3 }, features: FREE_EMAILS }),
      buildPlanEntitlements({
        plan: LeaguePlan.PRO,
        caps: { ENTRIES_PER_CONTEST: 50, SPORTS_LEAGUES_PER_YEAR: 3 },
        features: [...FREE_EMAILS, PlanFeature.EMAIL_CONTEST_ENTRY_REMINDER, PlanFeature.EMAIL_CONTEST_STANDINGS, PlanFeature.CHAMPIONSHIP],
      }),
    ]);

    expect(pro).toEqual({
      plan: LeaguePlan.PRO,
      adds: LeaguePlan.FREE,
      lines: ['Up to 50 entries per contest', 'Entry reminder email', 'Standings email', 'League championship'],
    });
  });

  it('moves a feature\'s line to the plan the settings now start it at, with no change to the code', () => {
    const plans = (allYearsFrom: LeaguePlan) => [
      buildPlanEntitlements({ plan: LeaguePlan.PRO, caps: { ENTRIES_PER_CONTEST: 50, SPORTS_LEAGUES_PER_YEAR: 3 }, features: [] }),
      buildPlanEntitlements({
        plan: LeaguePlan.PREMIUM,
        caps: { ENTRIES_PER_CONTEST: 100, SPORTS_LEAGUES_PER_YEAR: 10 },
        features: allYearsFrom === LeaguePlan.PREMIUM ? [PlanFeature.ALL_TIME_SUMMARY] : [],
      }),
      buildPlanEntitlements({ plan: LeaguePlan.PLATINUM, features: [PlanFeature.ALL_TIME_SUMMARY, PlanFeature.RECORD_BOOK] }),
    ];

    const onPremium = buildPlanHighlights(plans(LeaguePlan.PREMIUM));
    expect(onPremium[1]?.lines).toContain('All years');
    expect(onPremium[2]?.lines).toEqual(['Unlimited entries per contest', 'Every sports league, every year', 'Record book']);

    const onPlatinum = buildPlanHighlights(plans(LeaguePlan.PLATINUM));
    expect(onPlatinum[1]?.lines).not.toContain('All years');
    expect(onPlatinum[2]?.lines).toContain('All years');
  });
});
