import type {
  PrismaClient,
  SquadOwnerInvitation as PrismaSquadOwnerInvitation,
} from '@prisma/client';
import type { SquadOwnerInvitationRepository } from '@poolmaster/shared/db';
import type {
  SquadOwnerInvitation,
  SquadOwnerInvitationStatus,
} from '@poolmaster/shared/domain';
import { SquadOwnerInvitationStatus as SharedSquadOwnerInvitationStatus } from '@poolmaster/shared/domain';

export class PrismaSquadOwnerInvitationRepository
  implements SquadOwnerInvitationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<SquadOwnerInvitation | null> {
    const row = await this.prisma.squadOwnerInvitation.findUnique({ where: { id } });
    return row ? mapToInvitation(row) : null;
  }

  async findByLeague(leagueId: string): Promise<SquadOwnerInvitation[]> {
    const rows = await this.prisma.squadOwnerInvitation.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapToInvitation);
  }

  async findByCode(inviteCode: string): Promise<SquadOwnerInvitation | null> {
    const row = await this.prisma.squadOwnerInvitation.findUnique({
      where: { inviteCode },
    });
    return row ? mapToInvitation(row) : null;
  }

  async findPendingByLeagueAndEmail(
    leagueId: string,
    email: string,
  ): Promise<SquadOwnerInvitation | null> {
    const row = await this.prisma.squadOwnerInvitation.findFirst({
      where: {
        leagueId,
        email,
        status: SharedSquadOwnerInvitationStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? mapToInvitation(row) : null;
  }

  async create(
    invitation: Omit<SquadOwnerInvitation, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SquadOwnerInvitation> {
    const row = await this.prisma.squadOwnerInvitation.create({
      data: {
        leagueId: invitation.leagueId,
        squadId: invitation.squadId,
        email: invitation.email,
        inviteCode: invitation.inviteCode,
        status: invitation.status,
        invitedBy: invitation.invitedBy,
        expiresAt: invitation.expiresAt,
        acceptedAt: invitation.acceptedAt,
        acceptedBy: invitation.acceptedBy,
        replacementForUserId: invitation.replacementForUserId,
      },
    });
    return mapToInvitation(row);
  }

  async update(
    id: string,
    updates: Partial<SquadOwnerInvitation>,
  ): Promise<SquadOwnerInvitation> {
    const row = await this.prisma.squadOwnerInvitation.update({
      where: { id },
      data: {
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.acceptedAt !== undefined && { acceptedAt: updates.acceptedAt }),
        ...(updates.acceptedBy !== undefined && { acceptedBy: updates.acceptedBy }),
        ...(updates.expiresAt !== undefined && { expiresAt: updates.expiresAt }),
        ...(updates.replacementForUserId !== undefined && {
          replacementForUserId: updates.replacementForUserId,
        }),
      },
    });
    return mapToInvitation(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.squadOwnerInvitation.delete({ where: { id } });
  }
}

function mapToInvitation(row: PrismaSquadOwnerInvitation): SquadOwnerInvitation {
  return {
    id: row.id,
    leagueId: row.leagueId,
    squadId: row.squadId,
    email: row.email,
    inviteCode: row.inviteCode,
    status: row.status as SquadOwnerInvitationStatus,
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt ?? undefined,
    acceptedAt: row.acceptedAt ?? undefined,
    acceptedBy: row.acceptedBy ?? undefined,
    replacementForUserId: row.replacementForUserId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
