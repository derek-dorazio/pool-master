/**
 * ContestEntryPickService — service-layer enforcement of the contestFormat
 * denormalization invariant from plans/117 §7.1.
 *
 * Background. The unified ContestEntryPick table denormalizes
 * `Contest.contestFormat` onto each pick row so Postgres partial unique
 * indexes (which can only predicate on local columns) can enforce the
 * per-format pick uniqueness rules. This service is the single insert path
 * that guarantees the denormalized column always matches the parent contest;
 * the selection room goes through `changeEntryPick` (and a draw through
 * `recordDraw`) instead of touching `prisma.contestEntryPick.create` directly.
 *
 * Per plans/117 §7.1: "pick-creation always reads Contest.contestFormat from
 * the parent contest and writes it to the pick row. No insert path bypasses
 * this."
 */

import { Prisma, type PrismaClient, type PrismaContestFormat } from '@prisma/client';
import { ContestEntryStatus } from '@poolmaster/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestDrawRecordInput,
  EntryChangeResult,
  EntryEventSettleInput,
  EntryPickChangeInput,
  LockedEntryEvent,
  LockedEntryPick,
} from './types';
import { lockContestEntryRow, lockContestRow } from '../../adapters';
import { forgettingReads, ReadMemoKey } from '../../core/request-read-memo';

export class ContestEntryPickEntryMissingError extends Error {
  constructor(entryId: string) {
    super(`ContestEntry ${entryId} not found; cannot create pick.`);
    this.name = 'ContestEntryPickEntryMissingError';
  }
}

export class ContestEntryPickContestMissingError extends Error {
  constructor(contestId: string) {
    super(`Contest ${contestId} not found; cannot resolve contestFormat for pick.`);
    this.name = 'ContestEntryPickContestMissingError';
  }
}

/** A second draw of a contest already drawn: the contest's one draw row already exists (#601). */
export class ContestDrawAlreadyRunError extends Error {
  constructor(contestId: string) {
    super(`Contest ${contestId} has already been drawn.`);
    this.name = 'ContestDrawAlreadyRunError';
  }
}

/** The contest's entries are no longer the ones the draw dealt to (#601). Nothing was written. */
export class ContestDrawEntriesChangedError extends Error {
  constructor(contestId: string) {
    super(`Contest ${contestId}'s entries changed while it was being drawn.`);
    this.name = 'ContestDrawEntriesChangedError';
  }
}

export class ContestEntryPickService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Changes one entry's roster picks in one event (#1259): removes a pick, adds one, or both for
   * a swap, then settles the entry's status there, in one transaction. The entry's row lock is
   * taken first and its picks and status read under it, so `decide` and `settle` see every
   * change that committed before this one, a submit included (#1300), and none can slip in
   * between the decision and the write. The added pick takes the parent contest's
   * `contestFormat` (plans/117 §7.1) and the next place in the contest's pick order; the ROSTER
   * partial unique index keeps a participant to one pick per entry.
   */
  async changeEntryPick(input: EntryPickChangeInput): Promise<EntryChangeResult> {
    const { entryId, sportEventId, at, decide, settle } = input;
    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await readLockedEntry(tx, entryId, sportEventId);
      const write = decide(locked.picks);
      if (write?.removePickId) await tx.contestEntryPick.delete({ where: { id: write.removePickId } });
      if (write?.add) {
        const contestPickCount = await tx.contestEntryPick.count({ where: { entry: { contestId: locked.contestId } } });
        await tx.contestEntryPick.create({
          data: {
            entryId,
            sportEventParticipantId: write.add.sportEventParticipantId,
            contestFormat: locked.contestFormat,
            lineupSlot: write.add.lineupSlot,
            pickSequence: contestPickCount + 1,
            isAutoPicked: false,
          },
        });
      }
      const picksChanged = write !== null;
      const picks = picksChanged ? await readEventPicks(tx, entryId, sportEventId) : locked.picks;
      const settled = await settleStatus(tx, locked, settle({ picks, status: locked.status, picksChanged }), at);
      return { ...settled, picksChanged, contestId: locked.contestId, write };
    });

    if (result.picksChanged) {
      this.logger?.info(
        {
          action: 'contestEntryPick.change.success',
          data: {
            entryId,
            contestId: result.contestId,
            removedPickId: result.write?.removePickId ?? null,
            addedSportEventParticipantId: result.write?.add?.sportEventParticipantId ?? null,
          },
        },
        'Changed a contest entry pick',
      );
    }
    return { picksChanged: result.picksChanged, status: result.status, submittedAt: result.submittedAt, statusChanged: result.statusChanged };
  }

  /**
   * Settles one entry's status in one event under the entry's row lock, writing no pick: a
   * submit (#1300). `settle` judges the lineup as it stands once locked, so a pick change in
   * flight finishes first and its lineup is the one judged.
   */
  async settleEntryEvent(input: EntryEventSettleInput): Promise<EntryChangeResult> {
    const { entryId, sportEventId, at, settle } = input;
    return this.prisma.$transaction(async (tx) => {
      const locked = await readLockedEntry(tx, entryId, sportEventId);
      const settled = await settleStatus(tx, locked, settle({ picks: locked.picks, status: locked.status }), at);
      return { ...settled, picksChanged: false };
    });
  }

  /**
   * Records a random draw (#601) in one transaction: the draw row, every dealt pick, and every
   * entry submitted. All or nothing, so a contest is never half dealt.
   *
   * The draw row's unique contest key is the guard against two draws racing: the second
   * insert fails, and nothing of it is written. The entries are re-read inside the
   * transaction, so an entry added or removed after the deal was worked out stops the write
   * instead of leaving an entry with no picks. Picks take the parent contest's
   * `contestFormat`, as `changeEntryPick` does (plans/117 §7.1). Each pick's `lineupSlot` is its
   * round of the deal, and its `pickSequence` its place in the deal across the contest.
   *
   * Answers with the draw's time, the contest's `drawnAt` and every entry's submit time, so the
   * caller can show the dealt room without reading the contest and its entries again (#1196).
   */
  async recordDraw(input: ContestDrawRecordInput): Promise<{ drawnAt: Date }> {
    const { contestId } = input;
    // The contest's read carries its draw time, so the request's remembered contests are forgotten.
    const drawnAt = await forgettingReads(ReadMemoKey.contest, () => this.prisma.$transaction(async (tx) => {
      // Entry writes take the same lock, so the entry set read below cannot change before commit (#644).
      await lockContestRow(tx, contestId);
      const contest = await tx.contest.findUnique({ where: { id: contestId }, select: { contestFormat: true } });
      if (!contest) throw new ContestEntryPickContestMissingError(contestId);

      const currentEntries = await tx.contestEntry.findMany({ where: { contestId }, select: { id: true } });
      const dealtEntryIds = new Set(input.entries.map((entry) => entry.entryId));
      if (currentEntries.length !== dealtEntryIds.size || currentEntries.some((entry) => !dealtEntryIds.has(entry.id))) {
        throw new ContestDrawEntriesChangedError(contestId);
      }

      let draw: { drawnAt: Date };
      try {
        draw = await tx.contestDraw.create({
          data: {
            contestId,
            seed: input.seed,
            fieldOrder: [...input.fieldOrder],
            entryOrder: [...input.entryOrder],
            drawnByUserId: input.drawnByUserId,
          },
          select: { drawnAt: true },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ContestDrawAlreadyRunError(contestId);
        }
        throw error;
      }

      const entryCount = input.entries.length;
      await tx.contestEntryPick.createMany({
        data: input.entries.flatMap((entry, entryIndex) =>
          entry.sportEventParticipantIds.map((sportEventParticipantId, round) => ({
            entryId: entry.entryId,
            sportEventParticipantId,
            contestFormat: contest.contestFormat,
            lineupSlot: round + 1,
            pickSequence: round * entryCount + entryIndex + 1,
            isAutoPicked: true,
          }))),
      });

      // A random draw covers one event (#713), so each entry's one event row is the one submitted.
      await tx.contestEntryEvent.updateMany({
        where: { contestEntryId: { in: [...dealtEntryIds] } },
        data: { status: ContestEntryStatus.SUBMITTED, submittedAt: draw.drawnAt },
      });
      return draw.drawnAt;
    }));

    this.logger?.info(
      {
        action: 'contestEntryPick.recordDraw.success',
        data: { contestId, entryCount: input.entries.length, fieldSize: input.fieldOrder.length },
      },
      'Recorded a random draw and its dealt picks',
    );
    return { drawnAt };
  }
}

interface LockedEntry extends LockedEntryEvent {
  entryId: string;
  sportEventId: string;
  contestId: string;
  contestFormat: PrismaContestFormat;
  submittedAt: Date | null;
}

/** Locks the entry's row, then reads its contest, its status in the event and its picks there. */
async function readLockedEntry(tx: Prisma.TransactionClient, entryId: string, sportEventId: string): Promise<LockedEntry> {
  await lockContestEntryRow(tx, entryId);
  const entry = await tx.contestEntry.findUnique({
    where: { id: entryId },
    select: {
      contestId: true,
      contest: { select: { contestFormat: true } },
      events: { where: { sportEventId }, select: { status: true, submittedAt: true } },
    },
  });
  if (!entry) throw new ContestEntryPickEntryMissingError(entryId);
  const event = entry.events.at(0);
  return {
    entryId,
    sportEventId,
    contestId: entry.contestId,
    contestFormat: entry.contest.contestFormat,
    status: event?.status ?? ContestEntryStatus.DRAFT,
    submittedAt: event?.submittedAt ?? null,
    picks: await readEventPicks(tx, entryId, sportEventId),
  };
}

async function readEventPicks(tx: Prisma.TransactionClient, entryId: string, sportEventId: string): Promise<LockedEntryPick[]> {
  const rows = await tx.contestEntryPick.findMany({
    where: { entryId, sportEventParticipant: { sportEventId } },
    select: { id: true, sportEventParticipantId: true, lineupSlot: true, sportEventParticipant: { select: { participantId: true } } },
    orderBy: [{ pickedAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => ({
    id: row.id,
    sportEventParticipantId: row.sportEventParticipantId,
    participantId: row.sportEventParticipant.participantId,
    lineupSlot: row.lineupSlot,
  }));
}

/** Writes the status `settle` chose, when it differs; a SUBMITTED event is stamped `at`. */
async function settleStatus(
  tx: Prisma.TransactionClient,
  locked: LockedEntry,
  next: ContestEntryStatus | null,
  at: Date,
): Promise<Pick<EntryChangeResult, 'status' | 'submittedAt' | 'statusChanged'>> {
  if (next === null || next === locked.status) {
    return { status: locked.status, submittedAt: locked.submittedAt, statusChanged: false };
  }
  const submittedAt = next === ContestEntryStatus.SUBMITTED ? at : null;
  await tx.contestEntryEvent.upsert({
    where: { contestEntryId_sportEventId: { contestEntryId: locked.entryId, sportEventId: locked.sportEventId } },
    create: { contestEntryId: locked.entryId, sportEventId: locked.sportEventId, status: next, submittedAt },
    update: { status: next, submittedAt },
  });
  return { status: next, submittedAt, statusChanged: true };
}
