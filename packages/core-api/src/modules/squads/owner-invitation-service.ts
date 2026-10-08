import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadOwnerInvitationRepository,
  SquadRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import type {
  SquadOwnerInvitation,
  SquadOwnerInvitationStatus,
} from '@poolmaster/shared/domain';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  SquadOwnerInvitationStatus as SharedSquadOwnerInvitationStatus,
} from '@poolmaster/shared/domain';
import type {
  TeamOwnerInvitationDto,
  TeamOwnerInvitationPreviewResponse,
} from '@poolmaster/shared/dto';
import {
  inactivateLeagueMemberUnit,
  LastCommissionerError,
  requireAnotherActiveCommissioner,
} from '../leagues/member-lifecycle';

const DEFAULT_OWNER_INVITE_EXPIRY_DAYS = 7;

interface InviteOwnerInput {
  leagueId: string;
  squadId: string;
  actorUserId: string;
  actorIsRootAdmin?: boolean;
  email: string;
}

interface ReplaceOwnerInput extends InviteOwnerInput {
  targetUserId: string;
}

export class SquadOwnerInvitationService {
  constructor(
    private readonly invitationRepo: SquadOwnerInvitationRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly squadRepo: SquadRepository,
    private readonly squadMembershipRepo: SquadMembershipRepository,
    private readonly users: UserRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async listInvitationsForViewer(
    leagueId: string,
    actorUserId: string,
    actorIsRootAdmin: boolean,
  ): Promise<TeamOwnerInvitationDto[]> {
    const { isCommissioner, isRootAdmin, actorSquadMembership } = await this.requireActorContext(
      leagueId,
      actorUserId,
      actorIsRootAdmin,
    );
    const invitations = await this.invitationRepo.findByLeague(leagueId);
    const visibleInvitations = isRootAdmin || isCommissioner
      ? invitations
      : invitations.filter((invitation) => invitation.squadId === actorSquadMembership!.squadId);
    return this.mapInvitationDtos(visibleInvitations);
  }

  async inviteOwner(input: InviteOwnerInput): Promise<TeamOwnerInvitationDto> {
    const normalizedEmail = normalizeEmail(input.email);
    await this.requireActorCanManageSquad(
      input.leagueId,
      input.squadId,
      input.actorUserId,
      input.actorIsRootAdmin ?? false,
    );
    await this.requireActiveLeague(input.leagueId);
    await this.requireActiveSquad(input.leagueId, input.squadId);

    const duplicate = await this.invitationRepo.findPendingByLeagueAndEmail(
      input.leagueId,
      normalizedEmail,
    );
    if (duplicate) {
      throw new SquadOwnerInvitationOperationError(
        'A pending team-owner invitation already exists for this email in the league',
        'SQUAD_OWNER_INVITATION_DUPLICATE',
      );
    }

    const existingUser = await this.findUserByEmail(normalizedEmail);
    await this.rejectIfCurrentLeagueMember(input.leagueId, existingUser?.id);

    const invitation = await this.invitationRepo.create({
      leagueId: input.leagueId,
      squadId: input.squadId,
      email: normalizedEmail,
      inviteCode: generateInviteCode(),
      status: SharedSquadOwnerInvitationStatus.PENDING,
      invitedBy: input.actorUserId,
      expiresAt: buildDefaultExpiry(),
    });

    if (existingUser) {
      await this.provisionOwnerOnSquad(input.leagueId, input.squadId, existingUser.id);
      const accepted = await this.invitationRepo.update(invitation.id, {
        status: SharedSquadOwnerInvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
        acceptedBy: existingUser.id,
      });
      return this.mapInvitationDto(accepted);
    }

    return this.mapInvitationDto(invitation);
  }

  async replaceOwner(input: ReplaceOwnerInput): Promise<TeamOwnerInvitationDto> {
    const normalizedEmail = normalizeEmail(input.email);
    const context = await this.requireActorCanManageSquad(
      input.leagueId,
      input.squadId,
      input.actorUserId,
      input.actorIsRootAdmin ?? false,
    );
    await this.requireActiveLeague(input.leagueId);
    await this.requireActiveSquad(input.leagueId, input.squadId);

    if (input.actorUserId === input.targetUserId) {
      throw new SquadOwnerInvitationOperationError(
        'You cannot replace yourself as a team owner',
        'SQUAD_OWNER_REPLACE_SELF_FORBIDDEN',
      );
    }

    const targetMembership = await this.squadMembershipRepo.findBySquadAndUser(
      input.squadId,
      input.targetUserId,
    );
    if (!targetMembership || targetMembership.status !== SquadMembershipStatus.ACTIVE) {
      throw new SquadOwnerInvitationNotFoundError(
        `Active team owner not found for user ${input.targetUserId}`,
      );
    }

    // A commissioner or root admin may hand a team's only owner seat to someone new, so an
    // abandoned team can change hands. An owner replaces a co-owner, which needs two.
    const actorRunsLeague = context.isRootAdmin || context.isCommissioner;
    const activeOwners = await this.squadMembershipRepo.findBySquad(input.squadId);
    if (activeOwners.length < 2 && !actorRunsLeague) {
      throw new SquadOwnerInvitationOperationError(
        'Replace owner requires at least two active owners on the team',
        'SQUAD_OWNER_REPLACE_REQUIRES_MULTIPLE_OWNERS',
      );
    }

    if (!context.isRootAdmin && !context.isCommissioner && context.actorSquadMembership?.userId !== input.actorUserId) {
      throw new SquadOwnerInvitationOperationError(
        'Only an active owner on the team can replace another owner',
        'SQUAD_OWNER_REPLACE_FORBIDDEN',
      );
    }

    const duplicate = await this.invitationRepo.findPendingByLeagueAndEmail(
      input.leagueId,
      normalizedEmail,
    );
    if (duplicate) {
      throw new SquadOwnerInvitationOperationError(
        'A pending team-owner invitation already exists for this email in the league',
        'SQUAD_OWNER_INVITATION_DUPLICATE',
      );
    }

    const existingUser = await this.findUserByEmail(normalizedEmail);
    await this.rejectIfCurrentLeagueMember(input.leagueId, existingUser?.id);
    await this.requireAnotherActiveCommissioner(input.leagueId, input.targetUserId);

    const invitation = await this.invitationRepo.create({
      leagueId: input.leagueId,
      squadId: input.squadId,
      email: normalizedEmail,
      inviteCode: generateInviteCode(),
      status: SharedSquadOwnerInvitationStatus.PENDING,
      invitedBy: input.actorUserId,
      expiresAt: buildDefaultExpiry(),
      replacementForUserId: input.targetUserId,
    });

    // A user belongs to a league only while they own a team in it, so losing their seat ends
    // their league membership too — the same unit `SquadService.removeOwner` uses. At least one
    // other owner remains (checked above), so the team itself stays active.
    await inactivateLeagueMemberUnit({
      leagueId: input.leagueId,
      userId: input.targetUserId,
      membershipRepo: this.membershipRepo,
      squadRepo: this.squadRepo,
      squadMembershipRepo: this.squadMembershipRepo,
    });
    // Replacing a sole owner leaves the team ownerless until the replacement accepts, and the
    // unit above inactivates an ownerless team. It is being handed on, not closed, so it stays
    // active and keeps its entries.
    if (activeOwners.length < 2) {
      await this.squadRepo.update(input.squadId, { isActive: true });
    }

    if (existingUser) {
      await this.provisionOwnerOnSquad(input.leagueId, input.squadId, existingUser.id);
      const accepted = await this.invitationRepo.update(invitation.id, {
        status: SharedSquadOwnerInvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
        acceptedBy: existingUser.id,
      });
      return this.mapInvitationDto(accepted);
    }

    return this.mapInvitationDto(invitation);
  }

  async revokeInvitation(
    leagueId: string,
    invitationId: string,
    actorUserId: string,
    actorIsRootAdmin = false,
  ): Promise<TeamOwnerInvitationDto> {
    const invitation = await this.invitationRepo.findById(invitationId);
    if (!invitation || invitation.leagueId !== leagueId) {
      throw new SquadOwnerInvitationNotFoundError(`Team-owner invitation not found: ${invitationId}`);
    }
    await this.requireActorCanManageSquad(
      leagueId,
      invitation.squadId,
      actorUserId,
      actorIsRootAdmin,
    );
    if (invitation.status !== SharedSquadOwnerInvitationStatus.PENDING) {
      throw new SquadOwnerInvitationOperationError(
        'Only pending team-owner invitations can be revoked',
        'SQUAD_OWNER_INVITATION_NOT_PENDING',
      );
    }
    const updated = await this.invitationRepo.update(invitation.id, {
      status: SharedSquadOwnerInvitationStatus.REVOKED,
    });
    return this.mapInvitationDto(updated);
  }

  async getInvitationPreview(inviteCode: string): Promise<TeamOwnerInvitationPreviewResponse['invitation']> {
    const invitation = await this.invitationRepo.findByCode(inviteCode);
    if (!invitation) {
      throw new SquadOwnerInvitationNotFoundError(`Team-owner invitation not found: ${inviteCode}`);
    }
    const squad = await this.squadRepo.findById(invitation.squadId);
    const league = await this.prisma.league.findUnique({ where: { id: invitation.leagueId } });
    if (!squad || !league) {
      throw new SquadOwnerInvitationOperationError(
        'Team-owner invitation target is no longer available',
        'SQUAD_OWNER_INVITATION_TARGET_MISSING',
      );
    }
    return {
      inviteCode: invitation.inviteCode,
      status: invitation.status,
      league: {
        id: league.id,
        leagueCode: league.leagueCode,
        name: league.name,
      },
      team: {
        id: squad.id,
        name: squad.name,
        iconKey: squad.iconKey,
      },
      roleAfterAccept: LeagueRole.MEMBER,
    };
  }

  /**
   * Validates a pending invitation for the register-and-accept flow, and returns the email the
   * new account must use (#217).
   *
   * Separate from `acceptInvitation` because the caller has no account yet, so there is no
   * `userId` to key acceptance on. The route validates first, registers with the email this
   * returns, then calls `acceptInvitation` with the new user's id.
   *
   * It refuses an email that already has an account, because that case never produces a pending
   * invitation: `inviteOwner` provisions an existing user immediately and marks the invitation
   * ACCEPTED. Reaching here with one means the account was created between the invite and the
   * acceptance, and the right answer is "sign in and accept", not "register again".
   */
  async requireInvitationForRegistration(inviteCode: string): Promise<{
    invitation: SquadOwnerInvitation;
    email: string;
  }> {
    const invitation = await this.requirePendingInvitation(inviteCode);
    const existingUser = await this.findUserByEmail(invitation.email);
    if (existingUser) {
      throw new SquadOwnerInvitationOperationError(
        'An account already exists for this invitation. Sign in to accept it.',
        'SQUAD_OWNER_INVITATION_ACCOUNT_EXISTS',
      );
    }

    // The invited address, not one supplied by the caller. A squad-owner invitation grants league
    // membership, so a forwarded link must not let a different person register into the league.
    return { invitation, email: invitation.email };
  }

  /**
   * The PENDING-and-unexpired check, shared by both acceptance paths. It also refuses a team that
   * has gone inactive since the invitation was sent: removing a team's last owner inactivates it
   * and leaves its pending invitations in place, and accepting one must not revive it (#488).
   */
  private async requirePendingInvitation(inviteCode: string): Promise<SquadOwnerInvitation> {
    const invitation = await this.invitationRepo.findByCode(inviteCode);
    if (!invitation) {
      throw new SquadOwnerInvitationNotFoundError(`Team-owner invitation not found: ${inviteCode}`);
    }
    if (invitation.status !== SharedSquadOwnerInvitationStatus.PENDING) {
      throw new SquadOwnerInvitationOperationError(
        `Invitation is ${invitation.status.toLowerCase()}`,
        mapInvitationStatusCode(invitation.status),
      );
    }
    if (invitation.expiresAt && new Date() > invitation.expiresAt) {
      const expired = await this.invitationRepo.update(invitation.id, {
        status: SharedSquadOwnerInvitationStatus.EXPIRED,
      });
      throw new SquadOwnerInvitationOperationError(
        'Invitation has expired',
        mapInvitationStatusCode(expired.status),
      );
    }
    await this.requireActiveLeague(invitation.leagueId);
    const squad = await this.squadRepo.findById(invitation.squadId);
    if (!squad?.isActive) {
      throw new SquadOwnerInvitationOperationError(
        'This team is no longer active, so its invitation cannot be accepted.',
        'SQUAD_INACTIVE',
      );
    }
    return invitation;
  }

  async acceptInvitation(inviteCode: string, userId: string): Promise<TeamOwnerInvitationDto> {
    const invitation = await this.requirePendingInvitation(inviteCode);

    await this.rejectIfCurrentLeagueMember(invitation.leagueId, userId);
    // The invitation is for the address it was sent to; a forwarded code must not admit someone
    // else. Registration enforces the same by creating the account with the invited email.
    const user = await this.users.findById(userId);
    if (normalizeEmail(user?.email ?? '') !== normalizeEmail(invitation.email)) {
      throw new SquadOwnerInvitationOperationError(
        'This invitation was sent to a different email address. Sign in with that address to accept it.',
        'SQUAD_OWNER_INVITATION_EMAIL_MISMATCH',
      );
    }
    await this.provisionOwnerOnSquad(invitation.leagueId, invitation.squadId, userId);

    const accepted = await this.invitationRepo.update(invitation.id, {
      status: SharedSquadOwnerInvitationStatus.ACCEPTED,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });
    return this.mapInvitationDto(accepted);
  }

  /** The shared last-commissioner rule, raised as this module's operation error. */
  private async requireAnotherActiveCommissioner(leagueId: string, targetUserId: string) {
    try {
      await requireAnotherActiveCommissioner({
        leagueId,
        targetUserId,
        membershipRepo: this.membershipRepo,
      });
    } catch (err) {
      if (err instanceof LastCommissionerError) {
        throw new SquadOwnerInvitationOperationError(err.message, err.code);
      }
      throw err;
    }
  }

  private async requireActiveLeagueMembership(leagueId: string, userId: string) {
    const membership = await this.membershipRepo.findByLeagueAndUser(leagueId, userId);
    if (!membership || membership.status !== LeagueMembershipStatus.ACTIVE) {
      throw new SquadOwnerInvitationOperationError(
        'You must be an active league member to manage team owners',
        'LEAGUE_MEMBERSHIP_REQUIRED',
      );
    }
    return membership;
  }

  private async requireActorContext(
    leagueId: string,
    actorUserId: string,
    actorIsRootAdmin: boolean,
  ) {
    if (actorIsRootAdmin) {
      const membership = await this.membershipRepo.findByLeagueAndUser(leagueId, actorUserId);
      const isActiveMember = membership?.status === LeagueMembershipStatus.ACTIVE;
      return {
        membership: isActiveMember ? membership : null,
        isCommissioner: isActiveMember ? membership.role === LeagueRole.COMMISSIONER : false,
        isRootAdmin: true,
        actorSquadMembership: null,
      };
    }

    const membership = await this.requireActiveLeagueMembership(leagueId, actorUserId);
    const isCommissioner = membership.role === LeagueRole.COMMISSIONER;
    const actorSquadMembership = isCommissioner
      ? null
      : await this.squadMembershipRepo.findByLeagueAndUser(leagueId, actorUserId);
    if (!isCommissioner && (!actorSquadMembership || actorSquadMembership.status !== SquadMembershipStatus.ACTIVE)) {
      throw new SquadOwnerInvitationOperationError(
        'You must be an active team owner to manage co-owners',
        'SQUAD_OWNER_REQUIRED',
      );
    }
    return { membership, isCommissioner, isRootAdmin: false, actorSquadMembership };
  }

  private async requireActorCanManageSquad(
    leagueId: string,
    squadId: string,
    actorUserId: string,
    actorIsRootAdmin: boolean,
  ) {
    const context = await this.requireActorContext(leagueId, actorUserId, actorIsRootAdmin);
    if (context.isRootAdmin) {
      await this.requireActiveSquad(leagueId, squadId);
      return context;
    }
    if (context.isCommissioner) {
      return context;
    }
    if (context.actorSquadMembership?.squadId !== squadId) {
      throw new SquadOwnerInvitationOperationError(
        'You may only manage co-owners for your own team',
        'SQUAD_OWNER_SCOPE_FORBIDDEN',
      );
    }
    return context;
  }

  /** An inactive league is read-only, so it neither issues nor honours owner invitations. */
  private async requireActiveLeague(leagueId: string) {
    const league = await this.prisma.league.findUnique({ where: { id: leagueId } });
    if (league && !league.isActive) {
      throw new SquadOwnerInvitationOperationError(
        'This league is inactive. Reactivate it before inviting or adding team owners.',
        'LEAGUE_INACTIVE',
      );
    }
  }

  private async requireActiveSquad(leagueId: string, squadId: string) {
    const squad = await this.squadRepo.findById(squadId);
    if (!squad || squad.leagueId !== leagueId) {
      throw new SquadOwnerInvitationNotFoundError(`Team not found: ${squadId}`);
    }
    if (!squad.isActive) {
      throw new SquadOwnerInvitationOperationError(
        'Team-owner invites require an active team',
        'SQUAD_INACTIVE',
      );
    }
    return squad;
  }

  private async findUserByEmail(email: string) {
    // #202 step 3.6 — through the port. `findByEmail` existed for exactly this.
    return this.users.findByEmail(email);
  }

  private async rejectIfCurrentLeagueMember(leagueId: string, userId?: string) {
    if (!userId) {
      return;
    }
    const existingMembership = await this.membershipRepo.findByLeagueAndUser(leagueId, userId);
    if (existingMembership?.status === LeagueMembershipStatus.ACTIVE) {
      throw new SquadOwnerInvitationOperationError(
        'That email already belongs to a current league member',
        'SQUAD_OWNER_INVITATION_LEAGUE_MEMBER_CONFLICT',
      );
    }
  }

  private async provisionOwnerOnSquad(leagueId: string, squadId: string, userId: string) {
    const existingMembership = await this.membershipRepo.findByLeagueAndUser(leagueId, userId);
    if (existingMembership) {
      if (existingMembership.status === LeagueMembershipStatus.ACTIVE) {
        throw new SquadOwnerInvitationOperationError(
          'That user already belongs to this league',
          'SQUAD_OWNER_INVITATION_LEAGUE_MEMBER_CONFLICT',
        );
      }
      await this.membershipRepo.update(existingMembership.id, {
        role: LeagueRole.MEMBER,
        status: LeagueMembershipStatus.ACTIVE,
        joinedAt: new Date(),
      });
    } else {
      await this.membershipRepo.create({
        leagueId,
        userId,
        role: LeagueRole.MEMBER,
        status: LeagueMembershipStatus.ACTIVE,
        joinedAt: new Date(),
      });
    }

    const squadMembership = await this.squadMembershipRepo.findByLeagueAndUser(leagueId, userId);
    if (squadMembership) {
      if (squadMembership.status === SquadMembershipStatus.ACTIVE && squadMembership.squadId !== squadId) {
        throw new SquadOwnerInvitationOperationError(
          'That user already belongs to another team in this league',
          'SQUAD_OWNER_INVITATION_SQUAD_CONFLICT',
        );
      }
      if (squadMembership.status === SquadMembershipStatus.ACTIVE) {
        return;
      }
      await this.squadMembershipRepo.update(squadMembership.id, {
        squadId,
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date(),
      });
    } else {
      await this.squadMembershipRepo.create({
        squadId,
        leagueId,
        userId,
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date(),
      });
    }
  }

  private async mapInvitationDtos(
    invitations: SquadOwnerInvitation[],
  ): Promise<TeamOwnerInvitationDto[]> {
    return Promise.all(invitations.map((invitation) => this.mapInvitationDto(invitation)));
  }

  private async mapInvitationDto(
    invitation: SquadOwnerInvitation,
  ): Promise<TeamOwnerInvitationDto> {
    const squad = await this.squadRepo.findById(invitation.squadId);
    if (!squad) {
      throw new SquadOwnerInvitationOperationError(
        'Invitation target team no longer exists',
        'SQUAD_OWNER_INVITATION_TARGET_MISSING',
      );
    }
    return {
      id: invitation.id,
      leagueId: invitation.leagueId,
      squadId: invitation.squadId,
      email: invitation.email,
      inviteCode: invitation.inviteCode,
      status: invitation.status,
      invitedBy: invitation.invitedBy,
      acceptedBy: invitation.acceptedBy ?? null,
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      expiresAt: invitation.expiresAt?.toISOString() ?? null,
      replacementForUserId: invitation.replacementForUserId ?? null,
      createdAt: invitation.createdAt.toISOString(),
      updatedAt: invitation.updatedAt.toISOString(),
      team: {
        id: squad.id,
        name: squad.name,
        iconKey: squad.iconKey,
      },
    };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function buildDefaultExpiry(): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + DEFAULT_OWNER_INVITE_EXPIRY_DAYS);
  return expiresAt;
}

function generateInviteCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

function mapInvitationStatusCode(status: SquadOwnerInvitationStatus): string {
  switch (status) {
    case SharedSquadOwnerInvitationStatus.ACCEPTED:
      return 'SQUAD_OWNER_INVITATION_ALREADY_ACCEPTED';
    case SharedSquadOwnerInvitationStatus.REVOKED:
      return 'SQUAD_OWNER_INVITATION_REVOKED';
    case SharedSquadOwnerInvitationStatus.EXPIRED:
      return 'SQUAD_OWNER_INVITATION_EXPIRED';
    default:
      return 'SQUAD_OWNER_INVITATION_INVALID';
  }
}

export class SquadOwnerInvitationNotFoundError extends Error {}

export class SquadOwnerInvitationOperationError extends Error {
  code: string;

  constructor(message: string, code = 'SQUAD_OWNER_INVITATION_INVALID') {
    super(message);
    this.code = code;
  }
}
