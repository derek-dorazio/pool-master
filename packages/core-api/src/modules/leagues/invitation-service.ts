/**
 * InvitationService — email invitations, invite links, and invitation acceptance.
 */

import type {
  EmailMessageState,
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  SquadMembershipRepository,
  SquadRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import type {
  League,
  LeagueInvitation,
  LeagueMembership,
} from '@poolmaster/shared/domain';
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
import { LeagueNotFoundError } from './service';
import {
  type EmailLeague,
  type EmailService,
} from '../email';
import type { ApiErrorCode } from '@poolmaster/shared/dto';

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

/** An invitation and where its latest invite email stands; null for a join link. */
export interface InvitationWithEmailState {
  invitation: LeagueInvitation;
  emailState: EmailMessageState | null;
}

export interface SendInvitationsResult {
  sent: InvitationWithEmailState[];
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

/**
 * Everything InvitationService reads and writes (#211). It replaced a nine-parameter positional
 * constructor, where a dependency added mid-list silently shifted every argument after it.
 */
export interface InvitationServiceDeps {
  invitations: LeagueInvitationRepository;
  memberships: LeagueMembershipRepository;
  leagues: LeagueRepository;
  squads?: SquadRepository;
  squadMemberships?: SquadMembershipRepository;
  users: UserRepository;
  prisma?: PrismaClient;
  logger?: FastifyBaseLogger;
  email?: EmailService;
  appBaseUrl?: string;
}

export class InvitationService {
  private readonly logger?: FastifyBaseLogger;
  private readonly appBaseUrl: string;

  constructor(private readonly deps: InvitationServiceDeps) {
    this.logger = deps.logger;
    this.appBaseUrl = deps.appBaseUrl ?? 'http://localhost:5173';
  }

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
    const [league, inviterName, memberEmails] = await Promise.all([
      this.deps.leagues.findById(input.leagueId),
      this.resolveInviterName(input.invitedBy),
      this.findActiveMemberEmails(input.leagueId),
    ]);
    // The commissioner guard has found the league already; its name and code are the email's sender.
    if (!league) throw new LeagueNotFoundError(input.leagueId);
    this.requireActiveLeague(league, 'sendEmail');
    const sent: InvitationWithEmailState[] = [];
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
      const existing = await this.deps.invitations.findByEmail(input.leagueId, normalised);
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
      const invitation = await this.deps.invitations.create({
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
      const emailState = await this.queueLeagueInvitationEmail({
        invitationId: invitation.id,
        email: normalised,
        inviterName,
        league: {
          id: input.leagueId,
          name: league.name,
          leagueCode: league.leagueCode,
        },
        inviteCode: invitation.inviteCode,
        expiresAt,
        message: input.message,
      });
      sent.push({ invitation, emailState });
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

  /**
   * Queues the invite email in the outbox and returns its status. A new invite code is a new
   * email, so a resend is queued again while a repeated request for the same code is not.
   */
  private async queueLeagueInvitationEmail(input: {
    invitationId: string;
    email: string;
    inviterName: string;
    league: EmailLeague;
    inviteCode: string;
    expiresAt: Date;
    message?: string;
  }): Promise<EmailMessageState | null> {
    if (!this.deps.email) {
      this.logger?.debug({
        action: 'leagueInvitation.emailDelivery.skipped',
        data: { invitationId: input.invitationId },
      }, 'No email service configured for league invitation');
      return null;
    }
    const templateKey = 'LEAGUE_MEMBER_INVITE';
    const queued = await this.deps.email.send(templateKey, {
      to: { email: input.email },
      about: `${input.invitationId}:${input.inviteCode}`,
      league: input.league,
      refs: { invitationId: input.invitationId },
      data: {
        recipientEmail: input.email,
        inviterName: input.inviterName,
        leagueName: input.league.name,
        leagueCode: input.league.leagueCode,
        inviteUrl: buildInviteUrl(this.appBaseUrl, input.inviteCode),
        message: input.message,
        expiresAt: input.expiresAt,
      },
    });
    return { status: queued.status, skipReason: queued.skipReason };
  }

  /**
   * Lower-cased emails of the league's ACTIVE members. `users.findByLeague` returns every
   * membership status, so it is narrowed by the active memberships: a removed member can be
   * invited back, a current one is skipped.
   */
  private async findActiveMemberEmails(leagueId: string): Promise<Set<string>> {
    const [activeMemberships, users] = await Promise.all([
      this.deps.memberships.findByLeague(leagueId),
      this.deps.users.findByLeague(leagueId),
    ]);
    const activeUserIds = new Set(activeMemberships.map((membership) => membership.userId));
    return new Set(
      users
        .filter((user) => activeUserIds.has(user.id))
        .map((user) => user.email.toLowerCase().trim()),
    );
  }

  /** An inactive league is read-only, so it neither issues nor honours invitations. */
  private requireActiveLeague(league: League, operation: string): void {
    if (league.isActive) {
      return;
    }
    this.logger?.warn({
      action: `leagueInvitation.${operation}.leagueInactive`,
      data: { leagueId: league.id },
    }, 'Rejected invitation operation for inactive league');
    throw new InvitationInvalidError(
      'This league is inactive. Reactivate it before inviting or adding members.',
      'LEAGUE_INACTIVE',
    );
  }

  private async resolveInviterName(userId: string): Promise<string> {
    const user = await this.deps.users.findById(userId);
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
    const league = await this.deps.leagues.findById(input.leagueId);
    if (league) {
      this.requireActiveLeague(league, 'generateLink');
    }
    const expiresAt = input.expiresInDays
      ? (() => {
          const d = new Date();
          d.setDate(d.getDate() + input.expiresInDays);
          return d;
        })()
      : undefined;
    const invitation = await this.deps.invitations.create({
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

  /**
   * The league's outstanding invitations, newest first (#221): every PENDING invitation, plus
   * email invites that went EXPIRED unaccepted. An invite is outstanding until it is accepted or
   * cancelled; an expired email invite is listed so the commissioner can resend it.
   */
  async listOutstandingInvitations(leagueId: string): Promise<InvitationWithEmailState[]> {
    this.logger?.debug({
      action: 'leagueInvitation.listOutstanding.enter',
      data: { leagueId },
    }, 'Listing outstanding league invitations');
    const invitations = (await this.deps.invitations.findByLeague(leagueId)).filter(isOutstanding);
    const emailInvitationIds = invitations
      .filter((invitation) => invitation.inviteType === InviteType.EMAIL)
      .map((invitation) => invitation.id);
    const emailStates = this.deps.email
      ? await this.deps.email.latestInviteStateByInvitation(emailInvitationIds)
      : new Map<string, EmailMessageState>();
    this.logger?.info({
      action: 'leagueInvitation.listOutstanding.success',
      data: { leagueId, invitationCount: invitations.length },
    }, 'Listed outstanding league invitations');
    return invitations.map((invitation) => ({
      invitation,
      emailState: emailStates.get(invitation.id) ?? null,
    }));
  }

  /**
   * Resends an outstanding email invitation (#221): a new invite code, so the old link stops
   * working, a fresh expiry, and the invitation email sent again. Join links cannot be resent.
   */
  async resendEmailInvitation(
    leagueId: string,
    invitationId: string,
    resentBy: string,
  ): Promise<InvitationWithEmailState> {
    this.logger?.debug({
      action: 'leagueInvitation.resend.enter',
      data: { leagueId, invitationId, resentBy },
    }, 'Resending league email invitation');
    const invitation = await this.deps.invitations.findById(invitationId);
    if (!invitation || invitation.leagueId !== leagueId) {
      this.logger?.warn({
        action: 'leagueInvitation.resend.notFound',
        data: { leagueId, invitationId },
      }, 'Cannot resend missing league invitation');
      throw new InvitationNotFoundError(invitationId);
    }
    if (invitation.inviteType !== InviteType.EMAIL || !invitation.email || !isOutstanding(invitation)) {
      this.logger?.warn({
        action: 'leagueInvitation.resend.notResendable',
        data: {
          leagueId,
          invitationId,
          inviteType: invitation.inviteType,
          status: invitation.status,
        },
      }, 'Cannot resend a join link or a settled invitation');
      throw new InvitationInvalidError(
        'Only an outstanding email invitation can be resent.',
        'LEAGUE_INVITATION_NOT_RESENDABLE',
      );
    }
    const [league, inviterName] = await Promise.all([
      this.deps.leagues.findById(leagueId),
      this.resolveInviterName(resentBy),
    ]);
    // The commissioner guard has found the league already; its name and code are the email's sender.
    if (!league) throw new LeagueNotFoundError(leagueId);
    this.requireActiveLeague(league, 'resend');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEFAULT_INVITE_EXPIRY_DAYS);
    const renewed = await this.deps.invitations.update(invitation.id, {
      inviteCode: generateInviteCode(),
      status: InvitationStatus.PENDING,
      expiresAt,
    });
    const emailState = await this.queueLeagueInvitationEmail({
      invitationId: renewed.id,
      email: invitation.email,
      inviterName,
      league: {
        id: leagueId,
        name: league.name,
        leagueCode: league.leagueCode,
      },
      inviteCode: renewed.inviteCode,
      expiresAt,
    });
    this.logger?.info({
      action: 'leagueInvitation.resend.success',
      data: { leagueId, invitationId, resentBy },
    }, 'Resent league email invitation');
    return { invitation: renewed, emailState };
  }

  /** Cancels an invitation by code: a join link or an email invite (#221). It can no longer be accepted. */
  async revokeInviteLink(leagueId: string, inviteCode: string): Promise<void> {
    this.logger?.debug({
      action: 'leagueInvitation.revoke.enter',
      data: { leagueId, inviteCodeLength: inviteCode.length },
    }, 'Revoking league invite link');
    const invitation = await this.deps.invitations.findByCode(inviteCode);
    if (!invitation || invitation.leagueId !== leagueId) {
      this.logger?.warn({
        action: 'leagueInvitation.revoke.notFound',
        data: { leagueId, inviteCodeLength: inviteCode.length },
      }, 'Cannot revoke missing league invite link');
      throw new InvitationNotFoundError(inviteCode);
    }
    if (!isOutstanding(invitation)) {
      this.logger?.warn({
        action: 'leagueInvitation.revoke.notCancellable',
        data: { leagueId, invitationId: invitation.id, status: invitation.status },
      }, 'Cannot cancel an invitation that is already accepted or cancelled');
      throw new InvitationInvalidError(
        'Only an outstanding invitation can be cancelled.',
        'LEAGUE_INVITATION_NOT_CANCELLABLE',
      );
    }
    await this.deps.invitations.update(invitation.id, {
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
    const invitation = await this.deps.invitations.findByCode(inviteCode);
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
      await this.deps.invitations.update(invitation.id, { status: InvitationStatus.EXPIRED });
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
    if (invitation.inviteType === InviteType.EMAIL && invitation.email) {
      // An email invitation is for one person: a forwarded code must not let someone else in.
      // Anyone may use a LINK invitation, which is what it is for.
      const user = await this.deps.users.findById(userId);
      if (user?.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
        this.logger?.warn({
          action: 'leagueInvitation.accept.emailMismatch',
          data: { userId, invitationId: invitation.id },
        }, 'Cannot accept email invitation sent to a different address');
        throw new InvitationInvalidError(
          'This invitation was sent to a different email address. Sign in with that address to accept it.',
          'LEAGUE_INVITATION_EMAIL_MISMATCH',
        );
      }
    }
    const existingMembership = await this.deps.memberships.findByLeagueAndUser(
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
    const league = await this.deps.leagues.findById(invitation.leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'leagueInvitation.accept.leagueMissing',
        data: { userId, invitationId: invitation.id, leagueId: invitation.leagueId },
      }, 'Cannot accept invitation for missing league');
      throw new InvitationInvalidError('League no longer exists', 'LEAGUE_NOT_FOUND');
    }
    this.requireActiveLeague(league, 'accept');
    const membership = existingMembership
      ? await this.deps.memberships.update(existingMembership.id, {
          role: LeagueRole.MEMBER,
          status: LeagueMembershipStatus.ACTIVE,
          joinedAt: new Date(),
        })
      : await this.deps.memberships.create({
          leagueId: invitation.leagueId,
          userId,
          role: LeagueRole.MEMBER,
          status: LeagueMembershipStatus.ACTIVE,
          joinedAt: new Date(),
        });

    await this.ensureDefaultSquad(invitation.leagueId, userId);

    const newUses = invitation.currentUses + 1;
    const isFullyUsed = invitation.maxUses > 0 && newUses >= invitation.maxUses;
    await this.deps.invitations.update(invitation.id, {
      currentUses: newUses,
      acceptedAt: new Date(),
      acceptedBy: userId,
      ...(isFullyUsed && { status: InvitationStatus.ACCEPTED }),
    });
    await this.deliverLeagueJoinSuccessEmail({
      invitationId: invitation.id,
      leagueId: league.id,
      leagueName: league.name,
      leagueCode: league.leagueCode,
      userId,
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

  private async deliverLeagueJoinSuccessEmail(input: {
    invitationId: string;
    leagueId: string;
    leagueName: string;
    leagueCode: string;
    userId: string;
  }): Promise<void> {
    if (!this.deps.email || !this.deps.prisma) {
      this.logger?.debug({
        action: 'leagueInvitation.joinSuccessEmail.skipped',
        data: { invitationId: input.invitationId, leagueId: input.leagueId },
      }, 'Skipped league join success email because dependencies are unavailable');
      return;
    }
    const [recipient, teamName] = await Promise.all([
      this.resolveRecipientUser(input.userId),
      this.resolveUserTeamName(input.leagueId, input.userId),
    ]);
    if (!recipient) {
      this.logger?.warn({
        action: 'leagueInvitation.joinSuccessEmail.recipientMissing',
        data: {
          invitationId: input.invitationId,
          leagueId: input.leagueId,
          userId: input.userId,
        },
      }, 'Skipped league join success email because recipient user was not found');
      return;
    }
    const templateKey = 'LEAGUE_JOIN_SUCCESS';
    try {
      await this.deps.email.send(templateKey, {
        to: { email: recipient.email, userId: input.userId, timeZone: recipient.timeZone },
        about: input.invitationId,
        league: { id: input.leagueId, name: input.leagueName, leagueCode: input.leagueCode },
        refs: { invitationId: input.invitationId },
        data: {
          userName: recipient.name,
          leagueName: input.leagueName,
          leagueCode: input.leagueCode,
          teamName,
          leagueHomeUrl: buildLeagueUrl(this.appBaseUrl, input.leagueCode),
        },
      });
      this.logger?.info({
        action: 'leagueInvitation.joinSuccessEmail.success',
        data: {
          invitationId: input.invitationId,
          leagueId: input.leagueId,
          templateKey,
        },
      }, 'Queued league join success email');
    } catch (err) {
      this.logger?.error({
        action: 'leagueInvitation.joinSuccessEmail.failure',
        data: {
          invitationId: input.invitationId,
          leagueId: input.leagueId,
          templateKey,
          error: err instanceof Error ? err.message : String(err),
        },
      }, 'Failed to queue league join success email');
    }
  }

  private async resolveRecipientUser(
    userId: string,
  ): Promise<{ email: string; name: string; timeZone?: string } | null> {
    const user = await this.deps.users.findById(userId);
    if (!user) return null;
    const fullName = [user.firstName, user.lastName]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');
    return {
      email: user.email,
      name: fullName || user.username || user.email,
      timeZone: user.timezone,
    };
  }

  private async resolveUserTeamName(leagueId: string, userId: string): Promise<string | undefined> {
    if (!this.deps.prisma) return undefined;
    const squadMembership = await this.deps.prisma.squadMembership.findFirst({
      where: { leagueId, userId },
      select: {
        squad: {
          select: { name: true },
        },
      },
    });
    return squadMembership?.squad.name;
  }

  private async ensureDefaultSquad(leagueId: string, userId: string): Promise<void> {
    if (!this.deps.squads || !this.deps.squadMemberships) {
      this.logger?.debug({
        action: 'leagueInvitation.ensureDefaultSquad.skipped',
        data: { leagueId, userId },
      }, 'Skipped default squad provisioning because dependencies are unavailable');
      return;
    }

    await ensureDefaultSquadForLeagueMember({
      leagueId,
      userId,
      squadRepo: this.deps.squads,
      squadMembershipRepo: this.deps.squadMemberships,
      users: this.deps.users,
      logger: this.logger,
    });
  }

  async getInvitationPreview(inviteCode: string): Promise<InvitationPreview> {
    this.logger?.debug({
      action: 'leagueInvitation.preview.enter',
      data: { inviteCodeLength: inviteCode.length },
    }, 'Loading league invitation preview');
    const invitation = await this.deps.invitations.findByCode(inviteCode);
    if (!invitation) {
      this.logger?.warn({
        action: 'leagueInvitation.preview.notFound',
        data: { inviteCodeLength: inviteCode.length },
      }, 'Cannot preview missing invitation');
      throw new InvitationNotFoundError(inviteCode);
    }

    const league = await this.deps.leagues.findById(invitation.leagueId);
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

/** Not yet accepted or cancelled. An email invite that expired unaccepted is still outstanding. */
function isOutstanding(invitation: LeagueInvitation): boolean {
  return invitation.status === InvitationStatus.PENDING
    || (invitation.status === InvitationStatus.EXPIRED && invitation.inviteType === InviteType.EMAIL);
}

/** Generates a short, URL-safe invite code. */
function generateInviteCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

function buildInviteUrl(appBaseUrl: string, inviteCode: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/invite/${encodeURIComponent(inviteCode)}`;
}

function buildLeagueUrl(appBaseUrl: string, leagueCode: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/league/${encodeURIComponent(leagueCode)}`;
}

export class InvitationNotFoundError extends Error {
  readonly code: ApiErrorCode = 'LEAGUE_INVITATION_NOT_FOUND';
  readonly statusCode = 404;

  constructor(code: string) {
    super(`Invitation not found: ${code}`);
    this.name = 'InvitationNotFoundError';
  }
}

export class InvitationInvalidError extends Error {
  code: ApiErrorCode;

  constructor(reason: string, code: ApiErrorCode = 'LEAGUE_INVITATION_INVALID') {
    super(reason);
    this.name = 'InvitationInvalidError';
    this.code = code;
  }
}

function mapInvitationStatusCode(status: InvitationStatus): ApiErrorCode {
  switch (status) {
    case InvitationStatus.ACCEPTED:
      return 'LEAGUE_INVITATION_ALREADY_ACCEPTED';
    case InvitationStatus.REVOKED:
      return 'LEAGUE_INVITATION_REVOKED';
    case InvitationStatus.EXPIRED:
      return 'LEAGUE_INVITATION_EXPIRED';
    case InvitationStatus.PENDING:
      return 'LEAGUE_INVITATION_INVALID';
  }
}
