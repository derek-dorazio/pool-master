/**
 * ContestEntryPickService — service-layer enforcement of the contestFormat
 * denormalization invariant from plans/117 §7.1.
 *
 * Background. The unified ContestEntryPick table denormalizes
 * `Contest.contestFormat` onto each pick row so Postgres partial unique
 * indexes (which can only predicate on local columns) can enforce the
 * per-format pick uniqueness rules. This service is the single insert path
 * that guarantees the denormalized column always matches the parent contest;
 * routes / draft-engine code go through `createPick` instead of touching
 * `prisma.contestEntryPick.create` directly.
 *
 * Per plans/117 §7.1: "pick-creation always reads Contest.contestFormat from
 * the parent contest and writes it to the pick row. No insert path bypasses
 * this."
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestEntryPickDto,
  ContestEntryPickInsertInput,
} from './types';
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

export class ContestEntryPickService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Insert a ContestEntryPick. Resolves `contestFormat` from the parent
   * contest in the same transaction so the denormalized column is always
   * consistent. Callers pass per-format optional metadata (period / slot /
   * tier / cost / draftRound / draftPickNumber / isAutoPicked); the service
   * is format-agnostic — the partial unique indexes from plans/117 §7.1
   * enforce the per-format combination rules at the database layer.
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
          draftRound: input.draftRound ?? null,
          draftPickNumber: input.draftPickNumber ?? null,
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
}
