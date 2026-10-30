import { expect } from '@jest/globals';
import {
  ContestStatus,
  CupPointsScale,
  LeagueIconKey,
  LeagueMembershipStatus,
  LeagueRole,
  PlanFeature,
  SquadMembershipStatus,
} from '@poolmaster/shared/domain';
import {
  LeagueCodeConflictError,
  LeagueNotFoundError,
  LeagueOperationError,
  LeagueService,
} from '../../../packages/core-api/src/modules/leagues/service';
import { inMemoryLeagueWorld, type InMemoryLeagueWorld } from '../../support/in-memory-league-world';
import { asPrismaClient } from '../../support/prisma-double';
import { expectDefined } from '../../support/expect-defined';

/** Every plan feature: a league on Platinum. */
const ALL_FEATURES: ReadonlySet<PlanFeature> = new Set(Object.values(PlanFeature));

/**
 * LeagueService use cases against the in-memory league world: what each operation leaves
 * stored, and which typed error each refusal raises.
 */

function serviceFor(world: InMemoryLeagueWorld, extra: { prisma?: ReturnType<typeof asPrismaClient>; withSquads?: boolean } = {}) {
  const withSquads = extra.withSquads ?? true;
  return new LeagueService({
    leagues: world.leagues,
    memberships: world.memberships,
    users: world.users,
    ...(withSquads ? { squads: world.squads, squadMemberships: world.squadMemberships } : {}),
    ...(extra.prisma ? { prisma: extra.prisma } : {}),
  });
}

describe('LeagueService — creating a league', () => {
  it('makes the creator the only ACTIVE COMMISSIONER and gives them a team they own', async () => {
    const world = inMemoryLeagueWorld();
    const creator = world.addUser({ firstName: 'Casey', lastName: 'Commish' });

    const { league, membership } = await serviceFor(world).createLeague({
      createdBy: creator.id,
      name: 'Office Pool',
      leagueCode: 'OFFICE',
    });

    expect(league).toMatchObject({ leagueCode: 'OFFICE', isActive: true, iconKey: LeagueIconKey.TROPHY });
    expect(membership).toMatchObject({ role: LeagueRole.COMMISSIONER, status: LeagueMembershipStatus.ACTIVE });
    const squadMembership = world.squadMembershipOf(league.id, creator.id);
    expect(squadMembership?.status).toBe(SquadMembershipStatus.ACTIVE);
    expect(world.tables.squads.get(expectDefined(squadMembership).squadId)?.isActive).toBe(true);
  });

  it('refuses a league code already in use with LeagueCodeConflictError (409) and creates nothing', async () => {
    const world = inMemoryLeagueWorld();
    world.addLeague({ leagueCode: 'TAKEN' });
    const creator = world.addUser();

    const attempt = serviceFor(world).createLeague({ createdBy: creator.id, name: 'Dup', leagueCode: 'TAKEN' });

    await expect(attempt).rejects.toBeInstanceOf(LeagueCodeConflictError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 409, code: 'LEAGUE_CODE_CONFLICT' });
    expect(world.tables.leagues.where(() => true)).toHaveLength(1);
    expect(world.tables.memberships.where(() => true)).toHaveLength(0);
  });

  it('refuses every email role address as a league code, since league email comes from <code>@, and creates nothing', async () => {
    const world = inMemoryLeagueWorld();
    const creator = world.addUser();
    const service = serviceFor(world);

    for (const leagueCode of ['NOREPLY', 'POSTMASTER', 'ABUSE', 'ADMIN', 'SUPPORT', 'SECURITY', 'BOUNCE', 'HOSTMASTER', 'WEBMASTER']) {
      await expect(service.createLeague({ createdBy: creator.id, name: 'Role', leagueCode }))
        .rejects.toMatchObject({ statusCode: 400, code: 'LEAGUE_CODE_RESERVED' });
    }
    expect(world.tables.leagues.where(() => true)).toHaveLength(0);
    expect(world.tables.memberships.where(() => true)).toHaveLength(0);
  });

  it('still creates the commissioner membership when squad repositories are not wired, without a team', async () => {
    const world = inMemoryLeagueWorld();
    const creator = world.addUser();

    const { league } = await serviceFor(world, { withSquads: false }).createLeague({
      createdBy: creator.id,
      name: 'No Squads',
      leagueCode: 'NOSQUAD',
    });

    expect(world.membershipOf(league.id, creator.id)?.role).toBe(LeagueRole.COMMISSIONER);
    expect(world.squadMembershipOf(league.id, creator.id)).toBeNull();
  });

  it('stores a whitespace-only description as no description rather than as blank text', async () => {
    const world = inMemoryLeagueWorld();
    const creator = world.addUser();

    const { league } = await serviceFor(world).createLeague({
      createdBy: creator.id,
      name: 'Blank',
      leagueCode: 'BLANK',
      description: '   ',
    });

    expect(world.tables.leagues.get(league.id)?.description ?? null).toBeNull();
  });
});

describe('LeagueService — finding leagues', () => {
  it('finds a league by code case-insensitively, because codes are stored upper-case', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ leagueCode: 'MIXED' });

    await expect(serviceFor(world).findByCode('mixed')).resolves.toMatchObject({ id: league.id });
  });

  it('finds a league by code with the viewer\'s own membership of any status, null for a non-member, and null for an unknown code or id', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ leagueCode: 'ROSTER' });
    const active = world.addUser();
    const removed = world.addUser();
    const outsider = world.addUser();
    world.addMember({ league, user: active, role: LeagueRole.COMMISSIONER });
    const { membership } = world.addMember({ league, user: removed });
    world.tables.memberships.patch(membership.id, { status: LeagueMembershipStatus.INACTIVE });
    const service = serviceFor(world);

    const asActive = await service.getLeagueByCodeForViewer('roster', active.id);
    expect(asActive?.league.id).toBe(league.id);
    expect(asActive?.membership).toMatchObject({ userId: active.id, status: LeagueMembershipStatus.ACTIVE });
    const asRemoved = await service.getLeagueByCodeForViewer('ROSTER', removed.id);
    expect(asRemoved?.membership).toMatchObject({ userId: removed.id, status: LeagueMembershipStatus.INACTIVE });
    const asOutsider = await service.getLeagueForViewer(league.id, outsider.id);
    expect(asOutsider).toEqual({ league: expect.objectContaining({ id: league.id }), membership: null });
    await expect(service.getLeagueByCodeForViewer('MISSING', active.id)).resolves.toBeNull();
    await expect(service.getLeagueForViewer('missing', active.id)).resolves.toBeNull();
  });
});

describe('LeagueService — the "mine" league list', () => {
  it('omits a league the viewer was removed from, so "mine" never returns a league without the viewer\'s membership', async () => {
    const world = inMemoryLeagueWorld();
    const viewer = world.addUser();
    const kept = world.addLeague({ name: 'Kept' });
    const left = world.addLeague({ name: 'Left' });
    world.addMember({ league: kept, user: viewer });
    const { membership } = world.addMember({ league: left, user: viewer });
    world.tables.memberships.patch(membership.id, { status: LeagueMembershipStatus.INACTIVE });

    const rows = await serviceFor(world).listLeagues({ scope: 'mine', userId: viewer.id });

    expect(rows.map((row) => row.league.name)).toEqual(['Kept']);
    expect(rows.every((row) => row.membership !== null)).toBe(true);
  });

  it('narrows "mine" by a case-insensitive name search and by isActive', async () => {
    const world = inMemoryLeagueWorld();
    const viewer = world.addUser();
    for (const [name, isActive] of [['Golf Masters', true], ['Golf Archive', false], ['Hoops', true]] as const) {
      world.addMember({ league: world.addLeague({ name, isActive }), user: viewer });
    }
    const service = serviceFor(world);

    const golf = await service.listLeagues({ scope: 'mine', userId: viewer.id, filters: { search: '  GOLF ' } });
    const activeGolf = await service.listLeagues({
      scope: 'mine',
      userId: viewer.id,
      filters: { search: 'golf', isActive: true },
    });

    expect(golf.map((row) => row.league.name).sort()).toEqual(['Golf Archive', 'Golf Masters']);
    expect(activeGolf.map((row) => row.league.name)).toEqual(['Golf Masters']);
  });

  it('reports real member and active-contest counts, counting OPEN through ACTIVE contests but not DRAFT', async () => {
    const world = inMemoryLeagueWorld();
    const viewer = world.addUser();
    const league = world.addLeague();
    world.addMember({ league, user: viewer, role: LeagueRole.COMMISSIONER });
    world.addMember({ league, user: world.addUser() });
    const groupBy = jest.fn().mockResolvedValue([{ leagueId: league.id, _count: { _all: 3 } }]);

    const [row] = await serviceFor(world, { prisma: asPrismaClient({ contest: { groupBy } }) })
      .listLeagues({ scope: 'mine', userId: viewer.id });

    expect(row).toMatchObject({ memberCount: 2, activeContestCount: 3 });
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: [ContestStatus.OPEN, ContestStatus.ACTIVE] },
      }),
    }));
  });

  it('returns every league matching the search under scope "all", with the viewer\'s membership only where they hold one', async () => {
    const world = inMemoryLeagueWorld();
    const admin = world.addUser({ isRootAdmin: true });
    const joined = world.addLeague({ name: 'Joined' });
    world.addLeague({ name: 'Stranger' });
    world.addMember({ league: joined, user: admin });

    const rows = await serviceFor(world).listLeagues({ scope: 'all', userId: admin.id, filters: { search: 'e' } });

    const byName = new Map(rows.map((row) => [row.league.name, row]));
    expect(byName.get('Joined')?.membership?.userId).toBe(admin.id);
    expect(byName.get('Stranger')?.membership).toBeNull();
    expect(byName.get('Stranger')?.memberCount).toBe(0);
  });

  it('returns no rows and no counts for a viewer with no leagues', async () => {
    const world = inMemoryLeagueWorld();
    await expect(serviceFor(world).listLeagues({ scope: 'mine', userId: world.addUser().id })).resolves.toEqual([]);
  });
});

describe('LeagueService — lifecycle', () => {
  it('inactivates an active league and refuses a second inactivation with LEAGUE_ALREADY_INACTIVE', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague();
    const service = serviceFor(world);

    await expect(service.inactivateLeague(league.id)).resolves.toMatchObject({ isActive: false });
    await expect(service.inactivateLeague(league.id)).rejects.toMatchObject({ code: 'LEAGUE_ALREADY_INACTIVE' });
  });

  it('reactivates an inactive league and refuses activating an active one with LEAGUE_ALREADY_ACTIVE', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ isActive: false });
    const service = serviceFor(world);

    await expect(service.activateLeague(league.id)).resolves.toMatchObject({ isActive: true });
    await expect(service.activateLeague(league.id)).rejects.toMatchObject({ code: 'LEAGUE_ALREADY_ACTIVE' });
  });

  it.each([
    ['inactivateLeague', (service: LeagueService) => service.inactivateLeague('missing')],
    ['activateLeague', (service: LeagueService) => service.activateLeague('missing')],
    ['updateLeagueDetails', (service: LeagueService) => service.updateLeagueDetails('missing', { name: 'x', iconKey: LeagueIconKey.TROPHY })],
    ['deleteInactiveLeague', (service: LeagueService) => service.deleteInactiveLeague('missing', 'X')],
    ['updateCupSettings', (service: LeagueService) => service.updateCupSettings('missing', { cupName: 'Cup', cupPointsScale: CupPointsScale.STANDARD, cupCustomPoints: [], hallOfLameVisible: true }, ALL_FEATURES)],
  ])('%s on an unknown league throws LeagueNotFoundError naming the league', async (_name, act) => {
    const attempt = act(serviceFor(inMemoryLeagueWorld()));
    await expect(attempt).rejects.toBeInstanceOf(LeagueNotFoundError);
    await expect(attempt).rejects.toThrow('League not found: missing');
  });
});

describe('LeagueService — editing details and icon', () => {
  it('replaces the name and trims the description of an active league', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ name: 'Old', description: 'Old text' });

    await serviceFor(world).updateLeagueDetails(league.id, { name: 'New', description: '  New text  ', iconKey: LeagueIconKey.TROPHY });

    expect(world.tables.leagues.get(league.id)).toMatchObject({ name: 'New', description: 'New text' });
  });

  it('clears the description when the commissioner saves it empty, instead of keeping the old text', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ description: 'Stale rules link' });

    await serviceFor(world).updateLeagueDetails(league.id, { name: league.name, description: '   ', iconKey: league.iconKey });

    expect(world.tables.leagues.get(league.id)?.description ?? null).toBeNull();
  });

  it('clears the description when the update omits it, as the PUT details contract documents', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ description: 'Old text' });

    await serviceFor(world).updateLeagueDetails(league.id, { name: 'Renamed', iconKey: league.iconKey });

    expect(world.tables.leagues.get(league.id)).toMatchObject({ name: 'Renamed', iconKey: league.iconKey });
    expect(world.tables.leagues.get(league.id)?.description ?? null).toBeNull();
  });

  it('refuses edits on an inactive league with LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE, leaving name and icon unchanged', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ name: 'Frozen', isActive: false, iconKey: LeagueIconKey.TROPHY });
    const service = serviceFor(world);

    await expect(service.updateLeagueDetails(league.id, { name: 'Thawed', iconKey: LeagueIconKey.SOCCER_BALL }))
      .rejects.toMatchObject({ code: 'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE', statusCode: 400 });
    expect(world.tables.leagues.get(league.id)).toMatchObject({ name: 'Frozen', iconKey: LeagueIconKey.TROPHY });
  });

  it('stores a new icon together with the name and description in the same save', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ name: 'Old', iconKey: LeagueIconKey.TROPHY });

    await serviceFor(world).updateLeagueDetails(league.id, {
      name: 'New',
      description: 'New text',
      iconKey: LeagueIconKey.SOCCER_BALL,
    });

    expect(world.tables.leagues.get(league.id)).toMatchObject({
      name: 'New',
      description: 'New text',
      iconKey: LeagueIconKey.SOCCER_BALL,
    });
  });
});

describe('LeagueService — championship settings', () => {
  it('stores a trimmed championship name, a custom points table and a hidden Hall of Lame on an active league', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague();

    await serviceFor(world).updateCupSettings(league.id, {
      cupName: '  Big Dawgs Cup  ',
      cupPointsScale: CupPointsScale.CUSTOM,
      cupCustomPoints: [10, 6, 3],
      hallOfLameVisible: false,
    }, ALL_FEATURES);

    expect(world.tables.leagues.get(league.id)).toMatchObject({
      cupName: 'Big Dawgs Cup',
      cupPointsScale: CupPointsScale.CUSTOM,
      cupCustomPoints: [10, 6, 3],
      hallOfLameVisible: false,
    });
  });

  it('switching back to a built-in table clears the custom points, so no stale table lingers', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ cupPointsScale: CupPointsScale.CUSTOM, cupCustomPoints: [5, 2] });

    await serviceFor(world).updateCupSettings(league.id, {
      cupName: league.cupName,
      cupPointsScale: CupPointsScale.TOP_TEN,
      cupCustomPoints: [],
      hallOfLameVisible: true,
    }, ALL_FEATURES);

    expect(world.tables.leagues.get(league.id)).toMatchObject({ cupPointsScale: CupPointsScale.TOP_TEN, cupCustomPoints: [] });
  });

  it.each([
    ['a custom table with no points', CupPointsScale.CUSTOM, []],
    ['a built-in table sent with its own points', CupPointsScale.STANDARD, [10, 5]],
  ])('refuses %s with CUP_CUSTOM_POINTS_INVALID and leaves the settings unchanged', async (_case, cupPointsScale, cupCustomPoints) => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ cupName: 'Old Cup' });

    await expect(serviceFor(world).updateCupSettings(league.id, { cupName: 'New Cup', cupPointsScale, cupCustomPoints, hallOfLameVisible: true }, ALL_FEATURES))
      .rejects.toMatchObject({ code: 'CUP_CUSTOM_POINTS_INVALID', statusCode: 400 });
    expect(world.tables.leagues.get(league.id)).toMatchObject({ cupName: 'Old Cup', cupPointsScale: CupPointsScale.STANDARD });
  });

  it('refuses a Hall of Lame switch with PLAN_FEATURE_NOT_INCLUDED naming RECORD_BOOK when the plan lacks the record book, leaving the settings unchanged', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ cupName: 'Old Cup', hallOfLameVisible: true });
    const withoutRecordBook = new Set([PlanFeature.CUP_SETTINGS]);

    await expect(serviceFor(world).updateCupSettings(league.id, {
      cupName: 'New Cup',
      cupPointsScale: CupPointsScale.STANDARD,
      cupCustomPoints: [],
      hallOfLameVisible: false,
    }, withoutRecordBook)).rejects.toMatchObject({ code: 'PLAN_FEATURE_NOT_INCLUDED', feature: PlanFeature.RECORD_BOOK });
    expect(world.tables.leagues.get(league.id)).toMatchObject({ cupName: 'Old Cup', hallOfLameVisible: true });
  });

  it('saves the other championship settings without the record book while the Hall of Lame stays as it is', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ hallOfLameVisible: true });

    await serviceFor(world).updateCupSettings(league.id, {
      cupName: 'New Cup',
      cupPointsScale: CupPointsScale.TOP_TEN,
      cupCustomPoints: [],
      hallOfLameVisible: true,
    }, new Set([PlanFeature.CUP_SETTINGS]));

    expect(world.tables.leagues.get(league.id)).toMatchObject({ cupName: 'New Cup', cupPointsScale: CupPointsScale.TOP_TEN });
  });

  it('refuses championship settings on an inactive league with LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ isActive: false, cupName: 'Frozen Cup' });

    await expect(serviceFor(world).updateCupSettings(league.id, {
      cupName: 'Thawed Cup',
      cupPointsScale: CupPointsScale.STANDARD,
      cupCustomPoints: [],
      hallOfLameVisible: true,
    }, ALL_FEATURES)).rejects.toMatchObject({ code: 'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE', statusCode: 400 });
    expect(world.tables.leagues.get(league.id)).toMatchObject({ cupName: 'Frozen Cup' });
  });
});

describe('LeagueService — permanent delete', () => {
  it('refuses to delete an active league with LEAGUE_DELETE_REQUIRES_INACTIVE', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ leagueCode: 'LIVE' });

    await expect(serviceFor(world).deleteInactiveLeague(league.id, 'LIVE'))
      .rejects.toMatchObject({ code: 'LEAGUE_DELETE_REQUIRES_INACTIVE' });
  });

  it('refuses a confirmation that differs from the league code, even only by case', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ leagueCode: 'GONE', isActive: false });

    await expect(serviceFor(world).deleteInactiveLeague(league.id, 'gone'))
      .rejects.toMatchObject({ code: 'LEAGUE_DELETE_CONFIRMATION_MISMATCH' });
  });

  it('reports LEAGUE_DELETE_UNAVAILABLE as a 500 when the service has no database handle to delete with', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague({ leagueCode: 'GONE', isActive: false });

    const attempt = serviceFor(world).deleteInactiveLeague(league.id, 'GONE');

    await expect(attempt).rejects.toBeInstanceOf(LeagueOperationError);
    await expect(attempt).rejects.toMatchObject({ code: 'LEAGUE_DELETE_UNAVAILABLE', statusCode: 500 });
  });
});
