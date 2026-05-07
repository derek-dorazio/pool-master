/**
 * ContestEntryPick mappers — persistence row → canonical DTO.
 *
 * The Prisma row is the pick's raw persistence shape (with Decimal cost,
 * nullable optional columns, Date timestamps). The DTO surface uses ISO
 * datetime strings, primitive `number | null` for nullable optionals, and
 * the typed `ContestFormat` enum.
 *
 * See plans/117 §4.3 (unified pick model), §7.1 (denormalization invariant),
 * §12.1 (canonical DTO surface).
 */

import type { ContestEntryPick } from '@poolmaster/shared/domain';
import type { ContestEntryPickDto } from '@poolmaster/shared/dto';

/**
 * Shape of the Prisma row read by `prisma.contestEntryPick.findUnique` /
 * `findMany` / `create`. Decimals arrive as Prisma `Decimal`-like objects
 * with `toNumber()`; we accept the broader `unknown` here and narrow at
 * runtime so the mapper works against both the Prisma client and hand-built
 * fixtures in tests.
 */
export interface ContestEntryPickRow {
  id: string;
  entryId: string;
  sportEventParticipantId: string;
  contestFormat: string;
  period: number | null;
  slot: number | null;
  tier: string | null;
  cost: { toNumber(): number } | number | null;
  isAutoPicked: boolean;
  draftRound: number | null;
  draftPickNumber: number | null;
  pickedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function decimalToNumber(value: { toNumber(): number } | number | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return value;
  return value.toNumber();
}

export function mapContestEntryPickToDto(row: ContestEntryPickRow): ContestEntryPickDto {
  return {
    id: row.id,
    entryId: row.entryId,
    sportEventParticipantId: row.sportEventParticipantId,
    contestFormat: row.contestFormat,
    period: row.period,
    slot: row.slot,
    tier: row.tier,
    cost: decimalToNumber(row.cost),
    isAutoPicked: row.isAutoPicked,
    draftRound: row.draftRound,
    draftPickNumber: row.draftPickNumber,
    pickedAt: row.pickedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Domain-shape ContestEntryPick (no DTO, used by service-internal code). */
export function mapContestEntryPickRowToDomain(row: ContestEntryPickRow): ContestEntryPick {
  return {
    id: row.id,
    entryId: row.entryId,
    sportEventParticipantId: row.sportEventParticipantId,
    contestFormat: row.contestFormat as ContestEntryPick['contestFormat'],
    period: row.period ?? undefined,
    slot: row.slot ?? undefined,
    tier: row.tier ?? undefined,
    cost: decimalToNumber(row.cost) ?? undefined,
    isAutoPicked: row.isAutoPicked,
    draftRound: row.draftRound ?? undefined,
    draftPickNumber: row.draftPickNumber ?? undefined,
    pickedAt: row.pickedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
