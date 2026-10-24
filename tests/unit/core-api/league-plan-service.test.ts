import { LeaguePlan } from '@poolmaster/shared/domain';
import { LeaguePlanService } from '../../../packages/core-api/src/modules/plans/league-plan-service';
import { LeagueNotFoundError, LeagueOperationError } from '../../../packages/core-api/src/modules/leagues/service';
import { inMemoryLeagueWorld } from '../../support/in-memory-league-world';

// Choosing a plan (#945): any commissioner or root admin moves a league to any plan, at once, logged.

function setup() {
  const world = inMemoryLeagueWorld();
  const service = new LeaguePlanService({ leagues: world.leagues });
  const commissioner = world.addUser();
  return { world, service, commissioner };
}

describe('LeaguePlanService', () => {
  it('moves the league to the chosen plan at once and logs who changed it from which plan', async () => {
    const { world, service, commissioner } = setup();
    const league = world.addLeague();

    const updated = await service.changePlan(league.id, LeaguePlan.FREE, commissioner.id);

    expect(updated.plan).toBe(LeaguePlan.FREE);
    expect((await world.leagues.findById(league.id))?.plan).toBe(LeaguePlan.FREE);
    expect(world.planChanges).toEqual([
      { leagueId: league.id, fromPlan: LeaguePlan.PLATINUM, toPlan: LeaguePlan.FREE, changedById: commissioner.id },
    ]);
  });

  it('lets a league move back up to a higher plan, logging each change in order', async () => {
    const { world, service, commissioner } = setup();
    const league = world.addLeague();

    await service.changePlan(league.id, LeaguePlan.FREE, commissioner.id);
    const updated = await service.changePlan(league.id, LeaguePlan.PREMIUM, commissioner.id);

    expect(updated.plan).toBe(LeaguePlan.PREMIUM);
    expect(world.planChanges.map((change) => [change.fromPlan, change.toPlan])).toEqual([
      [LeaguePlan.PLATINUM, LeaguePlan.FREE],
      [LeaguePlan.FREE, LeaguePlan.PREMIUM],
    ]);
  });

  it('changes and logs nothing when the league is already on the chosen plan', async () => {
    const { world, service, commissioner } = setup();
    const league = world.addLeague({ plan: LeaguePlan.PRO });

    const updated = await service.changePlan(league.id, LeaguePlan.PRO, commissioner.id);

    expect(updated.plan).toBe(LeaguePlan.PRO);
    expect(world.planChanges).toEqual([]);
  });

  it('refuses with 409 LEAGUE_PLAN_CHANGED, changing and logging nothing, when someone else changed the plan during the change', async () => {
    const { world, commissioner } = setup();
    const league = world.addLeague();
    // Someone else moves the league to Pro between this change's read and its write.
    const service = new LeaguePlanService({
      leagues: {
        findById: world.leagues.findById,
        changePlan: async (leagueId, change) => {
          await world.leagues.changePlan(leagueId, { fromPlan: LeaguePlan.PLATINUM, toPlan: LeaguePlan.PRO, changedById: 'other' });
          return world.leagues.changePlan(leagueId, change);
        },
      },
    });

    const attempt = service.changePlan(league.id, LeaguePlan.FREE, commissioner.id);

    await expect(attempt).rejects.toMatchObject({ code: 'LEAGUE_PLAN_CHANGED', statusCode: 409 });
    expect((await world.leagues.findById(league.id))?.plan).toBe(LeaguePlan.PRO);
    expect(world.planChanges.map((change) => change.toPlan)).toEqual([LeaguePlan.PRO]);
  });

  it('rejects a plan change for a league that does not exist', async () => {
    const { service, commissioner } = setup();

    await expect(service.changePlan('missing-league', LeaguePlan.FREE, commissioner.id))
      .rejects.toBeInstanceOf(LeagueNotFoundError);
  });

  it('rejects a plan change for an inactive league, which is read-only, and logs nothing', async () => {
    const { world, service, commissioner } = setup();
    const league = world.addLeague({ isActive: false });

    const attempt = service.changePlan(league.id, LeaguePlan.FREE, commissioner.id);

    await expect(attempt).rejects.toBeInstanceOf(LeagueOperationError);
    await expect(attempt).rejects.toMatchObject({ code: 'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE' });
    expect(world.planChanges).toEqual([]);
    expect((await world.leagues.findById(league.id))?.plan).toBe(LeaguePlan.PLATINUM);
  });
});
