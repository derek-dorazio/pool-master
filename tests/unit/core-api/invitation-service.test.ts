import { expect } from '@jest/globals';
import {
  InvitationService,
  InvitationEmailDeliveryError,
  InvitationNotFoundError,
  InvitationInvalidError,
} from '../../../packages/core-api/src/modules/leagues/invitation-service';
import type {
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  InvitationStatus,
  InviteType,
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  TeamIconKey,
} from '@poolmaster/shared/domain';
import { buildInvitation, buildLeague, buildMembership, buildUser } from '../../factories';
import {
  fakeLeagueInvitationRepo,
  fakeLeagueMembershipRepo,
  fakeLeagueRepo,
  fakeSquadMembershipRepo,
  fakeSquadRepo,
  fakeUserRepo,
} from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';
import type { MailDeliveryProvider } from '../../../packages/core-api/src/modules/email/mail-delivery';
import { asPrismaClient } from '../../support/prisma-double';

function createMockInvitationRepo(
  overrides: Partial<LeagueInvitationRepository> = {},
): LeagueInvitationRepository {
  return fakeLeagueInvitationRepo({
    create: mockFn<LeagueInvitationRepository['create']>(async (input) => ({
      ...input,
      id: 'new-invite-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: mockFn<LeagueInvitationRepository['update']>(async (id, updates) => ({
      ...buildInvitation({ id }),
      ...updates,
    })),
    ...overrides,
  });
}

function createMockMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return fakeLeagueMembershipRepo({
    create: mockFn<LeagueMembershipRepository['create']>(async (input) => ({
      ...input,
      id: 'new-membership-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockResolvedValue(buildMembership()),
    ...overrides,
  });
}

function createMockLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return fakeLeagueRepo({
    findById: jest.fn().mockResolvedValue(buildLeague({ id: 'league-1' })),
    create: jest.fn().mockResolvedValue(buildLeague()),
    update: jest.fn().mockResolvedValue(buildLeague()),
    ...overrides,
  });
}

function createMockSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return fakeSquadRepo({
    create: mockFn<SquadRepository['create']>(async (input) => ({
      ...input,
      id: 'new-squad-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: mockFn<SquadRepository['update']>(async (id, updates) => ({
      id,
      leagueId: 'league-1',
      createdBy: 'user-1',
      name: "User One's Team",
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...updates,
    })),
    ...overrides,
  });
}

function createMockSquadMembershipRepo(
  overrides: Partial<SquadMembershipRepository> = {},
): SquadMembershipRepository {
  return fakeSquadMembershipRepo({
    create: mockFn<SquadMembershipRepository['create']>(async (input) => ({
      ...input,
      id: 'new-squad-membership-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: mockFn<SquadMembershipRepository['update']>(async (id, updates) => ({
      id,
      squadId: 'new-squad-id',
      leagueId: 'league-1',
      userId: 'user-1',
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...updates,
    })),
    ...overrides,
  });
}

function createProvisioningUsers() {
  return fakeUserRepo({
    findById: jest.fn().mockResolvedValue(buildUser({
      firstName: 'User',
      lastName: 'One',
      username: 'user.one',
      email: 'user.one@example.com',
    })),
  });
}

function createMockProvisioningPrisma() {
  return {
    squadMembership: {
      findFirst: jest.fn().mockResolvedValue({
        squad: { name: "User One's Team" },
      }),
    },
  };
}

describe('InvitationService', () => {
  describe('sendEmailInvitations', () => {
    it('creates invitations for each email', async () => {
      const invitationRepo = createMockInvitationRepo();
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
      const result = await service.sendEmailInvitations({
        leagueId: 'league-1',
        emails: ['alice@example.com', 'bob@example.com'],
        invitedBy: 'owner-1',
      });
      expect(result.sent).toHaveLength(2);
      expect(invitationRepo.create).toHaveBeenCalledTimes(2);
    });

    it('pool-master-7ij sends themed invite emails after invitation records are created', async () => {
      const invitationRepo = createMockInvitationRepo();
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail-1' })),
      };
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo({
          findById: jest.fn().mockResolvedValue(buildLeague({
            id: 'league-1',
            name: 'Mathworks',
            leagueCode: 'MATHWORKS',
          })),
        }),
        prisma: asPrismaClient(createMockProvisioningPrisma()),
        mailDelivery,
        appBaseUrl: 'https://app.primetimecommissioner.com/',
        users: createProvisioningUsers(),
      });

      const result = await service.sendEmailInvitations({
        leagueId: 'league-1',
        emails: ['Alice@Example.com'],
        invitedBy: 'owner-1',
        message: 'Join us for the office pool.',
      });

      expect(result.sent).toHaveLength(1);
      expect(mailDelivery.send).toHaveBeenCalledTimes(1);
      expect(mailDelivery.send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'alice@example.com',
        subject: 'User One invited you to Mathworks',
        metadata: {
          templateKey: 'LEAGUE_MEMBER_INVITE',
          invitationId: 'new-invite-id',
        },
      }));
      const sentMessage = mailDelivery.send.mock.calls[0][0];
      expect(sentMessage.text).toContain('Join league: https://app.primetimecommissioner.com/invite/');
      expect(sentMessage.text).toContain('Message from User One: Join us for the office pool.');
      expect(sentMessage.html).toContain('Prime Time Commissioner');
      expect(sentMessage.html).toContain('Ultimate Office Pool Manager');
    });

    it('pool-master-7ij fails the send when provider submission fails', async () => {
      const invitationRepo = createMockInvitationRepo();
      const mailDelivery = {
        providerName: 'ses' as const,
        send: jest.fn().mockRejectedValue(new Error('SES rejected request')),
      };
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        prisma: asPrismaClient(createMockProvisioningPrisma()),
        mailDelivery,
        appBaseUrl: 'https://app.primetimecommissioner.com',
        users: createProvisioningUsers(),
      });

      await expect(service.sendEmailInvitations({
        leagueId: 'league-1',
        emails: ['alice@example.com'],
        invitedBy: 'owner-1',
      })).rejects.toBeInstanceOf(InvitationEmailDeliveryError);
      expect(invitationRepo.create).toHaveBeenCalledTimes(1);
      expect(mailDelivery.send).toHaveBeenCalledTimes(1);
    });

    it('skips emails with existing pending invitations', async () => {
      const invitationRepo = createMockInvitationRepo({
        findByEmail: jest.fn().mockImplementation(async (_leagueId: string, email: string) => {
          if (email === 'existing@example.com') return buildInvitation({ email });
          return null;
        }),
      });
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
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
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
      await service.sendEmailInvitations({
        leagueId: 'league-1',
        emails: ['ALICE@Example.COM'],
        invitedBy: 'owner-1',
      });
      expect(invitationRepo.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ email: 'alice@example.com' }));
    });
  });

  describe('generateInviteLink', () => {
    it('creates a LINK-type invitation', async () => {
      const invitationRepo = createMockInvitationRepo();
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
      await service.generateInviteLink({
        leagueId: 'league-1',
        invitedBy: 'owner-1',
        maxUses: 10,
      });
      expect(invitationRepo.create).toHaveBeenCalledTimes(1);
      expect(invitationRepo.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ inviteType: InviteType.LINK, maxUses: 10 }));
    });

    it('sets unlimited uses when maxUses is not provided', async () => {
      const invitationRepo = createMockInvitationRepo();
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
      await service.generateInviteLink({
        leagueId: 'league-1',
        invitedBy: 'owner-1',
      });
      expect(invitationRepo.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ maxUses: 0 }));
    });
  });

  describe('listOutstandingInvitations', () => {
    it('lists pending invites and email invites that expired unaccepted, leaving out accepted, cancelled and expired join links', async () => {
      const pendingEmail = buildInvitation({ status: InvitationStatus.PENDING });
      const pendingLink = buildInvitation({ inviteType: InviteType.LINK, email: undefined, maxUses: 0 });
      const expiredEmail = buildInvitation({ status: InvitationStatus.EXPIRED });
      const service = new InvitationService({
        invitations: createMockInvitationRepo({
          findByLeague: jest.fn().mockResolvedValue([
            pendingEmail,
            buildInvitation({ status: InvitationStatus.ACCEPTED }),
            pendingLink,
            buildInvitation({ status: InvitationStatus.REVOKED }),
            expiredEmail,
            buildInvitation({ inviteType: InviteType.LINK, status: InvitationStatus.EXPIRED }),
          ]),
        }),
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });

      const listed = await service.listOutstandingInvitations('league-1');

      expect(listed.map((invitation) => invitation.id)).toEqual([
        pendingEmail.id,
        pendingLink.id,
        expiredEmail.id,
      ]);
    });
  });

  describe('resendEmailInvitation', () => {
    function createResendService(
      invitation: ReturnType<typeof buildInvitation> | null,
      mailDelivery?: MailDeliveryProvider,
    ) {
      const invitationRepo = createMockInvitationRepo({
        findById: jest.fn().mockResolvedValue(invitation),
      });
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo({
          findById: jest.fn().mockResolvedValue(buildLeague({
            id: 'league-1',
            name: 'Mathworks',
            leagueCode: 'MATHWORKS',
          })),
        }),
        users: createProvisioningUsers(),
        mailDelivery,
        appBaseUrl: 'https://app.example.com',
      });
      return { invitationRepo, service };
    }

    it('gives an email invite a new code and a fresh 7-day expiry, and emails the new link to the same address', async () => {
      const invitation = buildInvitation({ id: 'invite-1', inviteCode: 'oldcode', email: 'alice@example.com' });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail-1' })),
      };
      const { invitationRepo, service } = createResendService(invitation, mailDelivery);
      const before = Date.now();

      const renewed = await service.resendEmailInvitation('league-1', 'invite-1', 'owner-1');

      const update = jest.mocked(invitationRepo.update).mock.calls[0][1];
      expect(update.inviteCode).toBeDefined();
      expect(update.inviteCode).not.toBe('oldcode');
      expect(update.status).toBe(InvitationStatus.PENDING);
      const expiryDays = ((update.expiresAt as Date).getTime() - before) / (24 * 60 * 60 * 1000);
      expect(expiryDays).toBeGreaterThan(6.9);
      expect(expiryDays).toBeLessThan(7.1);
      expect(renewed.inviteCode).toBe(update.inviteCode);
      expect(mailDelivery.send).toHaveBeenCalledTimes(1);
      const sent = mailDelivery.send.mock.calls[0][0];
      expect(sent.to).toBe('alice@example.com');
      expect(sent.text).toContain(`https://app.example.com/invite/${update.inviteCode}`);
      expect(sent.text).not.toContain('oldcode');
    });

    it('renews an email invite that expired unaccepted back to PENDING', async () => {
      const { invitationRepo, service } = createResendService(
        buildInvitation({ id: 'invite-1', status: InvitationStatus.EXPIRED }),
      );

      const renewed = await service.resendEmailInvitation('league-1', 'invite-1', 'owner-1');

      expect(renewed.status).toBe(InvitationStatus.PENDING);
      expect(invitationRepo.update).toHaveBeenCalledWith('invite-1', expect.objectContaining({
        status: InvitationStatus.PENDING,
      }));
    });

    it('refuses to resend a join link, and changes nothing', async () => {
      const { invitationRepo, service } = createResendService(
        buildInvitation({ id: 'link-1', inviteType: InviteType.LINK, email: undefined }),
      );

      await expect(service.resendEmailInvitation('league-1', 'link-1', 'owner-1')).rejects.toMatchObject({
        code: 'LEAGUE_INVITATION_NOT_RESENDABLE',
      });
      expect(invitationRepo.update).not.toHaveBeenCalled();
    });

    it.each([InvitationStatus.ACCEPTED, InvitationStatus.REVOKED])(
      'refuses to resend an email invite that is %s, and changes nothing',
      async (status) => {
        const { invitationRepo, service } = createResendService(buildInvitation({ id: 'invite-1', status }));

        await expect(service.resendEmailInvitation('league-1', 'invite-1', 'owner-1')).rejects.toBeInstanceOf(
          InvitationInvalidError,
        );
        expect(invitationRepo.update).not.toHaveBeenCalled();
      },
    );

    it('reports an invitation from another league as not found', async () => {
      const { service } = createResendService(buildInvitation({ id: 'invite-1', leagueId: 'other-league' }));

      await expect(service.resendEmailInvitation('league-1', 'invite-1', 'owner-1')).rejects.toBeInstanceOf(
        InvitationNotFoundError,
      );
    });

    it('fails the resend with a delivery error when the email cannot be sent', async () => {
      const { service } = createResendService(buildInvitation({ id: 'invite-1' }), {
        providerName: 'smtp',
        send: jest.fn().mockRejectedValue(new Error('SMTP down')),
      });

      await expect(service.resendEmailInvitation('league-1', 'invite-1', 'owner-1')).rejects.toBeInstanceOf(
        InvitationEmailDeliveryError,
      );
    });
  });

  describe('revokeInviteLink', () => {
    it('sets invitation status to REVOKED', async () => {
      const invitation = buildInvitation({ leagueId: 'league-1', inviteCode: 'abc123' });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
      await service.revokeInviteLink('league-1', 'abc123');
      expect(invitationRepo.update).toHaveBeenCalledWith(invitation.id, {
        status: InvitationStatus.REVOKED,
      });
    });

    it('throws InvitationNotFoundError for unknown code', async () => {
      const service = new InvitationService({
        invitations: createMockInvitationRepo(),
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
      await expect(service.revokeInviteLink('league-1', 'nope')).rejects.toThrow(
        InvitationNotFoundError,
      );
    });

    it('throws InvitationNotFoundError when league does not match', async () => {
      const invitation = buildInvitation({ leagueId: 'other-league', inviteCode: 'abc123' });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
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
      const squadRepo = createMockSquadRepo();
      const squadMembershipRepo = createMockSquadMembershipRepo();
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: membershipRepo,
        leagues: createMockLeagueRepo(),
        squads: squadRepo,
        squadMemberships: squadMembershipRepo,
        prisma: asPrismaClient(createMockProvisioningPrisma()),
        users: createProvisioningUsers(),
      });
      await service.acceptInvitation('valid-code', 'new-user');
      expect(membershipRepo.create).toHaveBeenCalledTimes(1);
      expect(squadRepo.create).toHaveBeenCalledTimes(1);
      expect(squadMembershipRepo.create).toHaveBeenCalledTimes(1);
      expect(membershipRepo.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ role: LeagueRole.MEMBER, userId: 'new-user' }));
      expect(invitationRepo.update).toHaveBeenCalled();
    });

    it('pool-master-d9x sends join success email after membership acceptance', async () => {
      const invitation = buildInvitation({
        id: 'invite-1',
        leagueId: 'league-1',
        inviteCode: 'valid-code',
        status: InvitationStatus.PENDING,
        expiresAt: new Date('2099-01-01'),
      });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const membershipRepo = createMockMembershipRepo();
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail-1' })),
      };
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: membershipRepo,
        leagues: createMockLeagueRepo({
          findById: jest.fn().mockResolvedValue(buildLeague({
            id: 'league-1',
            name: 'Mathworks',
            leagueCode: 'MATHWORKS',
          })),
        }),
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo(),
        prisma: asPrismaClient(createMockProvisioningPrisma()),
        mailDelivery,
        appBaseUrl: 'https://app.primetimecommissioner.com',
        users: createProvisioningUsers(),
      });

      await service.acceptInvitation('valid-code', 'new-user');

      expect(mailDelivery.send).toHaveBeenCalledTimes(1);
      expect(mailDelivery.send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'user.one@example.com',
        subject: 'Welcome to Mathworks',
        metadata: {
          templateKey: 'LEAGUE_JOIN_SUCCESS',
          leagueId: 'league-1',
          invitationId: 'invite-1',
        },
      }));
      const sentMessage = mailDelivery.send.mock.calls[0][0];
      expect(sentMessage.text).toContain('League code: MATHWORKS');
      expect(sentMessage.text).toContain("Team: User One's Team");
      expect(sentMessage.text).toContain('Open league: https://app.primetimecommissioner.com/league/MATHWORKS');
      expect(sentMessage.html).toContain('Prime Time Commissioner');
    });

    it('pool-master-d9x does not send duplicate success email for already-active members', async () => {
      const invitation = buildInvitation({
        id: 'invite-1',
        leagueId: 'league-1',
        inviteCode: 'valid-code',
        status: InvitationStatus.PENDING,
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(buildMembership({
          leagueId: 'league-1',
          userId: 'existing-user',
          status: LeagueMembershipStatus.ACTIVE,
        })),
      });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: jest.fn(),
      };
      const service = new InvitationService({
        invitations: createMockInvitationRepo({ findByCode: jest.fn().mockResolvedValue(invitation) }),
        memberships: membershipRepo,
        leagues: createMockLeagueRepo(),
        prisma: asPrismaClient(createMockProvisioningPrisma()),
        mailDelivery,
        users: createProvisioningUsers(),
      });

      await expect(service.acceptInvitation('valid-code', 'existing-user')).rejects.toThrow(
        InvitationInvalidError,
      );
      expect(mailDelivery.send).not.toHaveBeenCalled();
    });

    it('pool-master-d9x keeps accepted membership when success email delivery fails', async () => {
      const invitation = buildInvitation({
        id: 'invite-1',
        leagueId: 'league-1',
        inviteCode: 'valid-code',
        status: InvitationStatus.PENDING,
        expiresAt: new Date('2099-01-01'),
      });
      const membershipRepo = createMockMembershipRepo();
      const mailDelivery = {
        providerName: 'ses' as const,
        send: jest.fn().mockRejectedValue(new Error('SES rejected request')),
      };
      const service = new InvitationService({
        invitations: createMockInvitationRepo({ findByCode: jest.fn().mockResolvedValue(invitation) }),
        memberships: membershipRepo,
        leagues: createMockLeagueRepo(),
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo(),
        prisma: asPrismaClient(createMockProvisioningPrisma()),
        mailDelivery,
        appBaseUrl: 'https://app.primetimecommissioner.com',
        users: createProvisioningUsers(),
      });

      await expect(service.acceptInvitation('valid-code', 'new-user')).resolves.toEqual(
        expect.objectContaining({ id: 'new-membership-id' }),
      );
      expect(membershipRepo.create).toHaveBeenCalledTimes(1);
      expect(mailDelivery.send).toHaveBeenCalledTimes(1);
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
      const squadRepo = createMockSquadRepo({
        findById: jest.fn().mockResolvedValue({
          id: 'existing-squad-id',
          leagueId: 'league-1',
          createdBy: 'returning-user',
          name: "Returning User's Team",
          isActive: true,
          iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      });
      const squadMembershipRepo = createMockSquadMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue({
          id: 'inactive-squad-membership-id',
          squadId: 'existing-squad-id',
          leagueId: 'league-1',
          userId: 'returning-user',
          status: SquadMembershipStatus.INACTIVE,
          joinedAt: new Date('2026-01-01'),
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      });
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: membershipRepo,
        leagues: createMockLeagueRepo(),
        squads: squadRepo,
        squadMemberships: squadMembershipRepo,
        prisma: asPrismaClient(createMockProvisioningPrisma()),
        users: createProvisioningUsers(),
      });

      await service.acceptInvitation('valid-code', 'returning-user');

      expect(membershipRepo.create).not.toHaveBeenCalled();
      expect(membershipRepo.update).toHaveBeenCalledWith(
        inactiveMembership.id,
        expect.objectContaining({
          role: LeagueRole.MEMBER,
          status: LeagueMembershipStatus.ACTIVE,
        }),
      );
      expect(squadMembershipRepo.update).toHaveBeenCalledWith(
        'inactive-squad-membership-id',
        expect.objectContaining({
          status: SquadMembershipStatus.ACTIVE,
        }),
      );
    });

    it('throws InvitationNotFoundError for unknown code', async () => {
      const service = new InvitationService({
        invitations: createMockInvitationRepo(),
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
      await expect(service.acceptInvitation('unknown', 'user-1')).rejects.toThrow(
        InvitationNotFoundError,
      );
    });

    it('throws InvitationInvalidError for already accepted invitation', async () => {
      const invitation = buildInvitation({ status: InvitationStatus.ACCEPTED });
      const invitationRepo = createMockInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(invitation),
      });
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
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
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
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
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: membershipRepo,
        leagues: createMockLeagueRepo(),
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo(),
        prisma: asPrismaClient(createMockProvisioningPrisma()),
        users: createProvisioningUsers(),
      });
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
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: createMockMembershipRepo(),
        leagues: createMockLeagueRepo(),
        users: fakeUserRepo(),
      });
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
      const service = new InvitationService({
        invitations: invitationRepo,
        memberships: membershipRepo,
        leagues: createMockLeagueRepo(),
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo(),
        prisma: asPrismaClient(createMockProvisioningPrisma()),
        users: createProvisioningUsers(),
      });

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
