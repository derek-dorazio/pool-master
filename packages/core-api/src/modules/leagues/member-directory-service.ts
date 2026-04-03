import type { PrismaClient } from '@prisma/client';
import type { LeagueMemberDto } from '@poolmaster/shared/dto';

export class MemberDirectoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async listMembers(leagueId: string): Promise<LeagueMemberDto[]> {
    const rows = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
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
      role: row.role,
      joinedAt: row.joinedAt.toISOString(),
    }));
  }
}
