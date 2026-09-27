import { buildUser } from '../../factories';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadOwnerInvitationRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  SquadOwnerInvitationStatus,
  TeamIconKey,
} from '@poolmaster/shared/domain';
import {
  SquadOwnerInvitationService,
} from '../../../packages/core-api/src/modules/squads/owner-invitation-service';
import {
  fakeLeagueMembershipRepo,
  fakeSquadMembershipRepo,
  fakeSquadOwnerInvitationRepo,
  fakeSquadRepo,
  fakeUserRepo,
} from '../../support/repo-fakes';

function createMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return fakeLeagueMembershipRepo({
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'membership-new',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      id,
      leagueId: 'league-1',
      userId: 'user-2',
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...updates,
    })),
    ...overrides,
  });
}

function createSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return fakeSquadRepo({
    findById: jest.fn().mockResolvedValue({
      id: 'squad-1',
      leagueId: 'league-1',
      createdBy: 'user-1',
      name: 'Beer Bellies',
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    update: jest.fn().mockResolvedValue({
      id: 'squad-1',
      leagueId: 'league-1',
      createdBy: 'user-1',
      name: 'Beer Bellies',
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    ...overrides,
  });
}

function createSquadMembershipRepo(
  overrides: Partial<SquadMembershipRepository> = {},
): SquadMembershipRepository {
  return fakeSquadMembershipRepo({
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'squad-membership-new',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      id,
      squadId: 'squad-1',
      leagueId: 'league-1',
      userId: 'user-2',
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...updates,
    })),
    ...overrides,
  });
}

function createInvitationRepo(
  overrides: Partial<SquadOwnerInvitationRepository> = {},
): SquadOwnerInvitationRepository {
  return fakeSquadOwnerInvitationRepo({
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'invite-1',
      createdAt: new Date('2026-04-16T00:00:00Z'),
      updatedAt: new Date('2026-04-16T00:00:00Z'),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      id,
      leagueId: 'league-1',
      squadId: 'squad-1',
      email: 'invitee@example.com',
      inviteCode: 'invite-code',
      status: SquadOwnerInvitationStatus.ACCEPTED,
      invitedBy: 'user-1',
      createdAt: new Date('2026-04-16T00:00:00Z'),
      updatedAt: new Date('2026-04-16T00:00:00Z'),
      ...updates,
    })),
    ...overrides,
  });
}

function createPrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    league: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
      }),
    },
    ...overrides,
  } as any;
}

describe('SquadOwnerInvitationService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('rejects inviting an email that already belongs to a current league member', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockImplementation(async (_leagueId: string, userId: string) => {
        if (userId === 'user-1') {
          return {
            id: 'actor-membership',
            leagueId: 'league-1',
            userId: 'user-1',
            role: LeagueRole.COMMISSIONER,
            status: LeagueMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        if (userId === 'user-2') {
          return {
            id: 'target-membership',
            leagueId: 'league-1',
            userId: 'user-2',
            role: LeagueRole.MEMBER,
            status: LeagueMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      }),
    });
    const prisma = createPrisma();
    // #202 step 3.6 — the email lookup goes through `UserRepository.findByEmail`.
    const users = fakeUserRepo({ findByEmail: jest.fn().mockResolvedValue({ id: 'user-2', email: 'member@example.com' }) });
    const service = new SquadOwnerInvitationService(
      createInvitationRepo(),
      membershipRepo,
      createSquadRepo(),
      createSquadMembershipRepo(),
      users,
      prisma,
    );

    await expect(service.inviteOwner({
      leagueId: 'league-1',
      squadId: 'squad-1',
      actorUserId: 'user-1',
      email: 'member@example.com',
    })).rejects.toMatchObject({
      code: 'SQUAD_OWNER_INVITATION_LEAGUE_MEMBER_CONFLICT',
    });
  });

  it('immediately provisions an existing PoolMaster user from outside the league', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockImplementation(async (_leagueId: string, userId: string) => {
        if (userId === 'user-1') {
          return {
            id: 'actor-membership',
            leagueId: 'league-1',
            userId: 'user-1',
            role: LeagueRole.COMMISSIONER,
            status: LeagueMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      }),
    });
    const invitationRepo = createInvitationRepo();
    const squadMembershipRepo = createSquadMembershipRepo();
    const prisma = createPrisma();
    // #202 step 3.6 — the email lookup goes through `UserRepository.findByEmail`.
    const users = fakeUserRepo({ findByEmail: jest.fn().mockResolvedValue({ id: 'user-9', email: 'outside@example.com' }) });
    const service = new SquadOwnerInvitationService(
      invitationRepo,
      membershipRepo,
      createSquadRepo(),
      squadMembershipRepo,
      users,
      prisma,
    );

    const result = await service.inviteOwner({
      leagueId: 'league-1',
      squadId: 'squad-1',
      actorUserId: 'user-1',
      email: 'outside@example.com',
    });

    expect(membershipRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: 'league-1',
      userId: 'user-9',
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
    }));
    expect(squadMembershipRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      squadId: 'squad-1',
      userId: 'user-9',
      status: SquadMembershipStatus.ACTIVE,
    }));
    expect(invitationRepo.update).toHaveBeenCalledWith('invite-1', expect.objectContaining({
      status: SquadOwnerInvitationStatus.ACCEPTED,
      acceptedBy: 'user-9',
    }));
    expect(result.status).toBe(SquadOwnerInvitationStatus.ACCEPTED);
  });

  /**
   * #217 — `requireInvitationForRegistration`, the validator for the register-and-accept flow.
   *
   * It exists because the caller has no account yet, so there is no `userId` to key acceptance on.
   * Its job is to prove the invitation is usable AND to hand back the email the new account must
   * use — which is the whole security property of the flow.
   */
  describe('requireInvitationForRegistration (#217)', () => {
    function pendingInvitation(overrides: Record<string, unknown> = {}) {
      return {
        id: 'invite-1',
        leagueId: 'league-1',
        squadId: 'squad-1',
        email: 'stranger@example.com',
        inviteCode: 'invite-code',
        status: SquadOwnerInvitationStatus.PENDING,
        invitedBy: 'user-1',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: null,
        acceptedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
    }

    function createService(options: {
      invitation?: unknown;
      existingUser?: unknown;
      invitationRepo?: SquadOwnerInvitationRepository;
    } = {}) {
      const invitationRepo = options.invitationRepo ?? createInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(
          options.invitation === undefined ? pendingInvitation() : options.invitation,
        ),
      });
      return {
        invitationRepo,
        service: new SquadOwnerInvitationService(
          invitationRepo,
          createMembershipRepo(),
          createSquadRepo(),
          createSquadMembershipRepo(),
          fakeUserRepo({ findByEmail: jest.fn().mockResolvedValue(options.existingUser ?? null) }),
          createPrisma(),
        ),
      };
    }

    it('returns the INVITED email, not one the caller could supply', async () => {
      const { service } = createService();

      const result = await service.requireInvitationForRegistration('invite-code');

      // The security property, settled with the repo owner: bind to the invited email. A
      // squad-owner invitation grants league membership, so honouring an address from the request
      // would let a forwarded invite link admit an unintended person.
      expect(result.email).toBe('stranger@example.com');
      expect(result.invitation.leagueId).toBe('league-1');
      expect(result.invitation.squadId).toBe('squad-1');
    });

    it('refuses when the invited email already has an account', async () => {
      const { service } = createService({
        existingUser: { id: 'user-9', email: 'stranger@example.com' },
      });

      // This case never produces a pending invitation — `inviteOwner` provisions an existing user
      // straight away and marks it ACCEPTED. Reaching here means an account appeared between the
      // invite and the acceptance, and the answer is "sign in and accept", not "register again".
      await expect(service.requireInvitationForRegistration('invite-code')).rejects.toMatchObject({
        code: 'SQUAD_OWNER_INVITATION_ACCOUNT_EXISTS',
      });
    });

    it('refuses an invitation that is not pending', async () => {
      const { service } = createService({
        invitation: pendingInvitation({ status: SquadOwnerInvitationStatus.ACCEPTED }),
      });

      await expect(service.requireInvitationForRegistration('invite-code')).rejects.toMatchObject({
        code: 'SQUAD_OWNER_INVITATION_ALREADY_ACCEPTED',
      });
    });

    it('expires an invitation past its expiry rather than honouring it', async () => {
      const invitationRepo = createInvitationRepo({
        findByCode: jest.fn().mockResolvedValue(
          pendingInvitation({ expiresAt: new Date(Date.now() - 1_000) }),
        ),
        update: jest.fn().mockResolvedValue(
          pendingInvitation({ status: SquadOwnerInvitationStatus.EXPIRED }),
        ),
      });
      const { service } = createService({ invitationRepo });

      await expect(service.requireInvitationForRegistration('invite-code')).rejects.toMatchObject({
        code: 'SQUAD_OWNER_INVITATION_EXPIRED',
      });
      // Recorded, not just refused: the row is moved to EXPIRED so a later attempt reads the same.
      expect(invitationRepo.update).toHaveBeenCalledWith(
        'invite-1',
        expect.objectContaining({ status: SquadOwnerInvitationStatus.EXPIRED }),
      );
    });

    it('refuses an unknown invite code', async () => {
      const { service } = createService({ invitation: null });

      await expect(service.requireInvitationForRegistration('nope')).rejects.toThrow(
        /not found/i,
      );
    });
  });

  it('allows a root admin outsider to list invitations for any team in the league', async () => {
    const invitationRepo = createInvitationRepo({
      findByLeague: jest.fn().mockResolvedValue([
        {
          id: 'invite-1',
          leagueId: 'league-1',
          squadId: 'squad-1',
          email: 'invitee@example.com',
          inviteCode: 'invite-code',
          status: SquadOwnerInvitationStatus.PENDING,
          invitedBy: 'user-2',
          acceptedBy: null,
          acceptedAt: null,
          expiresAt: new Date('2026-04-23T00:00:00Z'),
          replacementForUserId: null,
          createdAt: new Date('2026-04-16T00:00:00Z'),
          updatedAt: new Date('2026-04-16T00:00:00Z'),
        },
      ]),
    });
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    });
    const service = new SquadOwnerInvitationService(
      invitationRepo,
      membershipRepo,
      createSquadRepo(),
      createSquadMembershipRepo(),
      fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) }),
      createPrisma(),
    );

    const result = await service.listInvitationsForViewer('league-1', 'root-admin-1', true);

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe(SquadOwnerInvitationStatus.PENDING);
    expect(invitationRepo.findByLeague).toHaveBeenCalledWith('league-1');
  });

  it('rejects replacing yourself as an owner', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue({
        id: 'actor-membership',
        leagueId: 'league-1',
        userId: 'user-1',
        role: LeagueRole.COMMISSIONER,
        status: LeagueMembershipStatus.ACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const service = new SquadOwnerInvitationService(
      createInvitationRepo(),
      membershipRepo,
      createSquadRepo(),
      createSquadMembershipRepo({
        findBySquadAndUser: jest.fn().mockResolvedValue({
          id: 'owner-membership',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'owner-membership-1',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-1',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'owner-membership-2',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-2',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      }),
      fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) }),
      createPrisma(),
    );

    await expect(service.replaceOwner({
      leagueId: 'league-1',
      squadId: 'squad-1',
      targetUserId: 'user-1',
      actorUserId: 'user-1',
      email: 'replacement@example.com',
    })).rejects.toMatchObject({
      code: 'SQUAD_OWNER_REPLACE_SELF_FORBIDDEN',
    });
  });

  it('rejects replace-owner when the team has fewer than two active owners', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue({
        id: 'actor-membership',
        leagueId: 'league-1',
        userId: 'user-1',
        role: LeagueRole.COMMISSIONER,
        status: LeagueMembershipStatus.ACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const service = new SquadOwnerInvitationService(
      createInvitationRepo(),
      membershipRepo,
      createSquadRepo(),
      createSquadMembershipRepo({
        findBySquadAndUser: jest.fn().mockResolvedValue({
          id: 'target-membership',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-2',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'target-membership',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-2',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      }),
      fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) }),
      createPrisma(),
    );

    await expect(service.replaceOwner({
      leagueId: 'league-1',
      squadId: 'squad-1',
      targetUserId: 'user-2',
      actorUserId: 'user-1',
      email: 'replacement@example.com',
    })).rejects.toMatchObject({
      code: 'SQUAD_OWNER_REPLACE_REQUIRES_MULTIPLE_OWNERS',
    });
  });
});
