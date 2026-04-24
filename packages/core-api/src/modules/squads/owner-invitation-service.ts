import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadOwnerInvitationRepository,
  SquadRepository,
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
  SquadStatus,
} from '@poolmaster/shared/domain';
import type {
  TeamOwnerInvitationDto,
  TeamOwnerInvitationPreviewResponse,
} from '@poolmaster/shared/dto';

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
    private readonly prisma: PrismaClient,
  ) {}

  async listInvitations(leagueId: string, actorUserId: string): Promise<TeamOwnerInvitationDto[]> {
    return this.listInvitationsForViewer(leagueId, actorUserId, false);
  }

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

    const activeOwners = await this.squadMembershipRepo.findBySquad(input.squadId);
    if (activeOwners.length < 2) {
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

    await this.squadMembershipRepo.update(targetMembership.id, {
      status: SquadMembershipStatus.INACTIVE,
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
      status: invitation.status as SquadOwnerInvitationStatus,
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

  async acceptInvitation(inviteCode: string, userId: string): Promise<TeamOwnerInvitationDto> {
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

    await this.rejectIfCurrentLeagueMember(invitation.leagueId, userId);
    await this.provisionOwnerOnSquad(invitation.leagueId, invitation.squadId, userId);

    const accepted = await this.invitationRepo.update(invitation.id, {
      status: SharedSquadOwnerInvitationStatus.ACCEPTED,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });
    return this.mapInvitationDto(accepted);
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

  private async requireActiveSquad(leagueId: string, squadId: string) {
    const squad = await this.squadRepo.findById(squadId);
    if (!squad || squad.leagueId !== leagueId) {
      throw new SquadOwnerInvitationNotFoundError(`Team not found: ${squadId}`);
    }
    if (squad.status !== SquadStatus.ACTIVE) {
      throw new SquadOwnerInvitationOperationError(
        'Team-owner invites require an active team',
        'SQUAD_INACTIVE',
      );
    }
    return squad;
  }

  private async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
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

    const squad = await this.squadRepo.findById(squadId);
    if (squad && squad.status !== SquadStatus.ACTIVE) {
      await this.squadRepo.update(squadId, { status: SquadStatus.ACTIVE });
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
      status: invitation.status as SquadOwnerInvitationStatus,
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
