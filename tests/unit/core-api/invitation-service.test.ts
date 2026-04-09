import {
  InvitationService,
  InvitationNotFoundError,
  InvitationInvalidError,
} from '../../../packages/core-api/src/modules/leagues/invitation-service';
import type {
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
} from '@poolmaster/shared/db';
import {
  InvitationStatus,
  InviteType,
  LeagueMembershipStatus,
  LeagueRole,
} from '@poolmaster/shared/domain';
import { buildInvitation, buildLeague, buildMembership } from '../../factories';

function createMockInvitationRepo(
  overrides: Partial<LeagueInvitationRepository> = {},
): LeagueInvitationRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByLeague: jest.fn().mockResolvedValue([]),
    findByCode: jest.fn().mockResolvedValue(null),
    findByEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-invite-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      ...buildInvitation({ id }),
      ...updates,
    })),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return {
    findByLeague: jest.fn().mockResolvedValue([]),
    findByUser: jest.fn().mockResolvedValue([]),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-membership-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockResolvedValue(buildMembership()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return {
    findById: jest.fn().mockResolvedValue(buildLeague({ id: 'league-1', maxMembers: 20 })),
    findByTenant: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(buildLeague()),
    update: jest.fn().mockResolvedValue(buildLeague()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('InvitationService', () => {
  describe('sendEmailInvitations', () => {
    it('creates invitations for each email', async () => {
      const invitationRepo = createMockInvitationRepo();
      const service = new InvitationService(
        invitationRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      const result = await service.sendEmailInvitations({
        leagueId: 'league-1',
        emails: ['alice@example.com', 'bob@example.com'],
        invitedBy: 'owner-1',
      });
      expect(result.sent).toHaveLength(2);
      expect(invitationRepo.create).toHaveBeenCalledTimes(2);
    });

    it('skips emails with existing pending invitations', async () => {
      const invitationRepo = createMockInvitationRepo({
        findByEmail: jest.fn().mockImplementation(async (_leagueId: string, email: string) => {
          if (email === 'existing@example.com') return buildInvitation({ email });
          return null;
        }),
      });
      const service = new InvitationService(
        invitationRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      const result = await service.sendEmailInvitations({
        leagueId: 'league-1',
        emails: ['existing@example.com', 'new@example.com'],
        invitedBy: 'owner-1',
      });
      expect(result.sent).toHaveLength(1);
      expect(result.skippedDuplicates).toContain('existing@example.com');
    });

    it('normalises email addresses to lowercase', async () => {
      const invitationRepo = createMockInvitationRepo();
      const service = new InvitationService(
        invitationRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await service.sendEmailInvitations({
        leagueId: 'league-1',
        emails: ['ALICE@Example.COM'],
        invitedBy: 'owner-1',
      });
      const createArg = (invitationRepo.create as jest.Mock).mock.calls[0][0];
      expect(createArg.email).toBe('alice@example.com');
    });
  });

  describe('generateInviteLink', () => {
    it('creates a LINK-type invitation', async () => {
      const invitationRepo = createMockInvitationRepo();
      const service = new InvitationService(
        invitationRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await service.generateInviteLink({
        leagueId: 'league-1',
        invitedBy: 'owner-1',
        maxUses: 10,
      });
      expect(invitationRepo.create).toHaveBeenCalledTimes(1);
      const createArg = (invitationRepo.create as jest.Mock).mock.calls[0][0];
      expect(createArg.inviteType).toBe(InviteType.LINK);
      expect(createArg.maxUses).toBe(10);
    });

    it('sets unlimited uses when maxUses is not provided', async () => {
      const invitationRepo = createMockInvitationRepo();
      const service = new InvitationService(
        invitationRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await service.generateInviteLink({
        leagueId: 'league-1',
        invitedBy: 'owner-1',
      });
      const createArg = (invitationRepo.create as jest.Mock).mock.calls[0][0];
      expect(createArg.maxUses).toBe(0);
    });
  });

  describe('revokeInviteLink', () => {
    it('sets invitation status to REVOKED', async () => {
      const invitation = buildInvitation({ leagueId: 'league-1', inviteCode: 'abc123' });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const service = new InvitationService(
        invitationRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await service.revokeInviteLink('league-1', 'abc123');
      expect(invitationRepo.update).toHaveBeenCalledWith(invitation.id, {
        status: InvitationStatus.REVOKED,
      });
    });

    it('throws InvitationNotFoundError for unknown code', async () => {
      const service = new InvitationService(
        createMockInvitationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(service.revokeInviteLink('league-1', 'nope')).rejects.toThrow(
        InvitationNotFoundError,
      );
    });

    it('throws InvitationNotFoundError when league does not match', async () => {
      const invitation = buildInvitation({ leagueId: 'other-league', inviteCode: 'abc123' });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const service = new InvitationService(
        invitationRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(service.revokeInviteLink('league-1', 'abc123')).rejects.toThrow(
        InvitationNotFoundError,
      );
    });
  });

  describe('acceptInvitation', () => {
    it('creates a MEMBER membership on valid invitation', async () => {
      const invitation = buildInvitation({
        leagueId: 'league-1',
        inviteCode: 'valid-code',
        status: InvitationStatus.PENDING,
        expiresAt: new Date('2099-01-01'),
      });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const membershipRepo = createMockMembershipRepo();
      const service = new InvitationService(
        invitationRepo,
        membershipRepo,
        createMockLeagueRepo(),
      );
      await service.acceptInvitation('valid-code', 'new-user');
      expect(membershipRepo.create).toHaveBeenCalledTimes(1);
      const createArg = (membershipRepo.create as jest.Mock).mock.calls[0][0];
      expect(createArg.role).toBe(LeagueRole.MEMBER);
      expect(createArg.userId).toBe('new-user');
      expect(invitationRepo.update).toHaveBeenCalled();
    });

    it('reactivates an inactive membership on valid invitation', async () => {
      const invitation = buildInvitation({
        leagueId: 'league-1',
        inviteCode: 'valid-code',
        status: InvitationStatus.PENDING,
        expiresAt: new Date('2099-01-01'),
      });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const inactiveMembership = buildMembership({
        id: 'membership-1',
        leagueId: 'league-1',
        userId: 'returning-user',
        role: LeagueRole.MEMBER,
        status: LeagueMembershipStatus.INACTIVE,
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(inactiveMembership),
      });
      const service = new InvitationService(
        invitationRepo,
        membershipRepo,
        createMockLeagueRepo(),
      );

      await service.acceptInvitation('valid-code', 'returning-user');

      expect(membershipRepo.create).not.toHaveBeenCalled();
      expect(membershipRepo.update).toHaveBeenCalledWith(
        inactiveMembership.id,
        expect.objectContaining({
          role: LeagueRole.MEMBER,
          status: LeagueMembershipStatus.ACTIVE,
        }),
      );
    });

    it('throws InvitationNotFoundError for unknown code', async () => {
      const service = new InvitationService(
        createMockInvitationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(service.acceptInvitation('unknown', 'user-1')).rejects.toThrow(
        InvitationNotFoundError,
      );
    });

    it('throws InvitationInvalidError for already accepted invitation', async () => {
      const invitation = buildInvitation({ status: InvitationStatus.ACCEPTED });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const service = new InvitationService(
        invitationRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(service.acceptInvitation('code', 'user-1')).rejects.toThrow(
        InvitationInvalidError,
      );
    });

    it('throws InvitationInvalidError for expired invitation', async () => {
      const invitation = buildInvitation({
        status: InvitationStatus.PENDING,
        expiresAt: new Date('2020-01-01'),
      });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const service = new InvitationService(
        invitationRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(service.acceptInvitation('code', 'user-1')).rejects.toThrow(
        InvitationInvalidError,
      );
    });

    it('throws InvitationInvalidError when user is already a member', async () => {
      const invitation = buildInvitation({
        status: InvitationStatus.PENDING,
        expiresAt: new Date('2099-01-01'),
      });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(buildMembership()),
      });
      const service = new InvitationService(
        invitationRepo,
        membershipRepo,
        createMockLeagueRepo(),
      );
      await expect(service.acceptInvitation('code', 'user-1')).rejects.toThrow(
        InvitationInvalidError,
      );
    });

    it('throws InvitationInvalidError when league is full', async () => {
      const invitation = buildInvitation({
        leagueId: 'league-1',
        status: InvitationStatus.PENDING,
        expiresAt: new Date('2099-01-01'),
      });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeague: jest.fn().mockResolvedValue(Array(20).fill(buildMembership())),
      });
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(buildLeague({ maxMembers: 20 })),
      });
      const service = new InvitationService(invitationRepo, membershipRepo, leagueRepo);
      await expect(service.acceptInvitation('code', 'user-1')).rejects.toThrow(
        InvitationInvalidError,
      );
    });

    it('throws InvitationInvalidError when max uses exceeded', async () => {
      const invitation = buildInvitation({
        status: InvitationStatus.PENDING,
        expiresAt: new Date('2099-01-01'),
        maxUses: 1,
        currentUses: 1,
      });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const service = new InvitationService(
        invitationRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(service.acceptInvitation('code', 'user-1')).rejects.toThrow(
        InvitationInvalidError,
      );
    });

    it('marks a single-use invitation as accepted after it is consumed', async () => {
      const invitation = buildInvitation({
        leagueId: 'league-1',
        status: InvitationStatus.PENDING,
        expiresAt: new Date('2099-01-01'),
        maxUses: 1,
        currentUses: 0,
      });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(null),
        findByLeague: jest.fn().mockResolvedValue([]),
      });
      const service = new InvitationService(
        invitationRepo,
        membershipRepo,
        createMockLeagueRepo(),
      );

      await service.acceptInvitation('code', 'user-1');

      expect(invitationRepo.update).toHaveBeenCalledWith(invitation.id, {
        currentUses: 1,
        acceptedAt: expect.any(Date),
        acceptedBy: 'user-1',
        status: InvitationStatus.ACCEPTED,
      });
    });
  });
});
