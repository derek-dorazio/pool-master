import {
  MemberService,
  MemberNotFoundError,
  MemberOperationError,
} from '../../../packages/core-api/src/modules/leagues/member-service';
import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import {
  CommissionerPermission,
  LeagueMembershipStatus,
  LeagueRole,
} from '@poolmaster/shared/domain';
import { buildMembership } from '../../factories';

function createMockMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return {
    findByLeague: jest.fn().mockResolvedValue([]),
    findByUser: jest.fn().mockResolvedValue([]),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      ...buildMembership({ id }),
      ...updates,
    })),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('MemberService', () => {
  describe('changeRole', () => {
    it('updates the role of a non-owner member', async () => {
      const membership = buildMembership({ role: LeagueRole.MEMBER });
      const repo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const service = new MemberService(repo);
      await service.changeRole({
        leagueId: 'league-1',
        targetUserId: 'user-1',
        newRole: LeagueRole.COMMISSIONER,
        permissions: [CommissionerPermission.CONTEST_CREATE],
      });
      expect(repo.update).toHaveBeenCalledWith(membership.id, {
        role: LeagueRole.COMMISSIONER,
        permissions: [CommissionerPermission.CONTEST_CREATE],
      });
    });

    it('throws MemberOperationError when promoting to OWNER', async () => {
      const repo = createMockMembershipRepo();
      const service = new MemberService(repo);
      await expect(
        service.changeRole({
          leagueId: 'league-1',
          targetUserId: 'user-1',
          newRole: LeagueRole.OWNER,
        }),
      ).rejects.toThrow(MemberOperationError);
    });

    it('throws MemberOperationError when target is OWNER', async () => {
      const ownerMembership = buildMembership({ role: LeagueRole.OWNER });
      const repo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(ownerMembership),
      });
      const service = new MemberService(repo);
      await expect(
        service.changeRole({
          leagueId: 'league-1',
          targetUserId: 'user-1',
          newRole: LeagueRole.MEMBER,
        }),
      ).rejects.toThrow(MemberOperationError);
    });

    it('throws MemberNotFoundError when member does not exist', async () => {
      const repo = createMockMembershipRepo();
      const service = new MemberService(repo);
      await expect(
        service.changeRole({
          leagueId: 'league-1',
          targetUserId: 'missing',
          newRole: LeagueRole.MEMBER,
        }),
      ).rejects.toThrow(MemberNotFoundError);
    });

    it('throws MemberOperationError when target membership is inactive', async () => {
      const repo = createMockMembershipRepo({
        findByLeagueAndUser: jest
          .fn()
          .mockResolvedValue(buildMembership({ status: LeagueMembershipStatus.INACTIVE })),
      });
      const service = new MemberService(repo);
      await expect(
        service.changeRole({
          leagueId: 'league-1',
          targetUserId: 'user-1',
          newRole: LeagueRole.COMMISSIONER,
        }),
      ).rejects.toThrow(MemberOperationError);
    });
  });

  describe('removeMember', () => {
    it('inactivates the membership for a non-owner', async () => {
      const membership = buildMembership({ role: LeagueRole.MEMBER });
      const repo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const service = new MemberService(repo);
      await service.removeMember('league-1', 'user-1');
      expect(repo.update).toHaveBeenCalledWith(membership.id, {
        status: LeagueMembershipStatus.INACTIVE,
      });
    });

    it('throws MemberOperationError when removing the owner', async () => {
      const ownerMembership = buildMembership({ role: LeagueRole.OWNER });
      const repo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(ownerMembership),
      });
      const service = new MemberService(repo);
      await expect(service.removeMember('league-1', 'user-1')).rejects.toThrow(
        MemberOperationError,
      );
    });

    it('throws MemberNotFoundError when member does not exist', async () => {
      const repo = createMockMembershipRepo();
      const service = new MemberService(repo);
      await expect(service.removeMember('league-1', 'missing')).rejects.toThrow(
        MemberNotFoundError,
      );
    });

    it('throws MemberOperationError when member is already inactive', async () => {
      const repo = createMockMembershipRepo({
        findByLeagueAndUser: jest
          .fn()
          .mockResolvedValue(buildMembership({ status: LeagueMembershipStatus.INACTIVE })),
      });
      const service = new MemberService(repo);
      await expect(service.removeMember('league-1', 'user-1')).rejects.toThrow(
        MemberOperationError,
      );
    });
  });

  describe('transferOwnership', () => {
    it('swaps roles between current owner and new owner', async () => {
      const currentOwner = buildMembership({
        id: 'owner-m-id',
        userId: 'owner-1',
        role: LeagueRole.OWNER,
      });
      const newOwner = buildMembership({
        id: 'new-owner-m-id',
        userId: 'user-2',
        role: LeagueRole.COMMISSIONER,
      });
      const repo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockImplementation(async (_lid: string, uid: string) => {
          if (uid === 'owner-1') return currentOwner;
          if (uid === 'user-2') return newOwner;
          return null;
        }),
      });
      const service = new MemberService(repo);
      await service.transferOwnership('league-1', 'owner-1', 'user-2');
      expect(repo.update).toHaveBeenCalledWith('owner-m-id', { role: LeagueRole.COMMISSIONER });
      expect(repo.update).toHaveBeenCalledWith('new-owner-m-id', {
        role: LeagueRole.OWNER,
        permissions: [],
      });
    });

    it('throws MemberOperationError when caller is not the owner', async () => {
      const notOwner = buildMembership({ role: LeagueRole.COMMISSIONER });
      const repo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(notOwner),
      });
      const service = new MemberService(repo);
      await expect(
        service.transferOwnership('league-1', 'not-owner', 'user-2'),
      ).rejects.toThrow(MemberOperationError);
    });

    it('throws MemberNotFoundError when new owner does not exist', async () => {
      const owner = buildMembership({ role: LeagueRole.OWNER });
      const repo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockImplementation(async (_lid: string, uid: string) => {
          if (uid === 'owner-1') return owner;
          return null;
        }),
      });
      const service = new MemberService(repo);
      await expect(
        service.transferOwnership('league-1', 'owner-1', 'missing'),
      ).rejects.toThrow(MemberNotFoundError);
    });
  });

  describe('updatePermissions', () => {
    it('updates the permissions on a membership', async () => {
      const repo = createMockMembershipRepo();
      const service = new MemberService(repo);
      await service.updatePermissions('membership-1', [
        CommissionerPermission.CONTEST_CREATE,
        CommissionerPermission.DRAFT_START,
      ]);
      expect(repo.update).toHaveBeenCalledWith('membership-1', {
        permissions: [CommissionerPermission.CONTEST_CREATE, CommissionerPermission.DRAFT_START],
      });
    });
  });
});
