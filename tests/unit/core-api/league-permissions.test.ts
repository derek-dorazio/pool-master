import {
  LeagueMembershipStatus,
  LeagueRole,
} from '@poolmaster/shared/domain';
import {
  requireCommissioner,
  requireCommissionerForContest,
  requireLeagueMembership,
  requireMemberOfLeague,
} from '../../../packages/core-api/src/modules/leagues/permissions';
import { buildContest, buildMembership } from '../../factories';
import { fakeContestRepo, fakeLeagueMembershipRepo } from '../../support/repo-fakes';

function createReply() {
  let statusCode = 200;
  let payload: unknown;
  const reply = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    get payload() {
      return payload;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    send(nextPayload: unknown) {
      payload = nextPayload;
      return this;
    },
  };
  return reply;
}

function expectReplyError(
  reply: ReturnType<typeof createReply>,
  code: string,
  message: string,
) {
  expect(reply.payload).toEqual({
    error: {
      code,
      message,
    },
  });
}

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe('league permissions', () => {
  it('allows any member through requireLeagueMembership', async () => {
    const membership = buildMembership({ role: LeagueRole.MEMBER });
    const repo = fakeLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
    });
    const hook = requireLeagueMembership(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test', isRootAdmin: false, sessionId: null },
        params: { id: 'league-1' },
        log: createLogger(),
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeUndefined();
  });

  it('rejects non-members on requireLeagueMembership', async () => {
    const repo = fakeLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    });
    const hook = requireLeagueMembership(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'outsider', email: 'outsider@integration.test', isRootAdmin: false, sessionId: null },
        params: { id: 'league-1' },
        log: createLogger(),
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(403);
    expectReplyError(
      reply,
      'LEAGUE_MEMBERSHIP_REQUIRED',
      'You must be an active member of this league to perform this action',
    );
  });

  it('rejects inactive memberships on requireLeagueMembership', async () => {
    const repo = fakeLeagueMembershipRepo({
      findByLeagueAndUser: jest
        .fn()
        .mockResolvedValue(buildMembership({ status: LeagueMembershipStatus.INACTIVE })),
    });
    const hook = requireLeagueMembership(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test', isRootAdmin: false, sessionId: null },
        params: { id: 'league-1' },
        log: createLogger(),
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(403);
    expectReplyError(reply, 'LEAGUE_MEMBERSHIP_INACTIVE', 'Your membership in this league is inactive');
  });

  it('rejects requests without a user identity on requireLeagueMembership', async () => {
    const repo = fakeLeagueMembershipRepo();
    const hook = requireLeagueMembership(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        headers: {},
        params: { id: 'league-1' },
        log: createLogger(),
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(401);
    expectReplyError(reply, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
  });

  it('rejects requests without a league id on requireCommissioner', async () => {
    const repo = fakeLeagueMembershipRepo();
    const hook = requireCommissioner(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test', isRootAdmin: false, sessionId: null },
        params: {},
        log: createLogger(),
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(400);
    expectReplyError(reply, 'LEAGUE_ID_REQUIRED', 'League id is required');
  });

  it('allows commissioners through requireCommissioner', async () => {
    const membership = buildMembership({
      role: LeagueRole.COMMISSIONER,
    });
    const repo = fakeLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
    });
    const hook = requireCommissioner(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test', isRootAdmin: false, sessionId: null },
        params: { id: 'league-1' },
        log: createLogger(),
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeUndefined();
  });

  it('rejects regular members on requireCommissioner', async () => {
    const membership = buildMembership({ role: LeagueRole.MEMBER });
    const repo = fakeLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
    });
    const hook = requireCommissioner(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test', isRootAdmin: false, sessionId: null },
        params: { id: 'league-1' },
        log: createLogger(),
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(403);
    expectReplyError(reply, 'LEAGUE_PERMISSION_DENIED', 'You do not have permission for this action');
  });
});

/**
 * #193 — the contest-scoped gates resolve the contest's league from `:contestId` and read the
 * caller's membership there by query (access rule A12). `requireMemberOfLeague` admits any
 * active member; `requireCommissionerForContest` admits only commissioners.
 */
describe('contest-scoped league permissions (#193)', () => {
  const contest = buildContest({ id: 'contest-1', leagueId: 'league-1' });

  async function runContestGate(
    gate: typeof requireMemberOfLeague,
    options: {
      membership?: ReturnType<typeof buildMembership> | null;
      contestFound?: boolean;
      authUser?: { userId: string; isRootAdmin: boolean } | null;
      contestId?: string | null;
    } = {},
  ) {
    const findByLeagueAndUser = jest.fn().mockResolvedValue(options.membership ?? null);
    const findById = jest.fn().mockResolvedValue(options.contestFound === false ? null : contest);
    const hook = gate(fakeContestRepo({ findById }), fakeLeagueMembershipRepo({ findByLeagueAndUser }));
    const reply = createReply();
    const authUser = options.authUser === undefined
      ? { userId: 'user-1', isRootAdmin: false }
      : options.authUser;
    await hook.call(
      {} as never,
      {
        authUser: authUser
          ? { ...authUser, email: `${authUser.userId}@integration.test`, sessionId: null }
          : undefined,
        params: options.contestId === null ? {} : { contestId: options.contestId ?? 'contest-1' },
        log: createLogger(),
      } as never,
      reply as never,
    );
    return { reply, findById, findByLeagueAndUser };
  }

  describe('requireMemberOfLeague', () => {
    it('admits an active member who is not a commissioner, reading membership in the contest\'s league', async () => {
      const { reply, findById, findByLeagueAndUser } = await runContestGate(requireMemberOfLeague, {
        membership: buildMembership({ role: LeagueRole.MEMBER }),
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.payload).toBeUndefined();
      expect(findById).toHaveBeenCalledWith('contest-1');
      expect(findByLeagueAndUser).toHaveBeenCalledWith('league-1', 'user-1');
    });

    it('admits a commissioner', async () => {
      const { reply } = await runContestGate(requireMemberOfLeague, {
        membership: buildMembership({ role: LeagueRole.COMMISSIONER }),
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.payload).toBeUndefined();
    });

    it('rejects a caller with no membership in the contest\'s league with 403', async () => {
      const { reply } = await runContestGate(requireMemberOfLeague, { membership: null });
      expect(reply.statusCode).toBe(403);
      expectReplyError(
        reply,
        'LEAGUE_MEMBERSHIP_REQUIRED',
        'You must be an active member of this league to perform this action',
      );
    });

    it('rejects an inactive membership with 403', async () => {
      const { reply } = await runContestGate(requireMemberOfLeague, {
        membership: buildMembership({ status: LeagueMembershipStatus.INACTIVE }),
      });
      expect(reply.statusCode).toBe(403);
      expectReplyError(reply, 'LEAGUE_MEMBERSHIP_INACTIVE', 'Your membership in this league is inactive');
    });

    it('answers 404 for a contest that does not exist, before reading any membership', async () => {
      const { reply, findByLeagueAndUser } = await runContestGate(requireMemberOfLeague, {
        contestFound: false,
      });
      expect(reply.statusCode).toBe(404);
      expectReplyError(reply, 'CONTEST_NOT_FOUND', 'Contest not found');
      expect(findByLeagueAndUser).not.toHaveBeenCalled();
    });

    it('rejects a request without a session with 401', async () => {
      const { reply, findById } = await runContestGate(requireMemberOfLeague, { authUser: null });
      expect(reply.statusCode).toBe(401);
      expectReplyError(reply, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      expect(findById).not.toHaveBeenCalled();
    });

    it('rejects a request without a contest id with 400', async () => {
      const { reply } = await runContestGate(requireMemberOfLeague, { contestId: null });
      expect(reply.statusCode).toBe(400);
      expectReplyError(reply, 'CONTEST_ID_REQUIRED', 'Contest id is required');
    });

    it('lets a root admin through without a membership (access rule A10)', async () => {
      const { reply, findByLeagueAndUser } = await runContestGate(requireMemberOfLeague, {
        authUser: { userId: 'admin-1', isRootAdmin: true },
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.payload).toBeUndefined();
      expect(findByLeagueAndUser).not.toHaveBeenCalled();
    });
  });

  describe('requireCommissionerForContest', () => {
    it('admits a commissioner of the contest\'s league', async () => {
      const { reply } = await runContestGate(requireCommissionerForContest, {
        membership: buildMembership({ role: LeagueRole.COMMISSIONER }),
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.payload).toBeUndefined();
    });

    it('rejects an active member who is not a commissioner with 403', async () => {
      const { reply } = await runContestGate(requireCommissionerForContest, {
        membership: buildMembership({ role: LeagueRole.MEMBER }),
      });
      expect(reply.statusCode).toBe(403);
      expectReplyError(reply, 'LEAGUE_PERMISSION_DENIED', 'You do not have permission for this action');
    });

    it('rejects a non-member with 403', async () => {
      const { reply } = await runContestGate(requireCommissionerForContest, { membership: null });
      expect(reply.statusCode).toBe(403);
      expectReplyError(
        reply,
        'LEAGUE_MEMBERSHIP_REQUIRED',
        'You must be an active member of this league to perform this action',
      );
    });

    it('rejects an inactive commissioner with 403', async () => {
      const { reply } = await runContestGate(requireCommissionerForContest, {
        membership: buildMembership({
          role: LeagueRole.COMMISSIONER,
          status: LeagueMembershipStatus.INACTIVE,
        }),
      });
      expect(reply.statusCode).toBe(403);
      expectReplyError(reply, 'LEAGUE_MEMBERSHIP_INACTIVE', 'Your membership in this league is inactive');
    });
  });
});
