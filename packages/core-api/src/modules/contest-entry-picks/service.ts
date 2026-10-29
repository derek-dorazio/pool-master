/**
 * ContestEntryPickService — service-layer enforcement of the contestFormat
 * denormalization invariant from plans/117 §7.1.
 *
 * Background. The unified ContestEntryPick table denormalizes
 * `Contest.contestFormat` onto each pick row so Postgres partial unique
 * indexes (which can only predicate on local columns) can enforce the
 * per-format pick uniqueness rules. This service is the single insert path
 * that guarantees the denormalized column always matches the parent contest;
 * routes / selection-engine code go through `createPick` instead of touching
 * `prisma.contestEntryPick.create` directly.
 *
 * Per plans/117 §7.1: "pick-creation always reads Contest.contestFormat from
 * the parent contest and writes it to the pick row. No insert path bypasses
 * this."
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { ContestEntryStatus } from '@poolmaster/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestDrawRecordInput,
  ContestEntryPickDto,
  ContestEntryPickInsertInput,
} from './types';
import { lockContestRow } from '../../adapters';
import { mapContestEntryPickToDto } from '../../mappers/contest-entry-picks.mapper';

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
   * Insert a ContestEntryPick. Resolves `contestFormat` from the parent
   * contest in the same transaction so the denormalized column is always
   * consistent. Callers pass optional metadata (tier / cost / lineupSlot /
   * pickSequence / isAutoPicked); the service is format-agnostic, and the
   * ROSTER partial unique index keeps a participant to one pick per entry.
   */
  async createPick(input: ContestEntryPickInsertInput): Promise<ContestEntryPickDto> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.contestEntry.findUnique({
        where: { id: input.entryId },
        select: { contestId: true },
      });
      if (!entry) {
        this.logger?.warn(
          { action: 'contestEntryPick.create.missingEntry', data: { entryId: input.entryId } },
          'Cannot create pick — owning entry not found',
        );
        throw new ContestEntryPickEntryMissingError(input.entryId);
      }

      const contest = await tx.contest.findUnique({
        where: { id: entry.contestId },
        select: { contestFormat: true },
      });
      if (!contest) {
        this.logger?.error(
          {
            action: 'contestEntryPick.create.missingContest',
            data: { entryId: input.entryId, contestId: entry.contestId },
          },
          'Cannot create pick — parent contest not found',
        );
        throw new ContestEntryPickContestMissingError(entry.contestId);
      }

      const row = await tx.contestEntryPick.create({
        data: {
          entryId: input.entryId,
          sportEventParticipantId: input.sportEventParticipantId,
          contestFormat: contest.contestFormat,
          period: input.period ?? null,
          slot: input.slot ?? null,
          tier: input.tier ?? null,
          cost: input.cost ?? null,
          isAutoPicked: input.isAutoPicked ?? false,
          lineupSlot: input.lineupSlot ?? null,
          pickSequence: input.pickSequence ?? null,
          ...(input.pickedAt !== undefined ? { pickedAt: input.pickedAt } : {}),
        },
      });

      this.logger?.info(
        {
          action: 'contestEntryPick.create.success',
          data: {
            entryId: input.entryId,
            contestId: entry.contestId,
            contestFormat: contest.contestFormat,
            pickId: row.id,
          },
        },
        'Created contest entry pick with denormalized contestFormat',
      );

      return mapContestEntryPickToDto(row);
    });
  }

  /**
   * Remove a pick. Here rather than on `ContestEntryPickRepository` because that port is
   * read-only by design (#247): a `create` on it would be a second insert path past the
   * `contestFormat` resolution above. A delete has no such invariant to maintain, but pick
   * writes still belong together on one service, so the port stays read-only and both of a
   * tiered selection's deletes — replacing a pick in a full tier, and toggling one off —
   * come through here (#324).
   */
  async deletePick(pickId: string): Promise<void> {
    await this.prisma.contestEntryPick.delete({ where: { id: pickId } });
    this.logger?.info(
      { action: 'contestEntryPick.delete.success', data: { pickId } },
      'Deleted contest entry pick',
    );
  }

  /**
   * Records a random draw (#601) in one transaction: the draw row, every dealt pick, and every
   * entry submitted. All or nothing, so a contest is never half dealt.
   *
   * The draw row's unique contest key is the guard against two draws racing: the second
   * insert fails, and nothing of it is written. The entries are re-read inside the
   * transaction, so an entry added or removed after the deal was worked out stops the write
   * instead of leaving an entry with no picks. Picks take the parent contest's
   * `contestFormat`, as `createPick` does (plans/117 §7.1). Each pick's `lineupSlot` is its
   * round of the deal, and its `pickSequence` its place in the deal across the contest.
   *
   * Answers with the draw's time, the contest's `drawnAt` and every entry's submit time, so the
   * caller can show the dealt room without reading the contest and its entries again (#1196).
   */
  async recordDraw(input: ContestDrawRecordInput): Promise<{ drawnAt: Date }> {
    const { contestId } = input;
    const drawnAt = await this.prisma.$transaction(async (tx) => {
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
    });

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
