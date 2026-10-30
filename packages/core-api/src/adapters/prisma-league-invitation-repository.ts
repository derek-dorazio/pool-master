/**
 * Prisma adapter for LeagueInvitationRepository port.
 */

import type { LeagueInvitation as PrismaLeagueInvitation, PrismaClient } from '@prisma/client';
import type { LeagueInvitationRepository } from '@poolmaster/shared/db';
import type { InviteType, InvitationStatus, LeagueInvitation } from '@poolmaster/shared/domain';
import { InvitationStatus as SharedInvitationStatus, InviteType as SharedInviteType } from '@poolmaster/shared/domain';

export class PrismaLeagueInvitationRepository implements LeagueInvitationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<LeagueInvitation | null> {
    const row = await this.prisma.leagueInvitation.findUnique({ where: { id } });
    return row ? mapToInvitation(row) : null;
  }

  async findOutstandingByLeague(leagueId: string): Promise<LeagueInvitation[]> {
    const rows = await this.prisma.leagueInvitation.findMany({
      where: {
        leagueId,
        OR: [
          { status: SharedInvitationStatus.PENDING },
          { status: SharedInvitationStatus.EXPIRED, inviteType: SharedInviteType.EMAIL },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapToInvitation);
  }

  async findByCode(inviteCode: string): Promise<LeagueInvitation | null> {
    const row = await this.prisma.leagueInvitation.findUnique({
      where: { inviteCode },
    });
    return row ? mapToInvitation(row) : null;
  }

  async findPendingByEmails(leagueId: string, emails: readonly string[]): Promise<LeagueInvitation[]> {
    if (emails.length === 0) return [];
    const rows = await this.prisma.leagueInvitation.findMany({
      where: { leagueId, email: { in: [...new Set(emails)] }, status: SharedInvitationStatus.PENDING },
    });
    return rows.map(mapToInvitation);
  }

  async create(
    invitation: Omit<LeagueInvitation, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<LeagueInvitation> {
    const row = await this.prisma.leagueInvitation.create({ data: toCreateData(invitation) });
    return mapToInvitation(row);
  }

  async createMany(
    invitations: readonly Omit<LeagueInvitation, 'id' | 'createdAt' | 'updatedAt'>[],
  ): Promise<LeagueInvitation[]> {
    if (invitations.length === 0) return [];
    const rows = await this.prisma.leagueInvitation.createManyAndReturn({ data: invitations.map(toCreateData) });
    // Each invite code is unique, so it names the row written for each invitation given.
    const byCode = new Map(rows.map((row) => [row.inviteCode, mapToInvitation(row)]));
    return invitations.map((invitation) => {
      const written = byCode.get(invitation.inviteCode);
      if (!written) throw new Error(`Invitation ${invitation.inviteCode} was not written`);
      return written;
    });
  }

  async update(id: string, updates: Partial<LeagueInvitation>): Promise<LeagueInvitation> {
    const row = await this.prisma.leagueInvitation.update({
      where: { id },
      data: {
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.inviteCode !== undefined && { inviteCode: updates.inviteCode }),
        ...(updates.expiresAt !== undefined && { expiresAt: updates.expiresAt }),
        ...(updates.currentUses !== undefined && { currentUses: updates.currentUses }),
        ...(updates.acceptedAt !== undefined && { acceptedAt: updates.acceptedAt }),
        ...(updates.acceptedBy !== undefined && { acceptedBy: updates.acceptedBy }),
      },
    });
    return mapToInvitation(row);
  }

}

function mapToInvitation(row: PrismaLeagueInvitation): LeagueInvitation {
  return {
    id: row.id,
    leagueId: row.leagueId,
    email: row.email ?? undefined,
    inviteCode: row.inviteCode,
    inviteType: row.inviteType as InviteType,
    status: row.status as InvitationStatus,
    maxUses: row.maxUses,
    currentUses: row.currentUses,
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt ?? undefined,
    acceptedAt: row.acceptedAt ?? undefined,
    acceptedBy: row.acceptedBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCreateData(invitation: Omit<LeagueInvitation, 'id' | 'createdAt' | 'updatedAt'>) {
  return {
    leagueId: invitation.leagueId,
    email: invitation.email,
    inviteCode: invitation.inviteCode,
    inviteType: invitation.inviteType,
    status: invitation.status,
    maxUses: invitation.maxUses,
    currentUses: invitation.currentUses,
    invitedBy: invitation.invitedBy,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    acceptedBy: invitation.acceptedBy,
  };
}
