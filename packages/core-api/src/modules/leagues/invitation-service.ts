/**
 * InvitationService — email invitations, invite links, and invitation acceptance.
 */

import type {
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import type { LeagueInvitation, LeagueMembership } from '@poolmaster/shared/domain';
import type { PrismaClient } from '@prisma/client';
import {
  InvitationStatus,
  InviteType,
  LeagueMembershipStatus,
  LeagueRole,
} from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';
import { ensureDefaultSquadForLeagueMember } from '../squads/default-squad';

export interface SendInvitationsInput {
  leagueId: string;
  emails: string[];
  invitedBy: string;
  message?: string;
}

export interface GenerateInviteLinkInput {
  leagueId: string;
  invitedBy: string;
  expiresInDays?: number;
  maxUses?: number;
}

export interface SendInvitationsResult {
  sent: LeagueInvitation[];
  skippedMembers: string[];
  skippedDuplicates: string[];
}

export interface InvitationPreview {
  inviteCode: string;
  status: InvitationStatus;
  league: {
    id: string;
    leagueCode: string;
    name: string;
  };
}

const DEFAULT_INVITE_EXPIRY_DAYS = 7;

export class InvitationService {
  constructor(
    private readonly invitationRepo: LeagueInvitationRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly leagueRepo: LeagueRepository,
    private readonly squadRepo?: SquadRepository,
    private readonly squadMembershipRepo?: SquadMembershipRepository,
    private readonly prisma?: PrismaClient,
  ) {}

  /** Creates email invitations, skipping existing members and pending duplicates. */
  async sendEmailInvitations(input: SendInvitationsInput): Promise<SendInvitationsResult> {
    await this.membershipRepo.findByLeague(input.leagueId);
    const memberEmails = new Set<string>();
    // Note: we don't have email on membership directly; this is a simplification.
    // In a full implementation we'd join with users. For now, skip based on pending invites.
    const sent: LeagueInvitation[] = [];
    const skippedMembers: string[] = [];
    const skippedDuplicates: string[] = [];
    for (const email of input.emails) {
      const normalised = email.toLowerCase().trim();
      if (memberEmails.has(normalised)) {
        skippedMembers.push(normalised);
        continue;
      }
      const existing = await this.invitationRepo.findByEmail(input.leagueId, normalised);
      if (existing) {
        skippedDuplicates.push(normalised);
        continue;
      }
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + DEFAULT_INVITE_EXPIRY_DAYS);
      const invitation = await this.invitationRepo.create({
        leagueId: input.leagueId,
        email: normalised,
        inviteCode: generateInviteCode(),
        inviteType: InviteType.EMAIL,
        status: InvitationStatus.PENDING,
        maxUses: 1,
        currentUses: 0,
        invitedBy: input.invitedBy,
        expiresAt,
      });
      sent.push(invitation);
    }
    return { sent, skippedMembers, skippedDuplicates };
  }

  /** Generates a shareable invite link for the league. */
  async generateInviteLink(input: GenerateInviteLinkInput): Promise<LeagueInvitation> {
    const expiresAt = input.expiresInDays
      ? (() => {
          const d = new Date();
          d.setDate(d.getDate() + input.expiresInDays!);
          return d;
        })()
      : undefined;
    return this.invitationRepo.create({
      leagueId: input.leagueId,
      inviteCode: generateInviteCode(),
      inviteType: InviteType.LINK,
      status: InvitationStatus.PENDING,
      maxUses: input.maxUses ?? 0, // 0 = unlimited
      currentUses: 0,
      invitedBy: input.invitedBy,
      expiresAt,
    });
  }

  /** Revokes an existing invite link. */
  async revokeInviteLink(leagueId: string, inviteCode: string): Promise<void> {
    const invitation = await this.invitationRepo.findByCode(inviteCode);
    if (!invitation || invitation.leagueId !== leagueId) {
      throw new InvitationNotFoundError(inviteCode);
    }
    await this.invitationRepo.update(invitation.id, {
      status: InvitationStatus.REVOKED,
    });
  }

  /** Accepts an invitation by code, creating or reactivating a MEMBER membership. */
  async acceptInvitation(inviteCode: string, userId: string): Promise<LeagueMembership> {
    const invitation = await this.invitationRepo.findByCode(inviteCode);
    if (!invitation) {
      throw new InvitationNotFoundError(inviteCode);
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new InvitationInvalidError(
        `Invitation is ${invitation.status.toLowerCase()}`,
        mapInvitationStatusCode(invitation.status),
      );
    }
    if (invitation.expiresAt && new Date() > invitation.expiresAt) {
      await this.invitationRepo.update(invitation.id, { status: InvitationStatus.EXPIRED });
      throw new InvitationInvalidError('Invitation has expired', 'LEAGUE_INVITATION_EXPIRED');
    }
    if (invitation.maxUses > 0 && invitation.currentUses >= invitation.maxUses) {
      throw new InvitationInvalidError(
        'Invitation has reached maximum uses',
        'LEAGUE_INVITATION_EXHAUSTED',
      );
    }
    const existingMembership = await this.membershipRepo.findByLeagueAndUser(
      invitation.leagueId,
      userId,
    );
    if (existingMembership) {
      if (existingMembership.status === LeagueMembershipStatus.ACTIVE) {
        throw new InvitationInvalidError(
          'You are already a member of this league',
          'LEAGUE_ALREADY_MEMBER',
        );
      }
    }
    const league = await this.leagueRepo.findById(invitation.leagueId);
    if (!league) {
      throw new InvitationInvalidError('League no longer exists', 'LEAGUE_NOT_FOUND');
    }
    const membership = existingMembership
      ? await this.membershipRepo.update(existingMembership.id, {
          role: LeagueRole.MEMBER,
          status: LeagueMembershipStatus.ACTIVE,
          joinedAt: new Date(),
        })
      : await this.membershipRepo.create({
          leagueId: invitation.leagueId,
          userId,
          role: LeagueRole.MEMBER,
          status: LeagueMembershipStatus.ACTIVE,
          joinedAt: new Date(),
        });

    await this.ensureDefaultSquad(invitation.leagueId, userId);

    const newUses = invitation.currentUses + 1;
    const isFullyUsed = invitation.maxUses > 0 && newUses >= invitation.maxUses;
    await this.invitationRepo.update(invitation.id, {
      currentUses: newUses,
      acceptedAt: new Date(),
      acceptedBy: userId,
      ...(isFullyUsed && { status: InvitationStatus.ACCEPTED }),
    });
    return membership;
  }

  private async ensureDefaultSquad(leagueId: string, userId: string): Promise<void> {
    if (!this.squadRepo || !this.squadMembershipRepo || !this.prisma) {
      return;
    }

    await ensureDefaultSquadForLeagueMember({
      leagueId,
      userId,
      squadRepo: this.squadRepo,
      squadMembershipRepo: this.squadMembershipRepo,
      prisma: this.prisma,
    });
  }

  async getInvitationPreview(inviteCode: string): Promise<InvitationPreview> {
    const invitation = await this.invitationRepo.findByCode(inviteCode);
    if (!invitation) {
      throw new InvitationNotFoundError(inviteCode);
    }

    const league = await this.leagueRepo.findById(invitation.leagueId);
    if (!league) {
      throw new InvitationInvalidError('League no longer exists', 'LEAGUE_NOT_FOUND');
    }

    return {
      inviteCode: invitation.inviteCode,
      status: invitation.status,
      league: {
        id: league.id,
        leagueCode: league.leagueCode,
        name: league.name,
      },
    };
  }
}

/** Generates a short, URL-safe invite code. */
function generateInviteCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

export class InvitationNotFoundError extends Error {
  constructor(code: string) {
    super(`Invitation not found: ${code}`);
    this.name = 'InvitationNotFoundError';
  }
}

export class InvitationInvalidError extends Error {
  code: string;

  constructor(reason: string, code = 'LEAGUE_INVITATION_INVALID') {
    super(reason);
    this.name = 'InvitationInvalidError';
    this.code = code;
  }
}

function mapInvitationStatusCode(status: InvitationStatus): string {
  switch (status) {
    case InvitationStatus.ACCEPTED:
      return 'LEAGUE_INVITATION_ALREADY_ACCEPTED';
    case InvitationStatus.REVOKED:
      return 'LEAGUE_INVITATION_REVOKED';
    case InvitationStatus.EXPIRED:
      return 'LEAGUE_INVITATION_EXPIRED';
    default:
      return 'LEAGUE_INVITATION_INVALID';
  }
}
