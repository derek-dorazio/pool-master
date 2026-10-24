import type { PrismaClient } from '@prisma/client';
import type {
  ContestExpansionRepository,
  ContestExpansionState,
  ContestExpansionWrite,
  ContestExpansionWriteResult,
} from '@poolmaster/shared/db';
import { lockContestRow } from './contest-row-lock';

/** Contest expansions and their payment history lines (#980, #987). */
export class PrismaContestExpansionRepository implements ContestExpansionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findState(contestId: string): Promise<ContestExpansionState> {
    const [expansion, entryCount] = await Promise.all([
      this.prisma.contestExpansion.aggregate({ where: { contestId }, _max: { entriesPerContest: true } }),
      this.prisma.contestEntry.count({ where: { contestId } }),
    ]);
    return { expandedTo: expansion._max.entriesPerContest, entryCount };
  }

  async findHighestBands(contestIds: readonly string[]): Promise<Map<string, number>> {
    if (contestIds.length === 0) return new Map();
    const rows = await this.prisma.contestExpansion.groupBy({
      by: ['contestId'],
      where: { contestId: { in: [...contestIds] } },
      _max: { entriesPerContest: true },
    });
    return new Map(rows.flatMap((row) => (row._max.entriesPerContest === null ? [] : [[row.contestId, row._max.entriesPerContest]])));
  }

  async expand(write: ContestExpansionWrite): Promise<ContestExpansionWriteResult> {
    return this.prisma.$transaction(async (tx) => {
      // The lock entries are counted under, so an entry waiting on it sees the new cap.
      await lockContestRow(tx, write.contestId);
      const highest = await tx.contestExpansion.aggregate({
        where: { contestId: write.contestId },
        _max: { entriesPerContest: true },
      });
      const expandedTo = highest._max.entriesPerContest;
      if (expandedTo !== null && expandedTo >= write.entriesPerContest) {
        return { status: 'notAbove', expandedTo };
      }
      const payment = await tx.leaguePayment.create({
        data: {
          leagueId: write.leagueId,
          contestId: write.contestId,
          payerId: write.payerId,
          kind: write.kind,
          amountCents: write.amountCents,
          description: write.describe(expandedTo),
        },
      });
      await tx.contestExpansion.create({
        data: { contestId: write.contestId, entriesPerContest: write.entriesPerContest, paymentId: payment.id },
      });
      return { status: 'expanded', expandedTo: write.entriesPerContest };
    });
  }
}
