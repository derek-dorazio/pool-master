import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import type { PlanConfig } from '@poolmaster/shared/dto';
import { PlanEntitlementsService, contestEntriesCap } from '../../../packages/core-api/src/modules/plans/plan-entitlements-service';
import { PLAN_SETTINGS } from '../../../packages/core-api/src/modules/plans/plan-settings';
import { buildLeague } from '../../factories';

// The plan entitlements service (#944): a league's plan and PLAN_CONFIG become its caps and features.

function buildService(options: { config?: PlanConfig; plan?: LeaguePlan } = {}) {
  let config = options.config ?? PLAN_SETTINGS.defaults({});
  const league = buildLeague({ plan: options.plan ?? LeaguePlan.PLATINUM });
  const service = new PlanEntitlementsService({
    leagues: { findById: async (id) => (id === league.id ? league : null) },
    readConfig: () => config,
  });
  return { service, league, setConfig: (next: PlanConfig) => { config = next; } };
}

describe('PlanEntitlementsService', () => {
  it('gives Platinum every feature and no limit, so a league that never picked a plan loses nothing', () => {
    const { service } = buildService();

    const platinum = service.forPlan(LeaguePlan.PLATINUM);

    expect(platinum.caps).toEqual({ ENTRIES_PER_CONTEST: null, SPORTS_LEAGUES_PER_YEAR: null });
    expect([...platinum.features].sort()).toEqual(Object.values(PlanFeature).sort());
  });

  it('gives Free its own caps and only the features that start at Free', () => {
    const { service } = buildService();

    const free = service.forPlan(LeaguePlan.FREE);

    expect(free.caps).toEqual({ ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 1 });
    expect([...free.features].sort()).toEqual([
      PlanFeature.EMAIL_CONTEST_ENTRY_COMPLETED,
      PlanFeature.EMAIL_CONTEST_EVENT_CHANGED,
      PlanFeature.EMAIL_CONTEST_OPENED,
      PlanFeature.EMAIL_CONTEST_RESULTS,
    ]);
  });

  it('gives a plan every feature that starts at a lower plan as well as its own', () => {
    const { service } = buildService();

    const premium = service.forPlan(LeaguePlan.PREMIUM);

    expect(premium.features.has(PlanFeature.EMAIL_CONTEST_OPENED)).toBe(true);
    expect(premium.features.has(PlanFeature.CUP_STANDINGS)).toBe(true);
    expect(premium.features.has(PlanFeature.RECORD_BOOK)).toBe(false);
    expect(premium.caps).toEqual({ ENTRIES_PER_CONTEST: 100, SPORTS_LEAGUES_PER_YEAR: 10 });
  });

  it('reads PLAN_CONFIG on every call, so a root admin\'s save applies without a restart', () => {
    const { service, setConfig } = buildService();
    const defaults = PLAN_SETTINGS.defaults({});

    setConfig({
      caps: { ...defaults.caps, ENTRIES_PER_CONTEST: { FREE: 30, PRO: 50, PREMIUM: 100 } },
      features: { ...defaults.features, CUP_STANDINGS: LeaguePlan.FREE },
    });
    const free = service.forPlan(LeaguePlan.FREE);

    expect(free.caps.ENTRIES_PER_CONTEST).toBe(30);
    expect(free.features.has(PlanFeature.CUP_STANDINGS)).toBe(true);
  });

  it('answers for a league from the plan the league is on now', async () => {
    const { service, league } = buildService({ plan: LeaguePlan.PRO });

    const entitlements = await service.forLeague(league.id);

    expect(entitlements.plan).toBe(LeaguePlan.PRO);
    expect(entitlements.caps).toEqual({ ENTRIES_PER_CONTEST: 50, SPORTS_LEAGUES_PER_YEAR: 3 });
  });

  it('refuses a league that does not exist with 404 LEAGUE_NOT_FOUND', async () => {
    const { service } = buildService();

    await expect(service.forLeague('00000000-0000-4000-8000-000000000000'))
      .rejects.toMatchObject({ code: 'LEAGUE_NOT_FOUND', statusCode: 404 });
  });
});

describe('contestEntriesCap (#980)', () => {
  const { service } = buildService();

  it('is the plan\'s entries per contest while the contest has no expansion', () => {
    expect(contestEntriesCap(service.forPlan(LeaguePlan.FREE), null)).toBe(20);
  });

  it('is the expansion when it is above the plan\'s cap', () => {
    expect(contestEntriesCap(service.forPlan(LeaguePlan.FREE), 200)).toBe(200);
  });

  it('is the plan\'s cap when it is above the expansion, so an expansion never lowers a contest\'s cap', () => {
    expect(contestEntriesCap(service.forPlan(LeaguePlan.PREMIUM), 50)).toBe(100);
  });

  it('stays unlimited on a plan with no cap whatever the expansion', () => {
    expect(contestEntriesCap(service.forPlan(LeaguePlan.PLATINUM), 1000)).toBeNull();
  });
});
