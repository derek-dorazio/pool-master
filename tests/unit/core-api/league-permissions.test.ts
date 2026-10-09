import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
} from '@poolmaster/shared/domain';
import {
  existingLeagueFromPath,
  requireCommissioner,
  requireCommissionerForContest,
  leagueFromPath,
  leagueOfContest,
  requireMemberOfLeague,
  requireMemberOfSquad,
  requireOwnSquad,
} from '../../../packages/core-api/src/modules/leagues/permissions';
import { buildContest, buildLeague, buildMembership } from '../../factories';
import {
  fakeContestRepo,
  fakeLeagueMembershipRepo,
  fakeLeagueRepo,
  fakeSquadMembershipRepo,
  fakeSquadRepo,
} from '../../support/repo-fakes';
import { fakeLogger } from '../../support/fake-logger';

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

describe('league permissions', () => {
  it('allows any member through requireMemberOfLeague with the league from the path', async () => {
    const membership = buildMembership({ role: LeagueRole.MEMBER });
    const repo = fakeLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
    });
    const hook = requireMemberOfLeague(repo, leagueFromPath);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test', isRootAdmin: false, sessionId: null },
        params: { id: 'league-1' },
        log: fakeLogger(),
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeUndefined();
  });

  it('rejects non-members on requireMemberOfLeague with the league from the path', async () => {
    const repo = fakeLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    });
    const hook = requireMemberOfLeague(repo, leagueFromPath);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'outsider', email: 'outsider@integration.test', isRootAdmin: false, sessionId: null },
        params: { id: 'league-1' },
        log: fakeLogger(),
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

  it('rejects inactive memberships on requireMemberOfLeague with the league from the path', async () => {
    const repo = fakeLeagueMembershipRepo({
      findByLeagueAndUser: jest
        .fn()
        .mockResolvedValue(buildMembership({ status: LeagueMembershipStatus.INACTIVE })),
    });
    const hook = requireMemberOfLeague(repo, leagueFromPath);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test', isRootAdmin: false, sessionId: null },
        params: { id: 'league-1' },
        log: fakeLogger(),
      } as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(403);
    expectReplyError(reply, 'LEAGUE_MEMBERSHIP_INACTIVE', 'Your membership in this league is inactive');
  });

  it('rejects requests without a user identity on requireMemberOfLeague with the league from the path', async () => {
    const repo = fakeLeagueMembershipRepo();
    const hook = requireMemberOfLeague(repo, leagueFromPath);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        headers: {},
        params: { id: 'league-1' },
        log: fakeLogger(),
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
        log: fakeLogger(),
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
        log: fakeLogger(),
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
        log: fakeLogger(),
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
    gate: typeof requireCommissionerForContest,
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
        log: fakeLogger(),
      } as never,
      reply as never,
    );
    return { reply, findById, findByLeagueAndUser };
  }

  // The member gate takes the league resolver; for these cases it resolves through the contest.
  const memberOfContestLeague: typeof requireCommissionerForContest = (contestRepo, membershipRepo) =>
    requireMemberOfLeague(membershipRepo, leagueOfContest(contestRepo));

  describe('requireMemberOfLeague with the contest\'s league', () => {
    it('admits an active member who is not a commissioner, reading membership in the contest\'s league', async () => {
      const { reply, findById, findByLeagueAndUser } = await runContestGate(memberOfContestLeague, {
        membership: buildMembership({ role: LeagueRole.MEMBER }),
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.payload).toBeUndefined();
      expect(findById).toHaveBeenCalledWith('contest-1');
      expect(findByLeagueAndUser).toHaveBeenCalledWith('league-1', 'user-1');
    });

    it('admits a commissioner', async () => {
      const { reply } = await runContestGate(memberOfContestLeague, {
        membership: buildMembership({ role: LeagueRole.COMMISSIONER }),
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.payload).toBeUndefined();
    });

    it('rejects a caller with no membership in the contest\'s league with 403', async () => {
      const { reply } = await runContestGate(memberOfContestLeague, { membership: null });
      expect(reply.statusCode).toBe(403);
      expectReplyError(
        reply,
        'LEAGUE_MEMBERSHIP_REQUIRED',
        'You must be an active member of this league to perform this action',
      );
    });

    it('rejects an inactive membership with 403', async () => {
      const { reply } = await runContestGate(memberOfContestLeague, {
        membership: buildMembership({ status: LeagueMembershipStatus.INACTIVE }),
      });
      expect(reply.statusCode).toBe(403);
      expectReplyError(reply, 'LEAGUE_MEMBERSHIP_INACTIVE', 'Your membership in this league is inactive');
    });

    it('answers 404 for a contest that does not exist, before reading any membership', async () => {
      const { reply, findByLeagueAndUser } = await runContestGate(memberOfContestLeague, {
        contestFound: false,
      });
      expect(reply.statusCode).toBe(404);
      expectReplyError(reply, 'CONTEST_NOT_FOUND', 'Contest not found');
      expect(findByLeagueAndUser).not.toHaveBeenCalled();
    });

    it('rejects a request without a session with 401', async () => {
      const { reply, findById } = await runContestGate(memberOfContestLeague, { authUser: null });
      expect(reply.statusCode).toBe(401);
      expectReplyError(reply, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      expect(findById).not.toHaveBeenCalled();
    });

    it('rejects a request without a contest id with 400', async () => {
      const { reply } = await runContestGate(memberOfContestLeague, { contestId: null });
      expect(reply.statusCode).toBe(400);
      expectReplyError(reply, 'CONTEST_ID_REQUIRED', 'Contest id is required');
    });

    it('lets a root admin through without a membership (access rule A10)', async () => {
      const { reply, findByLeagueAndUser } = await runContestGate(memberOfContestLeague, {
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

/**
 * #292 — the squad gate: acting for a squad needs an active owner of it, the league's
 * commissioner (access rule A7), or a root admin. Both memberships must be ACTIVE, because an
 * inactive squad membership survives leaving the league.
 */
describe('requireMemberOfSquad (#292)', () => {
  async function runSquadGate(options: {
    leagueMembership?: ReturnType<typeof buildMembership> | null;
    squadMembershipStatus?: SquadMembershipStatus | null;
    squadLeagueId?: string | null;
    authUser?: { userId: string; isRootAdmin: boolean } | null;
  } = {}) {
    const squad = options.squadLeagueId === null
      ? null
      : { id: 'squad-1', leagueId: options.squadLeagueId ?? 'league-1' };
    const findById = jest.fn().mockResolvedValue(squad);
    const findBySquadAndUser = jest.fn().mockResolvedValue(
      options.squadMembershipStatus === null || options.squadMembershipStatus === undefined
        ? null
        : { squadId: 'squad-1', leagueId: 'league-1', userId: 'user-1', status: options.squadMembershipStatus },
    );
    const findByLeagueAndUser = jest.fn().mockResolvedValue(
      options.leagueMembership === undefined
        ? buildMembership({ role: LeagueRole.MEMBER })
        : options.leagueMembership,
    );
    const hook = requireMemberOfSquad(
      fakeSquadRepo({ findById }),
      fakeSquadMembershipRepo({ findBySquadAndUser }),
      fakeLeagueMembershipRepo({ findByLeagueAndUser }),
    );
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
        params: { id: 'league-1', squadId: 'squad-1' },
        log: fakeLogger(),
      } as never,
      reply as never,
    );
    return { reply, findById, findBySquadAndUser, findByLeagueAndUser };
  }

  it('admits an active owner of the squad who is an active league member', async () => {
    const { reply, findBySquadAndUser } = await runSquadGate({ squadMembershipStatus: SquadMembershipStatus.ACTIVE });
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeUndefined();
    expect(findBySquadAndUser).toHaveBeenCalledWith('squad-1', 'user-1');
  });

  it('refuses a league member who does not own the squad with 403 SQUAD_OWNER_REQUIRED', async () => {
    const { reply } = await runSquadGate({ squadMembershipStatus: null });
    expect(reply.statusCode).toBe(403);
    expectReplyError(reply, 'SQUAD_OWNER_REQUIRED', 'You must be an active team owner to perform this action');
  });

  it('refuses a former owner whose squad membership is inactive with 403', async () => {
    const { reply } = await runSquadGate({ squadMembershipStatus: SquadMembershipStatus.INACTIVE });
    expect(reply.statusCode).toBe(403);
    expectReplyError(reply, 'SQUAD_OWNER_REQUIRED', 'You must be an active team owner to perform this action');
  });

  it('refuses an owner whose league membership is inactive with 403, before reading the squad membership', async () => {
    const { reply, findBySquadAndUser } = await runSquadGate({
      leagueMembership: buildMembership({ status: LeagueMembershipStatus.INACTIVE }),
      squadMembershipStatus: SquadMembershipStatus.ACTIVE,
    });
    expect(reply.statusCode).toBe(403);
    expectReplyError(reply, 'LEAGUE_MEMBERSHIP_INACTIVE', 'Your membership in this league is inactive');
    expect(findBySquadAndUser).not.toHaveBeenCalled();
  });

  it('refuses a caller with no league membership with 403', async () => {
    const { reply } = await runSquadGate({ leagueMembership: null, squadMembershipStatus: SquadMembershipStatus.ACTIVE });
    expect(reply.statusCode).toBe(403);
    expectReplyError(
      reply,
      'LEAGUE_MEMBERSHIP_REQUIRED',
      'You must be an active member of this league to perform this action',
    );
  });

  it('admits the league commissioner acting for a squad they do not own (access rule A7)', async () => {
    const { reply, findBySquadAndUser } = await runSquadGate({
      leagueMembership: buildMembership({ role: LeagueRole.COMMISSIONER }),
    });
    expect(reply.statusCode).toBe(200);
    expect(findBySquadAndUser).not.toHaveBeenCalled();
  });

  it('admits a root admin without any membership (access rule A10)', async () => {
    const { reply, findByLeagueAndUser } = await runSquadGate({ authUser: { userId: 'admin-1', isRootAdmin: true } });
    expect(reply.statusCode).toBe(200);
    expect(findByLeagueAndUser).not.toHaveBeenCalled();
  });

  it('answers 404 for a squad in another league, so a path cannot pair one league with another\'s squad', async () => {
    const { reply, findByLeagueAndUser } = await runSquadGate({ squadLeagueId: 'league-2' });
    expect(reply.statusCode).toBe(404);
    expectReplyError(reply, 'SQUAD_NOT_FOUND', 'Squad not found: squad-1');
    expect(findByLeagueAndUser).not.toHaveBeenCalled();
  });

  it('answers 404 for a squad that does not exist', async () => {
    const { reply } = await runSquadGate({ squadLeagueId: null });
    expect(reply.statusCode).toBe(404);
  });

  it('rejects a request without a session with 401, before reading the squad', async () => {
    const { reply, findById } = await runSquadGate({ authUser: null });
    expect(reply.statusCode).toBe(401);
    expectReplyError(reply, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    expect(findById).not.toHaveBeenCalled();
  });
});

describe('existingLeagueFromPath', () => {
  async function runLeagueGate(options: { leagueExists: boolean; isRootAdmin?: boolean }) {
    const findById = jest.fn().mockResolvedValue(options.leagueExists ? buildLeague({ id: 'league-1' }) : null);
    const findByLeagueAndUser = jest.fn().mockResolvedValue(buildMembership({ role: LeagueRole.MEMBER }));
    const hook = requireMemberOfLeague(
      fakeLeagueMembershipRepo({ findByLeagueAndUser }),
      existingLeagueFromPath(fakeLeagueRepo({ findById })),
    );
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test', isRootAdmin: options.isRootAdmin ?? false, sessionId: null },
        params: { id: 'league-1' },
        log: fakeLogger(),
      } as never,
      reply as never,
    );
    return { reply, findById, findByLeagueAndUser };
  }

  it('lets a member through when the league exists', async () => {
    const { reply, findById } = await runLeagueGate({ leagueExists: true });
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeUndefined();
    expect(findById).toHaveBeenCalledWith('league-1');
  });

  it('answers 404 LEAGUE_NOT_FOUND for a missing league before reading any membership', async () => {
    const { reply, findByLeagueAndUser } = await runLeagueGate({ leagueExists: false });
    expect(reply.statusCode).toBe(404);
    expectReplyError(reply, 'LEAGUE_NOT_FOUND', 'League not found');
    expect(findByLeagueAndUser).not.toHaveBeenCalled();
  });

  it('answers 404 to a root admin too, rather than letting the bypass skip the existence check', async () => {
    const { reply } = await runLeagueGate({ leagueExists: false, isRootAdmin: true });
    expect(reply.statusCode).toBe(404);
  });
});

describe('requireOwnSquad', () => {
  async function runOwnSquadGate(options: {
    contestExists?: boolean;
    leagueMembership?: ReturnType<typeof buildMembership> | null;
    squadMembershipStatus?: SquadMembershipStatus | null;
    authUser?: { userId: string; isRootAdmin: boolean } | null;
  } = {}) {
    const findContest = jest.fn().mockResolvedValue(
      options.contestExists === false ? null : buildContest({ id: 'contest-1', leagueId: 'league-1' }),
    );
    const findByLeagueAndUser = jest.fn().mockResolvedValue(
      options.leagueMembership === undefined
        ? buildMembership({ role: LeagueRole.MEMBER })
        : options.leagueMembership,
    );
    const findSquadMembership = jest.fn().mockResolvedValue(
      options.squadMembershipStatus === null
        ? null
        : {
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: options.squadMembershipStatus ?? SquadMembershipStatus.ACTIVE,
        },
    );
    const hook = requireOwnSquad(
      fakeLeagueMembershipRepo({ findByLeagueAndUser }),
      fakeSquadMembershipRepo({ findByLeagueAndUser: findSquadMembership }),
      leagueOfContest(fakeContestRepo({ findById: findContest })),
    );
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
        params: { contestId: 'contest-1' },
        log: fakeLogger(),
      } as never,
      reply as never,
    );
    return { reply, findContest, findByLeagueAndUser, findSquadMembership };
  }

  it('admits an active league member acting for their own active squad, found from the contest\'s league', async () => {
    const { reply, findSquadMembership } = await runOwnSquadGate();
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeUndefined();
    expect(findSquadMembership).toHaveBeenCalledWith('league-1', 'user-1');
  });

  it('refuses an active league member with no team with 403 SQUAD_MEMBERSHIP_REQUIRED', async () => {
    const { reply } = await runOwnSquadGate({ squadMembershipStatus: null });
    expect(reply.statusCode).toBe(403);
    expectReplyError(
      reply,
      'SQUAD_MEMBERSHIP_REQUIRED',
      'You must have an active team in this league to perform this action',
    );
  });

  it('refuses a member whose team membership has ended with 403 SQUAD_MEMBERSHIP_INACTIVE', async () => {
    const { reply } = await runOwnSquadGate({ squadMembershipStatus: SquadMembershipStatus.INACTIVE });
    expect(reply.statusCode).toBe(403);
    expectReplyError(reply, 'SQUAD_MEMBERSHIP_INACTIVE', 'Your membership of this team has ended');
  });

  it('gives a commissioner with no team no bypass: the squad is the caller\'s own', async () => {
    const { reply } = await runOwnSquadGate({
      leagueMembership: buildMembership({ role: LeagueRole.COMMISSIONER }),
      squadMembershipStatus: null,
    });
    expect(reply.statusCode).toBe(403);
    expectReplyError(
      reply,
      'SQUAD_MEMBERSHIP_REQUIRED',
      'You must have an active team in this league to perform this action',
    );
  });

  it('refuses a caller outside the league with 403 LEAGUE_MEMBERSHIP_REQUIRED, before reading any squad membership', async () => {
    const { reply, findSquadMembership } = await runOwnSquadGate({ leagueMembership: null });
    expect(reply.statusCode).toBe(403);
    expectReplyError(
      reply,
      'LEAGUE_MEMBERSHIP_REQUIRED',
      'You must be an active member of this league to perform this action',
    );
    expect(findSquadMembership).not.toHaveBeenCalled();
  });

  it('refuses a caller whose league membership has ended with 403 LEAGUE_MEMBERSHIP_INACTIVE', async () => {
    const { reply, findSquadMembership } = await runOwnSquadGate({
      leagueMembership: buildMembership({ status: LeagueMembershipStatus.INACTIVE }),
    });
    expect(reply.statusCode).toBe(403);
    expectReplyError(reply, 'LEAGUE_MEMBERSHIP_INACTIVE', 'Your membership in this league is inactive');
    expect(findSquadMembership).not.toHaveBeenCalled();
  });

  it('answers 404 CONTEST_NOT_FOUND for a contest that does not exist', async () => {
    const { reply, findByLeagueAndUser } = await runOwnSquadGate({ contestExists: false });
    expect(reply.statusCode).toBe(404);
    expectReplyError(reply, 'CONTEST_NOT_FOUND', 'Contest not found');
    expect(findByLeagueAndUser).not.toHaveBeenCalled();
  });

  it('passes a root admin through to the service without reading memberships (access rule A10)', async () => {
    const { reply, findByLeagueAndUser, findSquadMembership } = await runOwnSquadGate({
      authUser: { userId: 'admin-1', isRootAdmin: true },
    });
    expect(reply.statusCode).toBe(200);
    expect(findByLeagueAndUser).not.toHaveBeenCalled();
    expect(findSquadMembership).not.toHaveBeenCalled();
  });

  it('rejects a request without a session with 401, before reading the contest', async () => {
    const { reply, findContest } = await runOwnSquadGate({ authUser: null });
    expect(reply.statusCode).toBe(401);
    expectReplyError(reply, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    expect(findContest).not.toHaveBeenCalled();
  });
});
