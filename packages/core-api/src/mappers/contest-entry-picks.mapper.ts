/**
 * ContestEntryPick mappers — persistence row → domain pick.
 *
 * The Prisma row is the pick's raw persistence shape (with Decimal cost,
 * nullable optional columns, Date timestamps). The DTO surface uses ISO
 * datetime strings and primitive `number | null` for nullable optionals.
 */

import type { ContestEntryPick } from '@poolmaster/shared/domain';

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
  tier: string | null;
  cost: { toNumber(): number } | number | null;
  isAutoPicked: boolean;
  lineupSlot: number | null;
  pickSequence: number | null;
  pickedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function decimalToNumber(value: { toNumber(): number } | number | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return value;
  return value.toNumber();
}

/** Domain-shape ContestEntryPick (no DTO, used by service-internal code). */
export function mapContestEntryPickRowToDomain(row: ContestEntryPickRow): ContestEntryPick {
  return {
    id: row.id,
    entryId: row.entryId,
    sportEventParticipantId: row.sportEventParticipantId,
    tier: row.tier ?? undefined,
    cost: decimalToNumber(row.cost) ?? undefined,
    isAutoPicked: row.isAutoPicked,
    lineupSlot: row.lineupSlot ?? undefined,
    pickSequence: row.pickSequence ?? undefined,
    pickedAt: row.pickedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
