import type { PrismaClient } from '@prisma/client';
import { LeagueMembershipStatus } from '@poolmaster/shared/domain';
import type { LeagueRole } from '@poolmaster/shared/domain';
import type { LeagueMemberDto } from '@poolmaster/shared/dto';

export class MemberDirectoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async listMembers(leagueId: string): Promise<LeagueMemberDto[]> {
    const rows = await this.prisma.leagueMembership.findMany({
      where: { leagueId, status: LeagueMembershipStatus.ACTIVE },
      include: {
        user: {
          select: {
            displayName: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      displayName: row.user.displayName,
      role: row.role as LeagueRole,
      joinedAt: row.joinedAt.toISOString(),
    }));
  }
}
