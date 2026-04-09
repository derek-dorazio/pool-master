import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  LeagueRole,
  CommissionerPermission,
} from '@poolmaster/shared/domain';
import { requireCommissionerOrOwner, requireLeagueMembership } from '../../../packages/core-api/src/modules/leagues/permissions';
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
        headers: { 'x-user-id': 'user-1' },
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
        headers: { 'x-user-id': 'outsider' },
        params: { id: 'league-1' },
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({
      error: 'FORBIDDEN',
      message: 'You are not a member of this league',
    });
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
        headers: { 'x-user-id': 'user-1' },
        params: { id: 'league-1' },
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({
      error: 'FORBIDDEN',
      message: 'Your membership in this league is inactive',
    });
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
    expect(reply.payload).toEqual({
      error: 'UNAUTHORIZED',
      message: 'Missing user identity',
    });
  });

  it('rejects requests without a league id on requireCommissionerOrOwner', async () => {
    const repo = createMockMembershipRepo();
    const hook = requireCommissionerOrOwner(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        headers: { 'x-user-id': 'user-1' },
        params: {},
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(400);
    expect(reply.payload).toEqual({
      error: 'BAD_REQUEST',
      message: 'Missing league id',
    });
  });

  it('allows owners and commissioners through requireCommissionerOrOwner', async () => {
    const membership = buildMembership({
      role: LeagueRole.COMMISSIONER,
      permissions: [CommissionerPermission.CONTEST_CREATE],
    });
    const repo = createMockMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
    });
    const hook = requireCommissionerOrOwner(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        headers: { 'x-user-id': 'user-1' },
        params: { id: 'league-1' },
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeUndefined();
  });

  it('rejects regular members on requireCommissionerOrOwner', async () => {
    const membership = buildMembership({ role: LeagueRole.MEMBER });
    const repo = createMockMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
    });
    const hook = requireCommissionerOrOwner(repo);
    const reply = createReply();
    await hook.call(
      {} as never,
      {
        headers: { 'x-user-id': 'user-1' },
        params: { id: 'league-1' },
      } as never,
      reply as never,
      jest.fn(),
    );
    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({
      error: 'FORBIDDEN',
      message: 'You do not have permission for this action',
    });
  });
});
