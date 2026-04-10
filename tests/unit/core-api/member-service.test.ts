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
    it('updates the role of an active member', async () => {
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
    it('inactivates the membership for an active member', async () => {
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
