/**
 * The league route handlers (#1482), called with a stand-in league service, plan service and
 * repositories: who may list which leagues, the league context a read answers with and when it
 * refuses, the status each refusal is sent with, and that an error the handler does not own
 * reaches the global error handler unchanged.
 */
import { expect } from '@jest/globals';
import type { SquadMembershipRepository, SquadRepository, UserRepository } from '@poolmaster/shared/db';
import { LeagueMembershipStatus, PlanFeature, SquadMembershipStatus } from '@poolmaster/shared/domain';
import type { LeaguePlanService } from '../../../packages/core-api/src/modules/plans/league-plan-service';
import { PlanFeatureNotIncludedError } from '../../../packages/core-api/src/modules/plans/plan-feature-error';
import { createLeagueHandlers } from '../../../packages/core-api/src/modules/leagues/handler';
import { LeagueNotFoundError, LeagueOperationError, type LeagueService } from '../../../packages/core-api/src/modules/leagues/service';
import { buildLeague, buildMembership, buildUser } from '../../factories';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';
import { platinumEntitlements } from '../../support/plan-entitlements';

const AT = new Date('2026-04-10T12:00:00.000Z');
const boom = new Error('database down');
const league = buildLeague({ id: 'league-1', leagueCode: 'OFFICE' });
const membership = buildMembership({ leagueId: 'league-1', userId: 'user-1', status: LeagueMembershipStatus.ACTIVE });
const counts = { memberCount: 4, activeContestCount: 2 };
const squadEdge = {
  id: 'sm-1', squadId: 'squad-1', leagueId: 'league-1', userId: 'user-1', status: SquadMembershipStatus.ACTIVE,
  joinedAt: AT, createdAt: AT, updatedAt: AT, squadName: 'The Squad',
};
const me = authUser('user-1');
const admin = authUser('admin', { isRootAdmin: true });

function leagueService(overrides: Record<string, unknown> = {}) {
  return {
    listLeagues: jest.fn((..._args: unknown[]) => Promise.resolve([
      { league, membership, ...counts },
      { league: buildLeague({ id: 'league-2' }), membership: null, ...counts },
    ])),
    createLeague: jest.fn((..._args: unknown[]) => Promise.resolve({ league, membership })),
    getLeagueForViewer: jest.fn((..._args: unknown[]) => Promise.resolve({ league, membership })),
    getLeagueByCodeForViewer: jest.fn((..._args: unknown[]) => Promise.resolve({ league, membership })),
    countActivityFor: jest.fn((..._args: unknown[]) => Promise.resolve(counts)),
    inactivateLeague: jest.fn((..._args: unknown[]) => Promise.resolve(league)),
    activateLeague: jest.fn((..._args: unknown[]) => Promise.resolve(league)),
    updateLeagueDetails: jest.fn((..._args: unknown[]) => Promise.resolve(league)),
    updateCupSettings: jest.fn((..._args: unknown[]) => Promise.resolve(league)),
    deleteInactiveLeague: jest.fn((..._args: unknown[]) => Promise.resolve()),
    ...overrides,
  };
}
function planService(overrides: Record<string, unknown> = {}) {
  return {
    changePlan: jest.fn((..._args: unknown[]) => Promise.resolve(league)),
    extendRenewal: jest.fn((..._args: unknown[]) => Promise.resolve(league)),
    extendRunningRenewals: jest.fn((..._args: unknown[]) => Promise.resolve({ extendedCount: 3, renewsAt: AT })),
    ...overrides,
  };
}
interface Repos { viewer?: boolean; squadEdge?: boolean }
function handlersOver(service = leagueService(), plans = planService(), repos: Repos = {}) {
  const { viewer = true, squadEdge: hasEdge = true } = repos;
  const users = { findById: (id: string) => Promise.resolve(viewer ? buildUser({ id }) : null) };
  const squads = { countActiveByLeague: () => Promise.resolve(5) };
  const squadMemberships = { findByLeagueAndUserWithSquadName: () => Promise.resolve(hasEdge ? squadEdge : null) };
  return createLeagueHandlers(
    service as unknown as LeagueService,
    squads as unknown as SquadRepository,
    squadMemberships as unknown as SquadMembershipRepository,
    users as unknown as UserRepository,
    platinumEntitlements(),
    plans as unknown as LeaguePlanService,
  );
}

describe('league list handler', () => {
  it('lists the caller\'s own leagues by default, with their memberships beside the leagues', async () => {
    const fake = leagueService();

    const reply = await callHandler(handlersOver(fake).listLeagues, stubRequest({ query: { search: 'off', isActive: true }, authUser: me, contextLogger: false }));

    expect(fake.listLeagues).toHaveBeenCalledWith({ scope: 'mine', userId: 'user-1', filters: { search: 'off', isActive: true } });
    expect(reply.body).toMatchObject({
      leagues: [{ id: 'league-1', memberCount: 4, activeContestCount: 2 }, { id: 'league-2' }],
      memberships: [{ leagueId: 'league-1', user: { id: 'user-1' } }],
    });
    expect((reply.body as { memberships: unknown[] }).memberships).toHaveLength(1);
  });

  it('passes no filters on for a list of the caller\'s leagues that names none', async () => {
    const fake = leagueService();

    await callHandler(handlersOver(fake).listLeagues, stubRequest({ query: {}, authUser: me }));

    expect(fake.listLeagues).toHaveBeenCalledWith({ scope: 'mine', userId: 'user-1', filters: {} });
  });

  it('lists every league for a root admin with a search term, and sends no memberships when the viewer is gone', async () => {
    const fake = leagueService();

    const reply = await callHandler(handlersOver(fake, planService(), { viewer: false }).listLeagues, stubRequest({ query: { scope: 'all', search: 'office' }, authUser: admin }));

    expect(fake.listLeagues).toHaveBeenCalledWith({ scope: 'all', userId: 'admin', filters: { search: 'office' } });
    expect(reply.body).toMatchObject({ memberships: [] });
  });

  it.each([
    ['no session with 401 AUTH_SESSION_REQUIRED', { query: {} }, 401, 'AUTH_SESSION_REQUIRED'],
    ['every league for a member with 403 LEAGUE_SCOPE_FORBIDDEN', { query: { scope: 'all', search: 'office' }, authUser: me }, 403, 'LEAGUE_SCOPE_FORBIDDEN'],
    ['every league with no search term with 400 SEARCH_TERM_REQUIRED', { query: { scope: 'all' }, authUser: admin }, 400, 'SEARCH_TERM_REQUIRED'],
  ] as const)('refuses a list of %s, reading nothing', async (_label, fields, status, code) => {
    const fake = leagueService();

    const reply = await callHandler(handlersOver(fake).listLeagues, stubRequest(fields));

    expect(reply).toMatchObject({ statusCode: status, body: { error: { code } } });
    expect(fake.listLeagues).not.toHaveBeenCalled();
  });
});

describe('league create handler', () => {
  it('creates a league with 201, the creator\'s membership and their default squad', async () => {
    const fake = leagueService();

    const reply = await callHandler(handlersOver(fake).createLeague, stubRequest({
      body: { name: 'Office', leagueCode: 'OFFICE', description: ' Pool ' }, authUser: me, contextLogger: false,
    }));

    expect(fake.createLeague).toHaveBeenCalledWith({ createdBy: 'user-1', name: 'Office', leagueCode: 'OFFICE', description: ' Pool ' });
    expect(reply).toMatchObject({
      statusCode: 201,
      body: {
        league: { id: 'league-1', memberCount: 1, activeContestCount: 0 },
        membership: { leagueId: 'league-1' },
        squadMembership: { squadId: 'squad-1', user: { id: 'user-1' } },
        squadName: 'The Squad',
        activeTeamCount: 5,
      },
    });
  });

  it('answers a create whose creator cannot be read back with no membership and no squad edge', async () => {
    const reply = await callHandler(handlersOver(leagueService(), planService(), { viewer: false }).createLeague, stubRequest({
      body: { name: 'Office', leagueCode: 'OFFICE' }, authUser: me,
    }));

    expect(reply.body).toMatchObject({ membership: null, squadMembership: null, squadName: null });
  });

  it('refuses a create with no session with 401 AUTH_SESSION_REQUIRED', async () => {
    const fake = leagueService();

    const reply = await callHandler(handlersOver(fake).createLeague, stubRequest({ body: { name: 'Office', leagueCode: 'OFFICE' } }));

    expect(reply).toMatchObject({ statusCode: 401, body: { error: { code: 'AUTH_SESSION_REQUIRED' } } });
    expect(fake.createLeague).not.toHaveBeenCalled();
  });
});

describe.each([
  ['getLeague', 'getLeagueForViewer', { id: 'league-1' }],
  ['getLeagueByCode', 'getLeagueByCodeForViewer', { leagueCode: 'OFFICE' }],
] as const)('league context handler %s', (handler, method, params) => {
  it('answers an active member with the league, their membership, their squad and the counts', async () => {
    const reply = await callHandler(handlersOver()[handler], stubRequest({ params, authUser: me, contextLogger: false }));

    expect(reply).toMatchObject({
      statusCode: 200,
      body: {
        league: { id: 'league-1', memberCount: 4 },
        membership: { leagueId: 'league-1', user: { id: 'user-1' } },
        squadMembership: { squadId: 'squad-1' },
        squadName: 'The Squad',
        activeTeamCount: 5,
      },
    });
  });

  it('answers a member with no squad with no squad edge', async () => {
    const reply = await callHandler(handlersOver(leagueService(), planService(), { squadEdge: false })[handler], stubRequest({ params, authUser: me }));

    expect(reply.body).toMatchObject({ membership: { leagueId: 'league-1' }, squadMembership: null, squadName: null });
  });

  it('lets a root admin read a league they left or never joined, with no membership edge', async () => {
    const inactive = buildMembership({ leagueId: 'league-1', userId: 'admin', status: LeagueMembershipStatus.INACTIVE });
    const left = handlersOver(leagueService({ [method]: () => Promise.resolve({ league, membership: inactive }) }));
    const never = handlersOver(leagueService({ [method]: () => Promise.resolve({ league, membership: null }) }));

    for (const handlers of [left, never]) {
      expect(await callHandler(handlers[handler], stubRequest({ params, authUser: admin }))).toMatchObject({ statusCode: 200, body: { membership: null } });
    }
  });

  it.each([
    ['no session with 401 AUTH_SESSION_REQUIRED', undefined, { league, membership }, 401, 'AUTH_SESSION_REQUIRED'],
    ['a missing league with 404 LEAGUE_NOT_FOUND', me, null, 404, 'LEAGUE_NOT_FOUND'],
    ['a non-member with 403 LEAGUE_MEMBERSHIP_REQUIRED', me, { league, membership: null }, 403, 'LEAGUE_MEMBERSHIP_REQUIRED'],
    ['an inactive member with 403 LEAGUE_MEMBERSHIP_INACTIVE', me, { league, membership: buildMembership({ status: LeagueMembershipStatus.INACTIVE }) }, 403, 'LEAGUE_MEMBERSHIP_INACTIVE'],
  ])('refuses %s', async (_label, user, found, status, code) => {
    const handlers = handlersOver(leagueService({ [method]: () => Promise.resolve(found) }));

    const reply = await callHandler(handlers[handler], stubRequest({ params, authUser: user }));

    expect(reply).toMatchObject({ statusCode: status, body: { error: { code } } });
  });
});

const writes = {
  inactivateLeague: { method: 'inactivateLeague', request: () => stubRequest({ params: { id: 'league-1' }, authUser: admin }) },
  activateLeague: { method: 'activateLeague', request: () => stubRequest({ params: { id: 'league-1' }, authUser: admin }) },
  updateLeagueDetails: { method: 'updateLeagueDetails', request: () => stubRequest({ params: { id: 'league-1' }, body: { description: 'New' }, authUser: me }) },
  updateLeagueCupSettings: { method: 'updateCupSettings', request: () => stubRequest({ params: { id: 'league-1' }, body: { cupPointsScale: 'STANDARD' }, authUser: me }) },
  deleteLeague: { method: 'deleteInactiveLeague', request: () => stubRequest({ params: { id: 'league-1' }, body: { leagueCode: 'OFFICE' }, authUser: admin }) },
} as const;
type Write = keyof typeof writes;
const writeNames = Object.keys(writes) as Write[];

describe('league write handlers', () => {
  it.each(writeNames)('%s answers with the changed league and its counts read back', async (handler) => {
    const fake = leagueService();
    const { request } = writes[handler];

    const reply = await callHandler(handlersOver(fake)[handler], request());

    expect(reply.statusCode).toBe(200);
    expect(reply.body).toEqual(handler === 'deleteLeague' ? { success: true } : { league: expect.objectContaining({ id: 'league-1', memberCount: 4 }) as unknown });
  });

  it('passes the league, the details and the confirming code on to the service', async () => {
    const fake = leagueService();
    const handlers = handlersOver(fake);

    await callHandler(handlers.updateLeagueDetails, stubRequest({ params: { id: 'league-1' }, body: { name: 'Renamed' }, contextLogger: false }));
    await callHandler(handlers.updateLeagueCupSettings, stubRequest({ params: { id: 'league-1' }, body: { cupPointsScale: 'STANDARD' }, contextLogger: false }));
    for (const handler of ['inactivateLeague', 'activateLeague', 'deleteLeague'] as const) {
      await callHandler(handlers[handler], stubRequest({ params: { id: 'league-1' }, body: { leagueCode: 'OFFICE' }, contextLogger: false }));
    }

    expect(fake.updateLeagueDetails).toHaveBeenCalledWith('league-1', { name: 'Renamed' });
    expect(fake.updateCupSettings).toHaveBeenCalledWith('league-1', { cupPointsScale: 'STANDARD' }, expect.any(Set));
    expect(fake.deleteInactiveLeague).toHaveBeenCalledWith('league-1', 'OFFICE');
  });

  it.each(writeNames)('%s answers a missing league with 404 LEAGUE_NOT_FOUND', async (handler) => {
    const { method, request } = writes[handler];
    const handlers = handlersOver(leagueService({ [method]: () => Promise.reject(new LeagueNotFoundError('league-1')) }));

    expect(await callHandler(handlers[handler], request())).toMatchObject({ statusCode: 404, body: { error: { code: 'LEAGUE_NOT_FOUND' } } });
  });

  it.each(writeNames)('%s answers a refused change with the error\'s own status and code', async (handler) => {
    const { method, request } = writes[handler];
    const handlers = handlersOver(leagueService({ [method]: () => Promise.reject(new LeagueOperationError('Still active', 'LEAGUE_OPERATION_INVALID', 409)) }));

    expect(await callHandler(handlers[handler], request())).toMatchObject({ statusCode: 409, body: { error: { code: 'LEAGUE_OPERATION_INVALID' } } });
  });

  it.each(writeNames)('%s passes an unexpected failure on to the global error handler', async (handler) => {
    const { method, request } = writes[handler];
    const handlers = handlersOver(leagueService({ [method]: () => Promise.reject(boom) }));

    await expect(callHandler(handlers[handler], request())).rejects.toBe(boom);
  });

  it('refuses cup settings the league\'s plan does not include with 403 PLAN_FEATURE_NOT_INCLUDED', async () => {
    const handlers = handlersOver(leagueService({ updateCupSettings: () => Promise.reject(new PlanFeatureNotIncludedError(PlanFeature.CUP_STANDINGS)) }));

    const reply = await callHandler(handlers.updateLeagueCupSettings, writes.updateLeagueCupSettings.request());

    expect(reply).toMatchObject({ statusCode: 403, body: { error: { code: 'PLAN_FEATURE_NOT_INCLUDED', details: { feature: PlanFeature.CUP_STANDINGS } } } });
  });
});

describe('league plan handlers', () => {
  const planChange = (user = me, contextLogger?: false) => stubRequest({ params: { id: 'league-1' }, body: { plan: 'PRO' }, authUser: user, contextLogger });
  const renewal = (user = admin, contextLogger?: false) => stubRequest({ params: { id: 'league-1' }, body: { months: 6 }, authUser: user, contextLogger });

  it('changes a league\'s plan as the caller, answering with the league', async () => {
    const plans = planService();

    const asMember = await callHandler(handlersOver(leagueService(), plans).updateLeaguePlan, planChange(me, false));
    await callHandler(handlersOver(leagueService(), plans).updateLeaguePlan, planChange(admin));

    expect(plans.changePlan.mock.calls).toEqual([
      ['league-1', 'PRO', { userId: 'user-1', isRootAdmin: false }],
      ['league-1', 'PRO', { userId: 'admin', isRootAdmin: true }],
    ]);
    expect(asMember.body).toMatchObject({ league: { id: 'league-1' } });
  });

  it.each([
    ['a missing league with 404 LEAGUE_NOT_FOUND', new LeagueNotFoundError('league-1'), 404, 'LEAGUE_NOT_FOUND'],
    ['a refused change with its own status and code', new LeagueOperationError('Not yours', 'LEAGUE_OPERATION_INVALID', 403), 403, 'LEAGUE_OPERATION_INVALID'],
  ])('answers a plan change for %s', async (_label, error, status, code) => {
    const handlers = handlersOver(leagueService(), planService({ changePlan: () => Promise.reject(error) }));

    expect(await callHandler(handlers.updateLeaguePlan, planChange())).toMatchObject({ statusCode: status, body: { error: { code } } });
  });

  it('extends a league\'s plan renewal as the root admin, and every running renewal at once', async () => {
    const plans = planService();
    const handlers = handlersOver(leagueService(), plans);

    const one = await callHandler(handlers.extendLeaguePlanRenewal, renewal(admin, false));
    const all = await callHandler(handlers.extendRunningPlanRenewals, stubRequest({ body: { months: 6 }, authUser: admin, contextLogger: false }));

    expect(plans.extendRenewal).toHaveBeenCalledWith('league-1', 6, 'admin');
    expect(plans.extendRunningRenewals).toHaveBeenCalledWith(6, 'admin');
    expect(one.body).toMatchObject({ league: { id: 'league-1' } });
    expect(all.body).toEqual({ extendedCount: 3, renewsAt: AT.toISOString() });
  });

  it('answers a renewal extension for a missing league with 404 LEAGUE_NOT_FOUND', async () => {
    const handlers = handlersOver(leagueService(), planService({ extendRenewal: () => Promise.reject(new LeagueNotFoundError('league-1')) }));

    expect(await callHandler(handlers.extendLeaguePlanRenewal, renewal())).toMatchObject({ statusCode: 404, body: { error: { code: 'LEAGUE_NOT_FOUND' } } });
  });

  it('passes an unexpected plan failure on to the global error handler', async () => {
    const handlers = handlersOver(leagueService(), planService({ changePlan: () => Promise.reject(boom), extendRenewal: () => Promise.reject(boom) }));

    await expect(callHandler(handlers.updateLeaguePlan, planChange())).rejects.toBe(boom);
    await expect(callHandler(handlers.extendLeaguePlanRenewal, renewal())).rejects.toBe(boom);
  });

  it('refuses each plan write with no session with 401 AUTH_SESSION_REQUIRED, changing nothing', async () => {
    const plans = planService();
    const handlers = handlersOver(leagueService(), plans);
    const anonymous = () => stubRequest({ params: { id: 'league-1' }, body: { plan: 'PRO', months: 6 } });

    for (const handler of ['updateLeaguePlan', 'extendLeaguePlanRenewal', 'extendRunningPlanRenewals'] as const) {
      expect(await callHandler(handlers[handler], anonymous())).toMatchObject({ statusCode: 401, body: { error: { code: 'AUTH_SESSION_REQUIRED' } } });
    }
    expect(plans.changePlan).not.toHaveBeenCalled();
    expect(plans.extendRenewal).not.toHaveBeenCalled();
    expect(plans.extendRunningRenewals).not.toHaveBeenCalled();
  });
});
