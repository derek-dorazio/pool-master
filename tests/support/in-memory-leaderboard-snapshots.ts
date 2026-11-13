/**
 * An in-memory ContestLeaderboardSnapshotRepository (#1435) that stores as the Prisma adapter does:
 * a write replaces only a snapshot that began computing earlier, and each one moves the version up.
 */
import type {
  ContestLeaderboardSnapshot,
  ContestLeaderboardSnapshotKey,
  ContestLeaderboardSnapshotRepository,
  ContestLeaderboardSnapshotWrite,
} from '@poolmaster/shared/db';

export class InMemoryLeaderboardSnapshots<Board> implements ContestLeaderboardSnapshotRepository<Board> {
  readonly rows = new Map<string, ContestLeaderboardSnapshot<Board>>();
  /** Each `save`, in order, whether it was stored or not. */
  readonly saves: ContestLeaderboardSnapshotWrite<Board>[] = [];

  /** `contestsOnEvent` names the contests on each event, which this store does not know. */
  constructor(private readonly contestsOnEvent: (sportEventId: string) => readonly string[] = () => []) {}

  async find(contestId: string, shownEvent: string): Promise<ContestLeaderboardSnapshot<Board> | null> {
    return this.rows.get(`${contestId}:${shownEvent}`) ?? null;
  }

  async findByContests(contestIds: readonly string[], shownEvent: string): Promise<ContestLeaderboardSnapshot<Board>[]> {
    return [...this.rows.values()].filter((row) => contestIds.includes(row.contestId) && row.shownEvent === shownEvent);
  }

  async findKeysByContestsOrEvents(contestIds: readonly string[], sportEventIds: readonly string[]): Promise<ContestLeaderboardSnapshotKey[]> {
    const named = new Set([...contestIds, ...sportEventIds.flatMap((sportEventId) => this.contestsOnEvent(sportEventId))]);
    return [...this.rows.values()]
      .filter((row) => named.has(row.contestId))
      .map(({ contestId, shownEvent }) => ({ contestId, shownEvent }));
  }

  async save(write: ContestLeaderboardSnapshotWrite<Board>): Promise<ContestLeaderboardSnapshot<Board> | null> {
    this.saves.push(write);
    const key = `${write.contestId}:${write.shownEvent}`;
    const stored = this.rows.get(key);
    if (stored && stored.computedFrom >= write.computedFrom) return null;
    const saved = { ...write, version: (stored?.version ?? 0) + 1 };
    this.rows.set(key, saved);
    return saved;
  }

  async delete({ contestId, shownEvent }: ContestLeaderboardSnapshotKey): Promise<void> {
    this.rows.delete(`${contestId}:${shownEvent}`);
  }
}

/** Any stored board: each kind's board lists its entries with their places. */
type PlacedBoard = { kind: string; board: { entries: readonly { entryId: string; position: number | null; displayPosition: string | null }[] } };

/**
 * Moves one entry to `position` on the contest's stored default board only (#1575), so a test can
 * tell a read answered from the stored board from one that computed the board again.
 */
export function placeOnStoredBoard<Board extends PlacedBoard>(
  snapshots: InMemoryLeaderboardSnapshots<Board>,
  contestId: string,
  entryId: string,
  position: number,
): void {
  const key = `${contestId}:`;
  const row = snapshots.rows.get(key);
  if (!row) throw new Error(`No stored default board for contest ${contestId}`);
  const entries = row.board.board.entries.map((entry) => (entry.entryId === entryId ? { ...entry, position, displayPosition: String(position) } : entry));
  snapshots.rows.set(key, { ...row, board: { ...row.board, board: { ...row.board.board, entries } } });
}
