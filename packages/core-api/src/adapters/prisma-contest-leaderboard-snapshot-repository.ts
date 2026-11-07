/**
 * Prisma adapter for ContestLeaderboardSnapshotRepository (#1435): each contest's leaderboard as
 * last computed, one row per contest and shown event, overwritten in place.
 */

import type { Prisma, PrismaClient, ContestLeaderboardSnapshot as SnapshotRow } from '@prisma/client';
import type {
  ContestLeaderboardSnapshot,
  ContestLeaderboardSnapshotKey,
  ContestLeaderboardSnapshotRepository,
  ContestLeaderboardSnapshotWrite,
} from '@poolmaster/shared/db';

export class PrismaContestLeaderboardSnapshotRepository<Board> implements ContestLeaderboardSnapshotRepository<Board> {
  constructor(private readonly prisma: PrismaClient) {}

  async find(contestId: string, shownEvent: string): Promise<ContestLeaderboardSnapshot<Board> | null> {
    const row = await this.prisma.contestLeaderboardSnapshot.findUnique({
      where: { contestId_shownEvent: { contestId, shownEvent } },
    });
    return row ? toSnapshot<Board>(row) : null;
  }

  async findByContests(contestIds: readonly string[], shownEvent: string): Promise<ContestLeaderboardSnapshot<Board>[]> {
    if (contestIds.length === 0) return [];
    const rows = await this.prisma.contestLeaderboardSnapshot.findMany({
      where: { contestId: { in: [...new Set(contestIds)] }, shownEvent },
    });
    return rows.map((row) => toSnapshot<Board>(row));
  }

  async findKeysByContestsOrEvents(contestIds: readonly string[], sportEventIds: readonly string[]): Promise<ContestLeaderboardSnapshotKey[]> {
    // The contests on the events first, by the event index: an OR across the two would read every snapshot.
    const onEvents = sportEventIds.length === 0 ? [] : await this.prisma.contestSportEvent.findMany({
      where: { sportEventId: { in: [...new Set(sportEventIds)] } },
      select: { contestId: true },
    });
    const named = [...new Set([...contestIds, ...onEvents.map((row) => row.contestId)])];
    if (named.length === 0) return [];
    return this.prisma.contestLeaderboardSnapshot.findMany({
      where: { contestId: { in: named } },
      select: { contestId: true, shownEvent: true },
      orderBy: [{ contestId: 'asc' }, { shownEvent: 'asc' }],
    });
  }

  async save(write: ContestLeaderboardSnapshotWrite<Board>): Promise<boolean> {
    const { contestId, shownEvent, computedFrom, contestUpdatedAt, validUntil } = write;
    const board = write.board as Prisma.InputJsonValue;
    // Only a row computed from older reads is overwritten: one that began at the same moment or
    // later holds scores at least as new, and is kept.
    const updated = await this.prisma.contestLeaderboardSnapshot.updateMany({
      where: { contestId, shownEvent, computedFrom: { lt: computedFrom } },
      data: { computedFrom, contestUpdatedAt, validUntil, board, version: { increment: 1 } },
    });
    if (updated.count > 0) return true;
    // No older row: there is none yet, or the one there is newer. Skipping a duplicate keeps the
    // newer one, and keeps two first rebuilds at once from failing each other.
    const created = await this.prisma.contestLeaderboardSnapshot.createMany({
      data: [{ contestId, shownEvent, computedFrom, contestUpdatedAt, validUntil, board }],
      skipDuplicates: true,
    });
    return created.count > 0;
  }

  async delete({ contestId, shownEvent }: ContestLeaderboardSnapshotKey): Promise<void> {
    await this.prisma.contestLeaderboardSnapshot.deleteMany({ where: { contestId, shownEvent } });
  }
}

function toSnapshot<Board>(row: SnapshotRow): ContestLeaderboardSnapshot<Board> {
  return {
    contestId: row.contestId,
    shownEvent: row.shownEvent,
    version: row.version,
    computedFrom: row.computedFrom,
    contestUpdatedAt: row.contestUpdatedAt,
    validUntil: row.validUntil,
    // Written only by `save` of the same repository, from a `Board`.
    board: row.board as Board,
  };
}
