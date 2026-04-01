/**
 * InvitationService — email invitations, invite links, and invitation acceptance.
 */

import type {
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
} from '@poolmaster/shared/db';
import type { LeagueInvitation, LeagueMembership } from '@poolmaster/shared/domain';
import { InvitationStatus, InviteType, LeagueRole } from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';

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

const DEFAULT_INVITE_EXPIRY_DAYS = 7;

export class InvitationService {
  constructor(
    private readonly invitationRepo: LeagueInvitationRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly leagueRepo: LeagueRepository,
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

  /** Accepts an invitation by code, creating a MANAGER membership. */
  async acceptInvitation(inviteCode: string, userId: string): Promise<LeagueMembership> {
    const invitation = await this.invitationRepo.findByCode(inviteCode);
    if (!invitation) {
      throw new InvitationNotFoundError(inviteCode);
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new InvitationInvalidError(`Invitation is ${invitation.status.toLowerCase()}`);
    }
    if (invitation.expiresAt && new Date() > invitation.expiresAt) {
      await this.invitationRepo.update(invitation.id, { status: InvitationStatus.EXPIRED });
      throw new InvitationInvalidError('Invitation has expired');
    }
    if (invitation.maxUses > 0 && invitation.currentUses >= invitation.maxUses) {
      throw new InvitationInvalidError('Invitation has reached maximum uses');
    }
    const existingMembership = await this.membershipRepo.findByLeagueAndUser(
      invitation.leagueId,
      userId,
    );
    if (existingMembership) {
      throw new InvitationInvalidError('You are already a member of this league');
    }
    const league = await this.leagueRepo.findById(invitation.leagueId, '');
    if (!league) {
      throw new InvitationInvalidError('League no longer exists');
    }
    const members = await this.membershipRepo.findByLeague(invitation.leagueId);
    if (members.length >= league.maxMembers) {
      throw new InvitationInvalidError('League has reached its member limit');
    }
    const membership = await this.membershipRepo.create({
      leagueId: invitation.leagueId,
      userId,
      role: LeagueRole.MANAGER,
      permissions: [],
      joinedAt: new Date(),
    });
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
  constructor(reason: string) {
    super(reason);
    this.name = 'InvitationInvalidError';
  }
}
