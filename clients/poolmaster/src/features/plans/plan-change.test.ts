import { describe, expect, it } from 'vitest';
import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import { buildCapUsage, buildPlanChangeEffects } from './plan-change';
import { buildPlanEntitlements } from './test/fixtures';

const FREE = buildPlanEntitlements({
  plan: LeaguePlan.FREE,
  caps: { ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 1 },
  features: [PlanFeature.EMAIL_CONTEST_OPENED],
});
const PRO = buildPlanEntitlements({
  plan: LeaguePlan.PRO,
  caps: { ENTRIES_PER_CONTEST: 50, SPORTS_LEAGUES_PER_YEAR: 3 },
  features: [PlanFeature.EMAIL_CONTEST_OPENED, PlanFeature.CHAMPIONSHIP, PlanFeature.PAST_YEARS],
});
const USAGE = {
  seasonYear: 2026,
  sportLeagueIds: ['sl-1', 'sl-2'],
  openContests: [
    { contestId: 'c-1', name: 'Small', entryCount: 20 },
    { contestId: 'c-2', name: 'Mid', entryCount: 21 },
    { contestId: 'c-3', name: 'Big', entryCount: 40 },
  ],
};

describe('buildPlanChangeEffects', () => {
  it('lists the open contests over a lower plan\'s entry limit fullest first, leaving one exactly at it, plus the sports leagues over and the features it hides', () => {
    expect(buildPlanChangeEffects(PRO, FREE, USAGE)).toEqual({
      contestsOverEntries: [USAGE.openContests[2], USAGE.openContests[1]],
      entriesLimit: 20,
      sportLeaguesOver: { used: 2, limit: 1 },
      hiddenFeatures: [PlanFeature.CHAMPIONSHIP, PlanFeature.PAST_YEARS],
    });
  });

  it('finds nothing to stop or hide on a higher plan', () => {
    expect(buildPlanChangeEffects(FREE, PRO, USAGE)).toEqual({
      contestsOverEntries: [],
      entriesLimit: null,
      sportLeaguesOver: null,
      hiddenFeatures: [],
    });
  });

  it('never warns about a cap the target plan leaves without a limit', () => {
    const noLimits = buildPlanEntitlements({ plan: LeaguePlan.PREMIUM, features: PRO.features });
    expect(buildPlanChangeEffects(PRO, noLimits, USAGE).contestsOverEntries).toEqual([]);
    expect(buildPlanChangeEffects(PRO, noLimits, USAGE).sportLeaguesOver).toBeNull();
  });
});

describe('buildCapUsage', () => {
  it('counts the fullest open contest and this year\'s sports leagues, and zero entries with no open contest', () => {
    expect(buildCapUsage(USAGE)).toEqual({ ENTRIES_PER_CONTEST: 40, SPORTS_LEAGUES_PER_YEAR: 2 });
    expect(buildCapUsage({ ...USAGE, openContests: [] }).ENTRIES_PER_CONTEST).toBe(0);
  });
});
