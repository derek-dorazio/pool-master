/**
 * A squares contest's boxes, digits and frozen winners (#711) held in memory against an
 * `InMemoryContestWorld`, so squares tests assert stored boxes, entry statuses and winners rather
 * than calls. It keeps the Prisma repository's rules: one holder per box, the box limit per entry,
 * nothing changes once the digits are drawn, and the draw submits every entry holding a box.
 */
import type {
  ContestEntrySquareClaim,
  ContestEntrySquareClaimResult,
  ContestEntrySquareClearResult,
  ContestEntrySquareKey,
  ContestSquaresDrawWrite,
  ContestSquaresRepository,
} from '@poolmaster/shared/db';
import {
  ContestEntryStatus,
  type ContestEntrySquare,
  type ContestSquaresDraw,
  type ContestSquaresWinner,
} from '@poolmaster/shared/domain';
import type { InMemoryContestWorld } from './in-memory-contest-world';

const boxKey = (contestId: string, rowIndex: number, columnIndex: number) => `${contestId}:${rowIndex}:${columnIndex}`;

export class InMemorySquares {
  readonly boxes = new Map<string, ContestEntrySquare>();
  readonly draws = new Map<string, ContestSquaresDraw>();
  readonly winners = new Map<string, ContestSquaresWinner[]>();

  constructor(private readonly world: InMemoryContestWorld, private readonly claimedAt: Date = new Date('2026-09-01T00:00:00.000Z')) {}

  /** Puts a box straight in the store, as a claim made before the test. */
  addBox(contestId: string, contestEntryId: string, rowIndex: number, columnIndex: number): ContestEntrySquare {
    const box: ContestEntrySquare = { contestId, contestEntryId, rowIndex, columnIndex, claimedByUserId: null, claimedAt: this.claimedAt };
    this.boxes.set(boxKey(contestId, rowIndex, columnIndex), box);
    return box;
  }

  boxesOf(contestId: string): ContestEntrySquare[] {
    return [...this.boxes.values()]
      .filter((box) => box.contestId === contestId)
      .sort((left, right) => left.rowIndex - right.rowIndex || left.columnIndex - right.columnIndex);
  }

  repo(): ContestSquaresRepository {
    return {
      findSquares: (contestId) => Promise.resolve(this.boxesOf(contestId)),
      claim: (claim) => Promise.resolve(this.claim(claim)),
      clear: (box) => Promise.resolve(this.clear(box)),
      findDraw: (contestId) => Promise.resolve(this.draws.get(contestId) ?? null),
      recordDraw: (draw) => Promise.resolve(this.recordDraw(draw)),
      findWinners: (contestId) => Promise.resolve([...(this.winners.get(contestId) ?? [])]),
      replaceWinners: (contestId, winners) => {
        this.winners.set(contestId, [...winners]);
        return Promise.resolve();
      },
    };
  }

  private claim(claim: ContestEntrySquareClaim): ContestEntrySquareClaimResult {
    if (this.draws.has(claim.contestId)) return 'drawn';
    const key = boxKey(claim.contestId, claim.rowIndex, claim.columnIndex);
    if (this.boxes.has(key)) return 'taken';
    const held = this.boxesOf(claim.contestId).filter((box) => box.contestEntryId === claim.contestEntryId).length;
    if (held >= claim.maxSquaresPerEntry) return 'limitReached';
    this.boxes.set(key, {
      contestId: claim.contestId,
      contestEntryId: claim.contestEntryId,
      rowIndex: claim.rowIndex,
      columnIndex: claim.columnIndex,
      claimedByUserId: claim.claimedByUserId,
      claimedAt: this.claimedAt,
    });
    return 'claimed';
  }

  private clear(box: ContestEntrySquareKey): ContestEntrySquareClearResult {
    if (this.draws.has(box.contestId)) return 'drawn';
    const key = boxKey(box.contestId, box.rowIndex, box.columnIndex);
    if (this.boxes.get(key)?.contestEntryId !== box.contestEntryId) return 'empty';
    this.boxes.delete(key);
    return 'cleared';
  }

  private recordDraw(draw: ContestSquaresDrawWrite): 'drawn' | 'alreadyDrawn' {
    if (this.draws.has(draw.contestId)) return 'alreadyDrawn';
    const { sportEventId, ...stored } = draw;
    this.draws.set(draw.contestId, stored);
    const holders = new Set(this.boxesOf(draw.contestId).map((box) => box.contestEntryId));
    for (const entryId of holders) {
      const entry = this.world.entries.get(entryId);
      if (!entry) continue;
      this.world.entries.set(entryId, {
        ...entry,
        events: entry.events.map((event) => event.sportEventId === sportEventId ? { ...event, status: ContestEntryStatus.SUBMITTED } : event),
      });
    }
    return 'drawn';
  }
}
