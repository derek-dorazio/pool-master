/**
 * The league member and contest management route handlers (#1482), called with a stand-in
 * service: the status each service error is sent with, and that an error the handler does not
 * own reaches the global error handler unchanged.
 */
import { expect } from '@jest/globals';
import type { UserRepository } from '@poolmaster/shared/db';
import { ContestManagementError, type ContestManagementService } from '../../../packages/core-api/src/modules/contest-management/service';
import { createContestManagementHandlers } from '../../../packages/core-api/src/modules/contest-management/handler';
import type { MemberDirectoryService } from '../../../packages/core-api/src/modules/leagues/member-directory-service';
import { createMemberHandlers } from '../../../packages/core-api/src/modules/leagues/member-handler';
import { MemberNotFoundError, MemberOperationError, type MemberService } from '../../../packages/core-api/src/modules/leagues/member-service';
import { buildMembership, buildUser } from '../../factories';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';

const boom = new Error('database down');

describe('league member handlers', () => {
  const member = buildUser({ id: 'user-2' });
  const membership = buildMembership({ userId: 'user-2' });
  const memberService = (overrides: Partial<Record<keyof MemberService, unknown>> = {}) => ({
    changeRole: jest.fn((..._args: unknown[]) => Promise.resolve(membership)),
    removeMember: jest.fn((..._args: unknown[]) => Promise.resolve()),
    ...overrides,
  }) as unknown as MemberService;
  const directory = { listMembers: jest.fn((..._args: unknown[]) => Promise.resolve([{ userId: 'user-2' }])) } as unknown as MemberDirectoryService;
  const users = (found: boolean) => ({ findById: () => Promise.resolve(found ? member : null) }) as unknown as UserRepository;
  const roleRequest = (contextLogger?: false) => stubRequest({ params: { id: 'league-1', uid: 'user-2' }, body: { role: 'COMMISSIONER' }, contextLogger });

  it('lists a league\'s members', async () => {
    const handlers = createMemberHandlers(memberService(), directory, users(true));

    const reply = await callHandler(handlers.listMembers, stubRequest({ params: { id: 'league-1' }, contextLogger: false }));

    expect(reply.body).toEqual({ members: [{ userId: 'user-2' }] });
  });

  it('answers a role change with the membership and the member it belongs to', async () => {
    const service = memberService();
    const handlers = createMemberHandlers(service, directory, users(true));

    const reply = await callHandler(handlers.changeRole, roleRequest(false));

    expect(service.changeRole).toHaveBeenCalledWith({ leagueId: 'league-1', targetUserId: 'user-2', newRole: 'COMMISSIONER' });
    expect(reply.body).toMatchObject({ membership: { userId: 'user-2', user: { id: 'user-2' } } });
  });

  it('answers a role change whose member account is gone with 404 USER_NOT_FOUND', async () => {
    const handlers = createMemberHandlers(memberService(), directory, users(false));

    const reply = await callHandler(handlers.changeRole, roleRequest());

    expect(reply).toMatchObject({ statusCode: 404, body: { error: { code: 'USER_NOT_FOUND' } } });
  });

  describe.each([
    ['changeRole', 'changeRole', () => stubRequest({ params: { id: 'league-1', uid: 'user-2' }, body: { role: 'MEMBER' } })],
    ['removeMember', 'removeMember', () => stubRequest({ params: { id: 'league-1', uid: 'user-2' } })],
    ['leaveLeague', 'removeMember', () => stubRequest({ params: { id: 'league-1' }, authUser: authUser('user-2') })],
  ] as const)('%s', (handler, method, request) => {
    it('answers a member who is not in the league with 404 LEAGUE_MEMBER_NOT_FOUND', async () => {
      const handlers = createMemberHandlers(memberService({ [method]: () => Promise.reject(new MemberNotFoundError('user-2', 'league-1')) }), directory, users(true));

      expect(await callHandler(handlers[handler], request())).toMatchObject({ statusCode: 404, body: { error: { code: 'LEAGUE_MEMBER_NOT_FOUND' } } });
    });

    it('answers a refused change with 400 and the error\'s own code', async () => {
      const handlers = createMemberHandlers(memberService({ [method]: () => Promise.reject(new MemberOperationError('Last commissioner', 'LEAGUE_LAST_COMMISSIONER_REQUIRED')) }), directory, users(true));

      expect(await callHandler(handlers[handler], request())).toMatchObject({ statusCode: 400, body: { error: { code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED' } } });
    });

    it('passes an unexpected failure on to the global error handler', async () => {
      const handlers = createMemberHandlers(memberService({ [method]: () => Promise.reject(boom) }), directory, users(true));

      await expect(callHandler(handlers[handler], request())).rejects.toBe(boom);
    });
  });

  it('removes a member, and lets a signed-in member leave, each answering success', async () => {
    const service = memberService();
    const handlers = createMemberHandlers(service, directory, users(true));

    const removed = await callHandler(handlers.removeMember, stubRequest({ params: { id: 'league-1', uid: 'user-2' }, contextLogger: false }));
    const left = await callHandler(handlers.leaveLeague, stubRequest({ params: { id: 'league-1' }, authUser: authUser('user-3'), contextLogger: false }));

    expect(service.removeMember).toHaveBeenNthCalledWith(1, 'league-1', 'user-2');
    expect(service.removeMember).toHaveBeenNthCalledWith(2, 'league-1', 'user-3');
    expect([removed.body, left.body]).toEqual([{ success: true }, { success: true }]);
  });

  it('refuses leaving a league with no session with 401 AUTH_SESSION_REQUIRED and removes no one', async () => {
    const service = memberService();
    const handlers = createMemberHandlers(service, directory, users(true));

    const reply = await callHandler(handlers.leaveLeague, stubRequest({ params: { id: 'league-1' } }));

    expect(reply).toMatchObject({ statusCode: 401, body: { error: { code: 'AUTH_SESSION_REQUIRED' } } });
    expect(service.removeMember).not.toHaveBeenCalled();
  });
});

describe('contest management handlers', () => {
  const contest = { id: 'c1', sportEvents: [{ id: 'e1' }] };
  const service = (fail?: Error) => {
    const answer = (..._args: unknown[]) => (fail === undefined ? Promise.resolve(contest) : Promise.reject(fail));
    return {
      getContest: jest.fn(answer),
      updateContestConfiguration: jest.fn(answer),
      openContest: jest.fn(answer),
      setContestCupWeight: jest.fn(answer),
      setContestSportEvents: jest.fn(answer),
    };
  };
  const requests = {
    getContest: () => stubRequest({ params: { contestId: 'c1' } }),
    updateContestConfiguration: () => stubRequest({ params: { contestId: 'c1' }, body: { rosterSize: 4 } }),
    openContest: () => stubRequest({ params: { id: 'league-1', contestId: 'c1' } }),
    setContestCupWeight: () => stubRequest({ params: { id: 'league-1', contestId: 'c1' }, body: { cupWeight: 2 } }),
    setContestSportEvents: () => stubRequest({ params: { id: 'league-1', contestId: 'c1' }, body: { sportEventIds: ['e1'] } }),
  };
  const names = Object.keys(requests) as Array<keyof typeof requests>;

  it('answers each read and change with the contest, passing the path and body through', async () => {
    const fake = service();
    const handlers = createContestManagementHandlers(fake as unknown as ContestManagementService);

    for (const name of names) {
      expect((await callHandler(handlers[name], requests[name]())).body).toEqual({ contest });
    }
    expect(fake.updateContestConfiguration).toHaveBeenCalledWith('c1', { rosterSize: 4 });
    expect(fake.openContest).toHaveBeenCalledWith('league-1', 'c1');
    expect(fake.setContestCupWeight).toHaveBeenCalledWith('league-1', 'c1', 2);
    expect(fake.setContestSportEvents).toHaveBeenCalledWith('league-1', 'c1', ['e1']);
  });

  it.each(names)('%s answers a refused change with the error\'s own status and code', async (name) => {
    const handlers = createContestManagementHandlers(service(new ContestManagementError('Picks are open', 'CONTEST_CONFIGURATION_LOCKED', 409)) as unknown as ContestManagementService);

    expect(await callHandler(handlers[name], requests[name]())).toMatchObject({ statusCode: 409, body: { error: { code: 'CONTEST_CONFIGURATION_LOCKED' } } });
  });

  it.each(names)('%s passes an unexpected failure on to the global error handler', async (name) => {
    const handlers = createContestManagementHandlers(service(boom) as unknown as ContestManagementService);

    await expect(callHandler(handlers[name], requests[name]())).rejects.toBe(boom);
  });
});
