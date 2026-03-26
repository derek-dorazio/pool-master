/**
 * Prisma adapter for LeagueInvitationRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { LeagueInvitationRepository } from '@poolmaster/shared/db';
import type { LeagueInvitation } from '@poolmaster/shared/domain';

export class PrismaLeagueInvitationRepository implements LeagueInvitationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<LeagueInvitation | null> {
    const row = await this.prisma.leagueInvitation.findUnique({ where: { id } });
    return row ? mapToInvitation(row) : null;
  }

  async findByLeague(leagueId: string): Promise<LeagueInvitation[]> {
    const rows = await this.prisma.leagueInvitation.findMany({
      where: { leagueId },
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

  async findByEmail(leagueId: string, email: string): Promise<LeagueInvitation | null> {
    const row = await this.prisma.leagueInvitation.findFirst({
      where: { leagueId, email, status: 'PENDING' },
    });
    return row ? mapToInvitation(row) : null;
  }

  async create(
    invitation: Omit<LeagueInvitation, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<LeagueInvitation> {
    const row = await this.prisma.leagueInvitation.create({
      data: {
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
      },
    });
    return mapToInvitation(row);
  }

  async update(id: string, updates: Partial<LeagueInvitation>): Promise<LeagueInvitation> {
    const row = await this.prisma.leagueInvitation.update({
      where: { id },
      data: {
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.currentUses !== undefined && { currentUses: updates.currentUses }),
        ...(updates.acceptedAt !== undefined && { acceptedAt: updates.acceptedAt }),
        ...(updates.acceptedBy !== undefined && { acceptedBy: updates.acceptedBy }),
      },
    });
    return mapToInvitation(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.leagueInvitation.delete({ where: { id } });
  }
}

function mapToInvitation(row: {
  id: string;
  leagueId: string;
  email: string | null;
  inviteCode: string;
  inviteType: string;
  status: string;
  maxUses: number;
  currentUses: number;
  invitedBy: string;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): LeagueInvitation {
  return {
    id: row.id,
    leagueId: row.leagueId,
    email: row.email ?? undefined,
    inviteCode: row.inviteCode,
    inviteType: row.inviteType as LeagueInvitation['inviteType'],
    status: row.status as LeagueInvitation['status'],
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
