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
import type { FastifyBaseLogger } from 'fastify';
import {
  InvitationStatus,
  InviteType,
  LeagueMembershipStatus,
  LeagueRole,
} from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';
import { ensureDefaultSquadForLeagueMember } from '../squads/default-squad';
import {
  renderSystemEmailTemplate,
  type MailDeliveryProvider,
} from '../email';

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
const DEFAULT_INVITER_NAME = 'League commissioner';

export class InvitationEmailDeliveryError extends Error {
  constructor(
    readonly invitationId: string,
    readonly email: string,
    cause: unknown,
  ) {
    super(`Failed to deliver league invitation email: ${invitationId}`);
    this.name = 'InvitationEmailDeliveryError';
    this.cause = cause;
  }
}

export class InvitationService {
  constructor(
    private readonly invitationRepo: LeagueInvitationRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly leagueRepo: LeagueRepository,
    private readonly squadRepo?: SquadRepository,
    private readonly squadMembershipRepo?: SquadMembershipRepository,
    private readonly prisma?: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
    private readonly mailDelivery?: MailDeliveryProvider,
    private readonly appBaseUrl = 'http://localhost:5173',
  ) {}

  /** Creates email invitations, skipping existing members and pending duplicates. */
  async sendEmailInvitations(input: SendInvitationsInput): Promise<SendInvitationsResult> {
    this.logger?.debug({
      action: 'leagueInvitation.sendEmail.enter',
      data: {
        leagueId: input.leagueId,
        invitedBy: input.invitedBy,
        emailCount: input.emails.length,
      },
    }, 'Sending league email invitations');
    await this.membershipRepo.findByLeague(input.leagueId);
    const [league, inviterName] = await Promise.all([
      this.leagueRepo.findById(input.leagueId),
      this.resolveInviterName(input.invitedBy),
    ]);
    const memberEmails = new Set<string>();
    // Note: we don't have email on membership directly; this is a simplification.
    // In a full implementation we'd join with users. For now, skip based on pending invites.
    const sent: LeagueInvitation[] = [];
    const skippedMembers: string[] = [];
    const skippedDuplicates: string[] = [];
    for (const email of input.emails) {
      const normalised = email.toLowerCase().trim();
      if (memberEmails.has(normalised)) {
        this.logger?.warn({
          action: 'leagueInvitation.sendEmail.skippedMember',
          data: { leagueId: input.leagueId, invitedBy: input.invitedBy },
        }, 'Skipped invitation for existing member email');
        skippedMembers.push(normalised);
        continue;
      }
      const existing = await this.invitationRepo.findByEmail(input.leagueId, normalised);
      if (existing) {
        this.logger?.warn({
          action: 'leagueInvitation.sendEmail.skippedDuplicate',
          data: { leagueId: input.leagueId, invitedBy: input.invitedBy },
        }, 'Skipped duplicate pending invitation');
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
      await this.deliverLeagueInvitationEmail({
        invitationId: invitation.id,
        email: normalised,
        inviterName,
        leagueName: league?.name ?? 'your league',
        leagueCode: league?.leagueCode ?? input.leagueId,
        inviteCode: invitation.inviteCode,
        expiresAt,
        message: input.message,
      });
      sent.push(invitation);
    }
    this.logger?.info({
      action: 'leagueInvitation.sendEmail.success',
      data: {
        leagueId: input.leagueId,
        invitedBy: input.invitedBy,
        sentCount: sent.length,
        skippedMemberCount: skippedMembers.length,
        skippedDuplicateCount: skippedDuplicates.length,
      },
    }, 'Processed league email invitations');
    return { sent, skippedMembers, skippedDuplicates };
  }

  private async deliverLeagueInvitationEmail(input: {
    invitationId: string;
    email: string;
    inviterName: string;
    leagueName: string;
    leagueCode: string;
    inviteCode: string;
    expiresAt: Date;
    message?: string;
  }): Promise<void> {
    if (!this.mailDelivery) {
      this.logger?.debug({
        action: 'leagueInvitation.emailDelivery.skipped',
        data: { invitationId: input.invitationId },
      }, 'No mail delivery provider configured for league invitation');
      return;
    }
    const message = renderSystemEmailTemplate('LEAGUE_MEMBER_INVITE', {
      recipientEmail: input.email,
      inviterName: input.inviterName,
      leagueName: input.leagueName,
      leagueCode: input.leagueCode,
      inviteUrl: buildInviteUrl(this.appBaseUrl, input.inviteCode),
      message: input.message,
      expiresAt: input.expiresAt,
    });
    this.logger?.debug({
      action: 'leagueInvitation.emailDelivery.enter',
      data: {
        invitationId: input.invitationId,
        templateKey: message.templateKey,
      },
    }, 'Delivering league invitation email');
    try {
      await this.mailDelivery.send({
        to: input.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
        metadata: {
          templateKey: message.templateKey,
          invitationId: input.invitationId,
        },
      });
      this.logger?.info({
        action: 'leagueInvitation.emailDelivery.success',
        data: {
          invitationId: input.invitationId,
          templateKey: message.templateKey,
        },
      }, 'Delivered league invitation email');
    } catch (err) {
      this.logger?.error({
        action: 'leagueInvitation.emailDelivery.failure',
        data: {
          invitationId: input.invitationId,
          templateKey: message.templateKey,
          error: err instanceof Error ? err.message : String(err),
        },
      }, 'Failed to deliver league invitation email');
      throw new InvitationEmailDeliveryError(input.invitationId, input.email, err);
    }
  }

  private async resolveInviterName(userId: string): Promise<string> {
    if (!this.prisma) return DEFAULT_INVITER_NAME;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        username: true,
        email: true,
      },
    });
    if (!user) return DEFAULT_INVITER_NAME;
    const fullName = [user.firstName, user.lastName]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');
    return fullName || user.username || user.email || DEFAULT_INVITER_NAME;
  }

  /** Generates a shareable invite link for the league. */
  async generateInviteLink(input: GenerateInviteLinkInput): Promise<LeagueInvitation> {
    this.logger?.debug({
      action: 'leagueInvitation.generateLink.enter',
      data: {
        leagueId: input.leagueId,
        invitedBy: input.invitedBy,
        expiresInDays: input.expiresInDays ?? null,
        maxUses: input.maxUses ?? 0,
      },
    }, 'Generating league invite link');
    const expiresAt = input.expiresInDays
      ? (() => {
          const d = new Date();
          d.setDate(d.getDate() + input.expiresInDays!);
          return d;
        })()
      : undefined;
    const invitation = await this.invitationRepo.create({
      leagueId: input.leagueId,
      inviteCode: generateInviteCode(),
      inviteType: InviteType.LINK,
      status: InvitationStatus.PENDING,
      maxUses: input.maxUses ?? 0, // 0 = unlimited
      currentUses: 0,
      invitedBy: input.invitedBy,
      expiresAt,
    });
    this.logger?.info({
      action: 'leagueInvitation.generateLink.success',
      data: {
        invitationId: invitation.id,
        leagueId: input.leagueId,
        maxUses: invitation.maxUses,
      },
    }, 'Generated league invite link');
    return invitation;
  }

  /** Revokes an existing invite link. */
  async revokeInviteLink(leagueId: string, inviteCode: string): Promise<void> {
    this.logger?.debug({
      action: 'leagueInvitation.revoke.enter',
      data: { leagueId, inviteCodeLength: inviteCode.length },
    }, 'Revoking league invite link');
    const invitation = await this.invitationRepo.findByCode(inviteCode);
    if (!invitation || invitation.leagueId !== leagueId) {
      this.logger?.warn({
        action: 'leagueInvitation.revoke.notFound',
        data: { leagueId, inviteCodeLength: inviteCode.length },
      }, 'Cannot revoke missing league invite link');
      throw new InvitationNotFoundError(inviteCode);
    }
    await this.invitationRepo.update(invitation.id, {
      status: InvitationStatus.REVOKED,
    });
    this.logger?.info({
      action: 'leagueInvitation.revoke.success',
      data: { leagueId, invitationId: invitation.id },
    }, 'Revoked league invite link');
  }

  /** Accepts an invitation by code, creating or reactivating a MEMBER membership. */
  async acceptInvitation(inviteCode: string, userId: string): Promise<LeagueMembership> {
    this.logger?.debug({
      action: 'leagueInvitation.accept.enter',
      data: { userId, inviteCodeLength: inviteCode.length },
    }, 'Accepting league invitation');
    const invitation = await this.invitationRepo.findByCode(inviteCode);
    if (!invitation) {
      this.logger?.warn({
        action: 'leagueInvitation.accept.notFound',
        data: { userId, inviteCodeLength: inviteCode.length },
      }, 'Cannot accept missing invitation');
      throw new InvitationNotFoundError(inviteCode);
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      this.logger?.warn({
        action: 'leagueInvitation.accept.invalidStatus',
        data: {
          userId,
          invitationId: invitation.id,
          status: invitation.status,
        },
      }, 'Cannot accept invitation in non-pending status');
      throw new InvitationInvalidError(
        `Invitation is ${invitation.status.toLowerCase()}`,
        mapInvitationStatusCode(invitation.status),
      );
    }
    if (invitation.expiresAt && new Date() > invitation.expiresAt) {
      await this.invitationRepo.update(invitation.id, { status: InvitationStatus.EXPIRED });
      this.logger?.warn({
        action: 'leagueInvitation.accept.expired',
        data: { userId, invitationId: invitation.id },
      }, 'Cannot accept expired invitation');
      throw new InvitationInvalidError('Invitation has expired', 'LEAGUE_INVITATION_EXPIRED');
    }
    if (invitation.maxUses > 0 && invitation.currentUses >= invitation.maxUses) {
      this.logger?.warn({
        action: 'leagueInvitation.accept.exhausted',
        data: { userId, invitationId: invitation.id },
      }, 'Cannot accept exhausted invitation');
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
        this.logger?.warn({
          action: 'leagueInvitation.accept.alreadyMember',
          data: { userId, invitationId: invitation.id, leagueId: invitation.leagueId },
        }, 'Cannot accept invitation for existing active member');
        throw new InvitationInvalidError(
          'You are already a member of this league',
          'LEAGUE_ALREADY_MEMBER',
        );
      }
    }
    const league = await this.leagueRepo.findById(invitation.leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'leagueInvitation.accept.leagueMissing',
        data: { userId, invitationId: invitation.id, leagueId: invitation.leagueId },
      }, 'Cannot accept invitation for missing league');
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
    this.logger?.info({
      action: 'leagueInvitation.accept.success',
      data: {
        userId,
        invitationId: invitation.id,
        leagueId: invitation.leagueId,
        membershipId: membership.id,
        currentUses: newUses,
        markedAccepted: isFullyUsed,
      },
    }, 'Accepted league invitation');
    return membership;
  }

  private async ensureDefaultSquad(leagueId: string, userId: string): Promise<void> {
    if (!this.squadRepo || !this.squadMembershipRepo || !this.prisma) {
      this.logger?.debug({
        action: 'leagueInvitation.ensureDefaultSquad.skipped',
        data: { leagueId, userId },
      }, 'Skipped default squad provisioning because dependencies are unavailable');
      return;
    }

    await ensureDefaultSquadForLeagueMember({
      leagueId,
      userId,
      squadRepo: this.squadRepo,
      squadMembershipRepo: this.squadMembershipRepo,
      prisma: this.prisma,
      logger: this.logger,
    });
  }

  async getInvitationPreview(inviteCode: string): Promise<InvitationPreview> {
    this.logger?.debug({
      action: 'leagueInvitation.preview.enter',
      data: { inviteCodeLength: inviteCode.length },
    }, 'Loading league invitation preview');
    const invitation = await this.invitationRepo.findByCode(inviteCode);
    if (!invitation) {
      this.logger?.warn({
        action: 'leagueInvitation.preview.notFound',
        data: { inviteCodeLength: inviteCode.length },
      }, 'Cannot preview missing invitation');
      throw new InvitationNotFoundError(inviteCode);
    }

    const league = await this.leagueRepo.findById(invitation.leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'leagueInvitation.preview.leagueMissing',
        data: { invitationId: invitation.id, leagueId: invitation.leagueId },
      }, 'Cannot preview invitation for missing league');
      throw new InvitationInvalidError('League no longer exists', 'LEAGUE_NOT_FOUND');
    }

    const preview = {
      inviteCode: invitation.inviteCode,
      status: invitation.status,
      league: {
        id: league.id,
        leagueCode: league.leagueCode,
        name: league.name,
      },
    };
    this.logger?.info({
      action: 'leagueInvitation.preview.success',
      data: { invitationId: invitation.id, leagueId: league.id, status: invitation.status },
    }, 'Loaded league invitation preview');
    return preview;
  }
}

/** Generates a short, URL-safe invite code. */
function generateInviteCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

function buildInviteUrl(appBaseUrl: string, inviteCode: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/invite/${encodeURIComponent(inviteCode)}`;
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
