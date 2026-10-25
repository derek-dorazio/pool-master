import { LeaguePlan } from '@poolmaster/shared/domain';
import { LeaguePlanService, type LeaguePlanServiceDeps } from '../../../packages/core-api/src/modules/plans/league-plan-service';
import { PlanEntitlementsService } from '../../../packages/core-api/src/modules/plans/plan-entitlements-service';
import { PLAN_SETTINGS } from '../../../packages/core-api/src/modules/plans/plan-settings';
import { LeagueNotFoundError, LeagueOperationError } from '../../../packages/core-api/src/modules/leagues/service';
import { inMemoryLeagueWorld } from '../../support/in-memory-league-world';

// Choosing a plan (#945): any commissioner or root admin moves a league to a plan, at once, logged;
// only a root admin to one not offered yet (#986). Extending a gifted plan (#986): a root admin moves
// renewal dates out, never earlier, logged. Once a league's date passes, it moves to Free, logged.

const NOW = new Date('2026-10-24T15:00:00.000Z');

function planEntitlements() {
  return new PlanEntitlementsService({ leagues: { findById: async () => null }, readConfig: () => PLAN_SETTINGS.defaults({}) });
}

function setup(leagues?: LeaguePlanServiceDeps['leagues']) {
  const world = inMemoryLeagueWorld();
  const service = new LeaguePlanService({ leagues: leagues ?? world.leagues, planEntitlements: planEntitlements(), now: () => NOW });
  const user = world.addUser();
  const commissioner = { userId: user.id, isRootAdmin: false };
  const rootAdmin = { userId: user.id, isRootAdmin: true };
  return { world, service, commissioner, rootAdmin };
}

describe('LeaguePlanService', () => {
  it('moves the league to the chosen plan at once and logs who changed it from which plan', async () => {
    const { world, service, commissioner } = setup();
    const league = world.addLeague();

    const updated = await service.changePlan(league.id, LeaguePlan.FREE, commissioner);

    expect(updated.plan).toBe(LeaguePlan.FREE);
    expect((await world.leagues.findById(league.id))?.plan).toBe(LeaguePlan.FREE);
    expect(world.planChanges).toEqual([
      { leagueId: league.id, fromPlan: LeaguePlan.PLATINUM, toPlan: LeaguePlan.FREE, changedById: commissioner.userId },
    ]);
  });

  it('lets a league move back up to a higher plan, logging each change in order', async () => {
    const { world, service, commissioner } = setup();
    const league = world.addLeague();

    await service.changePlan(league.id, LeaguePlan.FREE, commissioner);
    const updated = await service.changePlan(league.id, LeaguePlan.PREMIUM, commissioner);

    expect(updated.plan).toBe(LeaguePlan.PREMIUM);
    expect(world.planChanges.map((change) => [change.fromPlan, change.toPlan])).toEqual([
      [LeaguePlan.PLATINUM, LeaguePlan.FREE],
      [LeaguePlan.FREE, LeaguePlan.PREMIUM],
    ]);
  });

  it('changes and logs nothing when the league is already on the chosen plan', async () => {
    const { world, service, commissioner } = setup();
    const league = world.addLeague({ plan: LeaguePlan.PRO });

    const updated = await service.changePlan(league.id, LeaguePlan.PRO, commissioner);

    expect(updated.plan).toBe(LeaguePlan.PRO);
    expect(world.planChanges).toEqual([]);
  });

  it('refuses with 409 LEAGUE_PLAN_CHANGED, changing and logging nothing, when someone else changed the plan during the change', async () => {
    const world = inMemoryLeagueWorld();
    const commissioner = { userId: world.addUser().id, isRootAdmin: false };
    const league = world.addLeague();
    // Someone else moves the league to Pro between this change's read and its write.
    const service = new LeaguePlanService({
      leagues: {
        ...world.leagues,
        changePlan: async (leagueId, change) => {
          await world.leagues.changePlan(leagueId, { fromPlan: LeaguePlan.PLATINUM, toPlan: LeaguePlan.PRO, changedById: 'other' });
          return world.leagues.changePlan(leagueId, change);
        },
      },
      planEntitlements: planEntitlements(),
    });

    const attempt = service.changePlan(league.id, LeaguePlan.FREE, commissioner);

    await expect(attempt).rejects.toMatchObject({ code: 'LEAGUE_PLAN_CHANGED', statusCode: 409 });
    expect((await world.leagues.findById(league.id))?.plan).toBe(LeaguePlan.PRO);
    expect(world.planChanges.map((change) => change.toPlan)).toEqual([LeaguePlan.PRO]);
  });

  it('rejects a plan change for a league that does not exist', async () => {
    const { service, commissioner } = setup();

    await expect(service.changePlan('missing-league', LeaguePlan.FREE, commissioner))
      .rejects.toBeInstanceOf(LeagueNotFoundError);
  });

  it('rejects a plan change for an inactive league, which is read-only, and logs nothing', async () => {
    const { world, service, commissioner } = setup();
    const league = world.addLeague({ isActive: false });

    const attempt = service.changePlan(league.id, LeaguePlan.FREE, commissioner);

    await expect(attempt).rejects.toBeInstanceOf(LeagueOperationError);
    await expect(attempt).rejects.toMatchObject({ code: 'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE' });
    expect(world.planChanges).toEqual([]);
    expect((await world.leagues.findById(league.id))?.plan).toBe(LeaguePlan.PLATINUM);
  });

  it('refuses a commissioner Platinum, which is not offered yet, with 400 LEAGUE_PLAN_NOT_AVAILABLE, changing and logging nothing', async () => {
    const { world, service, commissioner } = setup();
    const league = world.addLeague({ plan: LeaguePlan.PREMIUM });

    const attempt = service.changePlan(league.id, LeaguePlan.PLATINUM, commissioner);

    await expect(attempt).rejects.toMatchObject({ code: 'LEAGUE_PLAN_NOT_AVAILABLE', statusCode: 400 });
    expect((await world.leagues.findById(league.id))?.plan).toBe(LeaguePlan.PREMIUM);
    expect(world.planChanges).toEqual([]);
  });

  it('lets a root admin move a league to Platinum, logged', async () => {
    const { world, service, rootAdmin } = setup();
    const league = world.addLeague({ plan: LeaguePlan.PREMIUM });

    const updated = await service.changePlan(league.id, LeaguePlan.PLATINUM, rootAdmin);

    expect(updated.plan).toBe(LeaguePlan.PLATINUM);
    expect(world.planChanges.map((change) => change.toPlan)).toEqual([LeaguePlan.PLATINUM]);
  });

  it('extends one league\'s gift to the chosen months from now, logging who moved it from which date to which', async () => {
    const { world, service, rootAdmin } = setup();
    const league = world.addLeague({ planRenewsAt: new Date('2027-01-10T00:00:00.000Z') });

    const updated = await service.extendRenewal(league.id, 6, rootAdmin.userId);

    expect(updated.planRenewsAt).toEqual(new Date('2027-04-24T15:00:00.000Z'));
    expect(updated.plan).toBe(LeaguePlan.PLATINUM);
    expect(world.planRenewalChanges).toEqual([{
      leagueId: league.id,
      fromRenewsAt: new Date('2027-01-10T00:00:00.000Z'),
      toRenewsAt: new Date('2027-04-24T15:00:00.000Z'),
      changedById: rootAdmin.userId,
    }]);
  });

  it('never moves a gift earlier: a league renewing after the new date keeps it, and nothing is logged', async () => {
    const { world, service, rootAdmin } = setup();
    const league = world.addLeague({ planRenewsAt: new Date('2028-01-01T00:00:00.000Z') });

    const updated = await service.extendRenewal(league.id, 1, rootAdmin.userId);

    expect(updated.planRenewsAt).toEqual(new Date('2028-01-01T00:00:00.000Z'));
    expect(world.planRenewalChanges).toEqual([]);
  });

  it('holds an extension at the month\'s last day as Postgres does: Aug 31 plus 6 months is Feb 28, not Mar 3', async () => {
    const world = inMemoryLeagueWorld();
    const service = new LeaguePlanService({
      leagues: world.leagues, planEntitlements: planEntitlements(), now: () => new Date('2026-08-31T15:00:00.000Z'),
    });
    const league = world.addLeague({ planRenewsAt: new Date('2026-09-01T00:00:00.000Z') });

    const updated = await service.extendRenewal(league.id, 6, world.addUser().id);

    expect(updated.planRenewsAt).toEqual(new Date('2027-02-28T15:00:00.000Z'));
  });

  it('refuses to extend the gift of a league that does not exist', async () => {
    const { service, rootAdmin } = setup();

    await expect(service.extendRenewal('missing-league', 3, rootAdmin.userId)).rejects.toBeInstanceOf(LeagueNotFoundError);
  });

  it('extends every gift that still runs and ends sooner, leaving ended gifts and later ones alone', async () => {
    const { world, service, rootAdmin } = setup();
    const soon = world.addLeague({ planRenewsAt: new Date('2026-11-01T00:00:00.000Z') });
    const ended = world.addLeague({ planRenewsAt: new Date('2026-10-01T00:00:00.000Z') });
    const later = world.addLeague({ planRenewsAt: new Date('2027-12-01T00:00:00.000Z') });

    const result = await service.extendRunningRenewals(3, rootAdmin.userId);

    expect(result).toEqual({ extendedCount: 1, renewsAt: new Date('2027-01-24T15:00:00.000Z') });
    expect((await world.leagues.findById(soon.id))?.planRenewsAt).toEqual(new Date('2027-01-24T15:00:00.000Z'));
    expect((await world.leagues.findById(ended.id))?.planRenewsAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect((await world.leagues.findById(later.id))?.planRenewsAt).toEqual(new Date('2027-12-01T00:00:00.000Z'));
    expect(world.planRenewalChanges.map((change) => change.leagueId)).toEqual([soon.id]);
  });

  it('moves every league whose renewal date has passed to Free, logged as made by no one, and leaves running gifts and Free leagues alone', async () => {
    const { world, service } = setup();
    const ended = world.addLeague({ plan: LeaguePlan.PREMIUM, planRenewsAt: new Date('2026-10-24T14:59:00.000Z') });
    const endsNow = world.addLeague({ plan: LeaguePlan.PRO, planRenewsAt: NOW });
    const running = world.addLeague({ plan: LeaguePlan.PREMIUM, planRenewsAt: new Date('2026-10-24T15:01:00.000Z') });
    const alreadyFree = world.addLeague({ plan: LeaguePlan.FREE, planRenewsAt: new Date('2026-10-01T00:00:00.000Z') });

    const moved = await service.moveEndedToFree(NOW);

    expect(moved).toBe(2);
    expect((await world.leagues.findById(ended.id))?.plan).toBe(LeaguePlan.FREE);
    expect((await world.leagues.findById(endsNow.id))?.plan).toBe(LeaguePlan.FREE);
    expect((await world.leagues.findById(running.id))?.plan).toBe(LeaguePlan.PREMIUM);
    expect((await world.leagues.findById(alreadyFree.id))?.plan).toBe(LeaguePlan.FREE);
    expect(world.planChanges).toEqual([
      { leagueId: ended.id, fromPlan: LeaguePlan.PREMIUM, toPlan: LeaguePlan.FREE, changedById: null },
      { leagueId: endsNow.id, fromPlan: LeaguePlan.PRO, toPlan: LeaguePlan.FREE, changedById: null },
    ]);
  });

  it('moves an ended league to Free once, however many sweeps run', async () => {
    const { world, service } = setup();
    world.addLeague({ plan: LeaguePlan.PREMIUM, planRenewsAt: new Date('2026-10-24T14:00:00.000Z') });

    await service.moveEndedToFree(NOW);
    const again = await service.moveEndedToFree(new Date(NOW.getTime() + 5 * 60_000));

    expect(again).toBe(0);
    expect(world.planChanges).toHaveLength(1);
  });

  it('puts a league the end of its gift moved to Free back on the plan it had when its gift is extended, logged as the root admin\'s change', async () => {
    const { world, service, rootAdmin } = setup();
    const league = world.addLeague({ plan: LeaguePlan.PREMIUM, planRenewsAt: new Date('2026-10-24T14:00:00.000Z') });
    await service.moveEndedToFree(NOW);

    const updated = await service.extendRenewal(league.id, 3, rootAdmin.userId);

    expect(updated.plan).toBe(LeaguePlan.PREMIUM);
    expect(world.planChanges.at(-1)).toEqual({ leagueId: league.id, fromPlan: LeaguePlan.FREE, toPlan: LeaguePlan.PREMIUM, changedById: rootAdmin.userId });
  });

  it('leaves a league its commissioner moved to Free on Free when its gift is extended', async () => {
    const { world, service, commissioner, rootAdmin } = setup();
    const league = world.addLeague({ plan: LeaguePlan.PREMIUM });
    await service.changePlan(league.id, LeaguePlan.FREE, commissioner);

    const updated = await service.extendRenewal(league.id, 12, rootAdmin.userId);

    expect(updated.plan).toBe(LeaguePlan.FREE);
    expect(world.planChanges).toHaveLength(1);
  });

  it('leaves a league on Free when its last move to Free, by someone whose account is gone, came before its date', async () => {
    const { world, rootAdmin } = setup();
    const league = world.addLeague({ plan: LeaguePlan.FREE, planRenewsAt: new Date('2026-11-01T00:00:00.000Z') });
    const leagues: LeaguePlanServiceDeps['leagues'] = {
      ...world.leagues,
      findLastPlanChange: async () => ({
        fromPlan: LeaguePlan.PREMIUM, toPlan: LeaguePlan.FREE, changedById: null, changedAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    };
    const withDeletedChanger = new LeaguePlanService({ leagues, planEntitlements: planEntitlements(), now: () => NOW });

    const updated = await withDeletedChanger.extendRenewal(league.id, 3, rootAdmin.userId);

    expect(updated.plan).toBe(LeaguePlan.FREE);
  });
});
