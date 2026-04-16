import {
  MemberService,
  MemberNotFoundError,
  MemberOperationError,
} from '../../../packages/core-api/src/modules/leagues/member-service';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  SquadStatus,
  TeamIconKey,
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

function createMockSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByLeague: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue({
      id: 'squad-1',
      leagueId: 'league-1',
      createdBy: 'user-1',
      name: 'My Team',
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      status: SquadStatus.INACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    delete: jest.fn(),
    ...overrides,
  };
}

function createMockSquadMembershipRepo(
  overrides: Partial<SquadMembershipRepository> = {},
): SquadMembershipRepository {
  return {
    findBySquad: jest.fn().mockResolvedValue([]),
    findBySquadAndUser: jest.fn().mockResolvedValue(null),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue({
      id: 'squad-membership-1',
      squadId: 'squad-1',
      leagueId: 'league-1',
      userId: 'user-1',
      status: SquadMembershipStatus.INACTIVE,
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    delete: jest.fn(),
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
      });
      expect(repo.update).toHaveBeenCalledWith(membership.id, {
        role: LeagueRole.COMMISSIONER,
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

    it('also inactivates the team when the removed member was the last active owner', async () => {
      const membership = buildMembership({ role: LeagueRole.MEMBER });
      const repo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const squadRepo = createMockSquadRepo();
      const squadMembershipRepo = createMockSquadMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue({
          id: 'squad-membership-1',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        findBySquad: jest.fn().mockResolvedValue([]),
      });
      const service = new MemberService(repo, squadRepo, squadMembershipRepo);

      await service.removeMember('league-1', 'user-1');

      expect(squadMembershipRepo.update).toHaveBeenCalledWith('squad-membership-1', {
        status: SquadMembershipStatus.INACTIVE,
      });
      expect(squadRepo.update).toHaveBeenCalledWith('squad-1', {
        status: SquadStatus.INACTIVE,
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

});
