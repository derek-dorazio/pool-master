/**
 * SportEventParticipant mapper — Prisma row → canonical
 * SportEventParticipantDto per plans/117 §4.1 / §12.1.
 *
 * Pure projection. The per-event ranking fields (`worldRanking`,
 * `oddsToWin`, `seedNumber`) landed in pool-master-rop.78.4 and replace
 * the dropped ParticipantSeasonRecord path.
 *
 * `oddsToWin` arrives as a Prisma Decimal-like object on the row; the
 * mapper coerces to a plain number so the DTO stays JSON-serializable.
 * This is the only transformation in the mapper — every other field is
 * a direct field-to-field projection.
 */

import type { SportEventParticipantDto } from '@poolmaster/shared/dto/events.dto';

interface DecimalLike {
  toNumber(): number;
}

function isDecimalLike(value: unknown): value is DecimalLike {
  return typeof value === 'object' && value !== null && typeof (value as DecimalLike).toNumber === 'function';
}

export interface SportEventParticipantRow {
  id: string;
  sportEventId: string;
  participantId: string;
  status: string | null;
  worldRanking: number | null;
  oddsToWin: DecimalLike | number | null;
  seedNumber: number | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export function mapSportEventParticipantToDto(
  row: SportEventParticipantRow,
): SportEventParticipantDto {
  let oddsToWin: number | null;
  if (row.oddsToWin === null) {
    oddsToWin = null;
  } else if (typeof row.oddsToWin === 'number') {
    oddsToWin = row.oddsToWin;
  } else if (isDecimalLike(row.oddsToWin)) {
    oddsToWin = row.oddsToWin.toNumber();
  } else {
    oddsToWin = null;
  }

  return {
    id: row.id,
    sportEventId: row.sportEventId,
    participantId: row.participantId,
    status: row.status,
    worldRanking: row.worldRanking,
    oddsToWin,
    seedNumber: row.seedNumber,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
