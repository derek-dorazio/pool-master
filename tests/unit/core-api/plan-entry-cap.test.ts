/**
 * The plan's entries per contest (#947), through ContestService against the in-memory world:
 * every entry counts, drafts included, checked live against the plan the league is on now, and a
 * lower plan never removes or freezes the entries a contest already has. A contest expansion
 * (#980) raises one contest's cap above its plan's, never below it.
 */
import { ContestService } from '../../../packages/core-api/src/modules/contests/service';
import { ContestStatus, LeaguePlan, PlanCap } from '@poolmaster/shared/domain';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';

function setup(plan: LeaguePlan) {
  const world = new InMemoryContestWorld();
  // Free holds two entries per contest here, so three squads are enough to fill one.
  const defaults = world.planConfig;
  world.planConfig = {
    ...defaults,
    caps: { ...defaults.caps, [PlanCap.ENTRIES_PER_CONTEST]: { ...defaults.caps[PlanCap.ENTRIES_PER_CONTEST], FREE: 2 } },
  };
  const league = world.addLeague({ plan });
  const contest = world.addContest(league.id, { status: ContestStatus.OPEN });
  world.addConfiguration(contest.id);
  const owners = ['Ava', 'Ben', 'Cal'].map((firstName) => {
    const user = world.addUser({ firstName });
    world.addMember(league.id, user.id);
    const squad = world.addSquad(league.id, `${firstName}'s squad`);
    world.addSquadMember(squad.id, user.id);
    return user;
  });
  const service = new ContestService(world.contestServiceDeps());
  return { world, league, contest, owners, service };
}

describe('ContestService entries per contest', () => {
  it('refuses the entry past the plan\'s entries per contest with CONTEST_FULL, counting draft entries, and stores nothing', async () => {
    const { world, contest, owners: [ava, ben, cal], service } = setup(LeaguePlan.FREE);
    await service.createEntry(contest.id, ava.id);
    await service.createEntry(contest.id, ben.id);

    await expect(service.createEntry(contest.id, cal.id)).rejects.toMatchObject({ code: 'CONTEST_FULL' });
    expect([...world.entries.values()].filter((entry) => entry.contestId === contest.id)).toHaveLength(2);
  });

  it('lets a Platinum league\'s contest take entries past every other plan\'s cap', async () => {
    const { world, contest, owners, service } = setup(LeaguePlan.PLATINUM);

    for (const owner of owners) await service.createEntry(contest.id, owner.id);

    expect([...world.entries.values()].filter((entry) => entry.contestId === contest.id)).toHaveLength(3);
  });

  it('checks the plan the league is on now, so a contest full on Free takes the entry once the league moves up', async () => {
    const { world, league, contest, owners: [ava, ben, cal], service } = setup(LeaguePlan.FREE);
    await service.createEntry(contest.id, ava.id);
    await service.createEntry(contest.id, ben.id);

    world.leagues.set(league.id, { ...league, plan: LeaguePlan.PRO });
    await service.createEntry(contest.id, cal.id);

    expect([...world.entries.values()].filter((entry) => entry.contestId === contest.id)).toHaveLength(3);
  });

  it('keeps every entry of a contest over its cap after a move down, and lets their owners still rename them', async () => {
    const { world, league, contest, owners: [ava, ben, cal], service } = setup(LeaguePlan.PLATINUM);
    for (const owner of [ava, ben, cal]) await service.createEntry(contest.id, owner.id);

    world.leagues.set(league.id, { ...league, plan: LeaguePlan.FREE });
    const avaEntry = [...world.entries.values()].find((entry) => entry.contestId === contest.id && entry.name.startsWith('Ava'));
    const renamed = await service.updateEntry(contest.id, avaEntry?.id ?? '', ava.id, { name: 'Ava keeps going' });

    expect(renamed.name).toBe('Ava keeps going');
    expect([...world.entries.values()].filter((entry) => entry.contestId === contest.id)).toHaveLength(3);
  });

  it('lets a contest expanded past its plan\'s cap take entries up to the expansion, then refuses the next with CONTEST_FULL (#980)', async () => {
    const { world, contest, owners: [ava, ben, cal], service } = setup(LeaguePlan.FREE);
    const dan = world.addUser({ firstName: 'Dan' });
    world.addMember(contest.leagueId, dan.id);
    world.addSquadMember(world.addSquad(contest.leagueId, 'Dan\'s squad').id, dan.id);
    world.addContestExpansion(contest.id, 3);

    for (const owner of [ava, ben, cal]) await service.createEntry(contest.id, owner.id);

    await expect(service.createEntry(contest.id, dan.id)).rejects.toMatchObject({ code: 'CONTEST_FULL' });
    expect([...world.entries.values()].filter((entry) => entry.contestId === contest.id)).toHaveLength(3);
  });

  it('uses the contest\'s highest expansion after a step up, so a step from 3 to 4 entries lets the fourth in (#980)', async () => {
    const { world, contest, owners, service } = setup(LeaguePlan.FREE);
    const dan = world.addUser({ firstName: 'Dan' });
    world.addMember(contest.leagueId, dan.id);
    world.addSquadMember(world.addSquad(contest.leagueId, 'Dan\'s squad').id, dan.id);
    world.addContestExpansion(contest.id, 3);
    world.addContestExpansion(contest.id, 4);

    for (const owner of [...owners, dan]) await service.createEntry(contest.id, owner.id);

    expect([...world.entries.values()].filter((entry) => entry.contestId === contest.id)).toHaveLength(4);
  });

  it('keeps the plan\'s cap when it is above the contest\'s expansion, so a league moving up never loses room (#980)', async () => {
    const { world, league, contest, owners, service } = setup(LeaguePlan.FREE);
    world.addContestExpansion(contest.id, 1);

    world.leagues.set(league.id, { ...league, plan: LeaguePlan.PLATINUM });
    for (const owner of owners) await service.createEntry(contest.id, owner.id);

    expect([...world.entries.values()].filter((entry) => entry.contestId === contest.id)).toHaveLength(3);
  });

  it('shows each contest\'s cap for a contest read: its plan\'s, or its expansion when higher (#987)', async () => {
    const { world, league, contest, service } = setup(LeaguePlan.FREE);
    const expanded = world.addContest(league.id, { status: ContestStatus.OPEN });
    world.addContestExpansion(expanded.id, 50);

    const caps = await service.findEntryCaps([contest, expanded]);

    expect([caps.get(contest.id), caps.get(expanded.id)]).toEqual([2, 50]);
  });
});
