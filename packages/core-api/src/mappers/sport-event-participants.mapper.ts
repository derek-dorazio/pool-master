/**
 * SportEventParticipant mapper — Prisma row → canonical
 * SportEventParticipantDto per plans/117 §4.1 / §12.1.
 *
 * Pure projection. `worldRanking` is copied from the latest provider-scoped
 * global ranking snapshot during event hydration; `oddsToWin` and
 * `seedNumber` are event-scoped values from the event detail feed.
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
  isActive: boolean;
  inactiveReason: string | null;
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
    isActive: row.isActive,
    inactiveReason: row.inactiveReason as SportEventParticipantDto['inactiveReason'],
    worldRanking: row.worldRanking,
    oddsToWin,
    seedNumber: row.seedNumber,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
