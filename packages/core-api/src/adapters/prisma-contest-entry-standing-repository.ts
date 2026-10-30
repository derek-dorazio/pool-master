/**
 * Prisma adapter for ContestEntryStandingRepository: the frozen entry standing (#246), with the
 * settled total every scoring family stores on the one row (#695).
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ContestEntryEventStandingRepository,
  ContestEntryEventStandingResult,
  ContestEntryEventStandingWrite,
  ContestEntryStandingRepository,
  ContestEntryStandingResult,
  ContestEntryStandingWrite,
  ContestWinner,
} from '@poolmaster/shared/db';

export class PrismaContestEntryStandingRepository implements ContestEntryStandingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByContest(contestId: string): Promise<ContestEntryStandingResult[]> {
    const rows = await this.prisma.contestEntryStanding.findMany({
      where: { contestId },
      orderBy: [{ position: { sort: 'asc', nulls: 'last' } }, { contestEntryId: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      contestId: row.contestId,
      contestEntryId: row.contestEntryId,
      position: row.position,
      displayPosition: row.displayPosition,
      countingPickLimit: row.countingPickLimit,
      scoredPickCount: row.scoredPickCount,
      asOf: row.asOf,
      settledAt: row.settledAt,
      totalScore: row.totalScore,
    }));
  }

  async findWinnersByContests(contestIds: readonly string[]): Promise<ContestWinner[]> {
    if (contestIds.length === 0) return [];
    const rows = await this.prisma.contestEntryStanding.findMany({
      where: { contestId: { in: [...new Set(contestIds)] }, position: 1 },
      select: { contestId: true, contestEntry: { select: { name: true } } },
      orderBy: [{ contestId: 'asc' }, { contestEntry: { entryNumber: 'asc' } }, { contestEntry: { name: 'asc' } }],
    });
    return rows.map((row) => ({ contestId: row.contestId, entryName: row.contestEntry.name }));
  }

  async upsertMany(contestId: string, writes: readonly ContestEntryStandingWrite[]): Promise<void> {
    assertOfContest(contestId, writes);
    if (writes.length === 0) return;
    const stored = new Map((await this.prisma.contestEntryStanding.findMany({ where: { contestId } }))
      .map((row) => [row.contestEntryId, row]));
    const { creates, updates } = planStandingWrites(writes, (write) => stored.get(write.contestEntryId));
    if (creates.length === 0 && updates.length === 0) return;
    await this.prisma.$transaction([
      ...updates.map(({ id, write: { contestEntryId: _entry, ...standing } }) =>
        // poolmaster-allow-query-in-loop: only the changed rows, sent together in one transaction (#1172); a batch of different values per row needs raw SQL, which Derek ruled out
        this.prisma.contestEntryStanding.update({ where: { id }, data: standing })),
      ...(creates.length > 0 ? [this.prisma.contestEntryStanding.createMany({ data: creates })] : []),
    ]);
  }
}

/** Prisma adapter for the per-event entry standing (#713), the same columns narrowed to an event. */
export class PrismaContestEntryEventStandingRepository implements ContestEntryEventStandingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByContest(contestId: string): Promise<ContestEntryEventStandingResult[]> {
    return this.findByContests([contestId]);
  }

  async findByContests(contestIds: readonly string[]): Promise<ContestEntryEventStandingResult[]> {
    if (contestIds.length === 0) return [];
    const rows = await this.prisma.contestEntryEventStanding.findMany({
      where: { contestId: { in: [...contestIds] } },
      orderBy: [{ contestId: 'asc' }, { sportEventId: 'asc' }, { position: { sort: 'asc', nulls: 'last' } }, { contestEntryId: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      contestId: row.contestId,
      contestEntryId: row.contestEntryId,
      sportEventId: row.sportEventId,
      position: row.position,
      displayPosition: row.displayPosition,
      countingPickLimit: row.countingPickLimit,
      scoredPickCount: row.scoredPickCount,
      asOf: row.asOf,
      settledAt: row.settledAt,
      totalScore: row.totalScore,
    }));
  }

  async findContestsSettledFor(sportEventId: string, contestIds: readonly string[]): Promise<Set<string>> {
    if (contestIds.length === 0) return new Set();
    const rows = await this.prisma.contestEntryEventStanding.findMany({
      where: { sportEventId, contestId: { in: [...contestIds] } },
      distinct: ['contestId'],
      select: { contestId: true },
    });
    return new Set(rows.map((row) => row.contestId));
  }

  async upsertMany(contestId: string, writes: readonly ContestEntryEventStandingWrite[]): Promise<void> {
    assertOfContest(contestId, writes);
    if (writes.length === 0) return;
    const keyOf = (standing: { contestEntryId: string; sportEventId: string }) => `${standing.contestEntryId}:${standing.sportEventId}`;
    const stored = new Map((await this.prisma.contestEntryEventStanding.findMany({
      where: { contestId, sportEventId: { in: [...new Set(writes.map((write) => write.sportEventId))] } },
    })).map((row) => [keyOf(row), row]));
    const { creates, updates } = planStandingWrites(writes, (write) => stored.get(keyOf(write)));
    if (creates.length === 0 && updates.length === 0) return;
    await this.prisma.$transaction([
      ...updates.map(({ id, write: { contestEntryId: _entry, sportEventId: _event, ...standing } }) =>
        // poolmaster-allow-query-in-loop: only the changed rows, sent together in one transaction (#1172); a batch of different values per row needs raw SQL, which Derek ruled out
        this.prisma.contestEntryEventStanding.update({ where: { id }, data: standing })),
      ...(creates.length > 0 ? [this.prisma.contestEntryEventStanding.createMany({ data: creates })] : []),
    ]);
  }
}

/** What a standing's settlement sets, compared to tell whether a write changes the stored row. */
const SETTLED_FIELDS = [
  'position',
  'displayPosition',
  'countingPickLimit',
  'scoredPickCount',
  'asOf',
  'settledAt',
  'totalScore',
] as const satisfies readonly (keyof ContestEntryStandingWrite)[];

type SettledFields = Pick<ContestEntryStandingWrite, (typeof SETTLED_FIELDS)[number]>;

/** The writes to create, and the stored rows each changed write updates; an unchanged write is left out. */
function planStandingWrites<W extends SettledFields>(
  writes: readonly W[],
  storedOf: (write: W) => (SettledFields & { id: string }) | undefined,
): { creates: W[]; updates: Array<{ id: string; write: W }> } {
  const creates: W[] = [];
  const updates: Array<{ id: string; write: W }> = [];
  for (const write of writes) {
    const stored = storedOf(write);
    if (!stored) creates.push(write);
    else if (!SETTLED_FIELDS.every((field) => sameValue(stored[field], write[field]))) updates.push({ id: stored.id, write });
  }
  return { creates, updates };
}

function sameValue(stored: SettledFields[keyof SettledFields], written: SettledFields[keyof SettledFields]): boolean {
  return stored instanceof Date && written instanceof Date ? stored.getTime() === written.getTime() : stored === written;
}

function assertOfContest(contestId: string, writes: readonly { contestId: string }[]): void {
  const stray = writes.find((write) => write.contestId !== contestId);
  if (stray) throw new Error(`A standing of contest ${stray.contestId} was written with contest ${contestId}'s`);
}
