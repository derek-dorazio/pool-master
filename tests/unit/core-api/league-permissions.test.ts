import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  LeagueRole,
  CommissionerPermission,
} from '@poolmaster/shared/domain';
import { requireCommissioner, requireLeagueMembership } from '../../../packages/core-api/src/modules/leagues/permissions';
import { buildMembership } from '../../factories';

function createMockMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return {
    findByLeague: jest.fn().mockResolvedValue([]),
    findByUser: jest.fn().mockResolvedValue([]),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  } as LeagueMembershipRepository;
}

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
  it('allows any member through requireLeagueMembership', async () => {
    const membership = buildMembership({ role: LeagueRole.MEMBER });
    const repo = createMockMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
    });
    const hook = requireLeagueMembership(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test' },
        params: { id: 'league-1' },
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeUndefined();
  });

  it('rejects non-members on requireLeagueMembership', async () => {
    const repo = createMockMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    });
    const hook = requireLeagueMembership(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'outsider', email: 'outsider@integration.test' },
        params: { id: 'league-1' },
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(403);
    expectReplyError(
      reply,
      'LEAGUE_MEMBERSHIP_REQUIRED',
      'You must be an active member of this league to perform this action',
    );
  });

  it('rejects inactive memberships on requireLeagueMembership', async () => {
    const repo = createMockMembershipRepo({
      findByLeagueAndUser: jest
        .fn()
        .mockResolvedValue(buildMembership({ status: LeagueMembershipStatus.INACTIVE })),
    });
    const hook = requireLeagueMembership(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test' },
        params: { id: 'league-1' },
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(403);
    expectReplyError(reply, 'LEAGUE_MEMBERSHIP_INACTIVE', 'Your membership in this league is inactive');
  });

  it('rejects requests without a user identity on requireLeagueMembership', async () => {
    const repo = createMockMembershipRepo();
    const hook = requireLeagueMembership(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        headers: {},
        params: { id: 'league-1' },
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(401);
    expectReplyError(reply, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
  });

  it('rejects requests without a league id on requireCommissioner', async () => {
    const repo = createMockMembershipRepo();
    const hook = requireCommissioner(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test' },
        params: {},
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(400);
    expectReplyError(reply, 'LEAGUE_ID_REQUIRED', 'League id is required');
  });

  it('allows commissioners through requireCommissioner', async () => {
    const membership = buildMembership({
      role: LeagueRole.COMMISSIONER,
      permissions: [CommissionerPermission.CONTEST_CREATE],
    });
    const repo = createMockMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
    });
    const hook = requireCommissioner(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test' },
        params: { id: 'league-1' },
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeUndefined();
  });

  it('rejects regular members on requireCommissioner', async () => {
    const membership = buildMembership({ role: LeagueRole.MEMBER });
    const repo = createMockMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
    });
    const hook = requireCommissioner(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        authUser: { userId: 'user-1', email: 'user-1@integration.test' },
        params: { id: 'league-1' },
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(403);
    expectReplyError(reply, 'LEAGUE_PERMISSION_DENIED', 'You do not have permission for this action');
  });
});
