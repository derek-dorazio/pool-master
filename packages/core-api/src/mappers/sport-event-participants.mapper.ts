/**
 * SportEventParticipant mapper — Prisma row → canonical
 * SportEventParticipantDto per plans/117 §12.1.
 *
 * The per-event ranking fields (`worldRanking`, `oddsToWin`, `seedNumber`)
 * landed in pool-master-rop.78.4 and replace the dropped
 * ParticipantSeasonRecord path. Per plans/117 §4.1, world ranking and odds
 * are per-event snapshots from the provider feed at field-load time.
 */

import type { SportEventParticipantDto } from '@poolmaster/shared/dto/events.dto';

export interface SportEventParticipantRow {
  id: string;
  sportEventId: string;
  participantId: string;
  status: string | null;
  worldRanking: number | null;
  oddsToWin: { toNumber(): number } | number | null;
  seedNumber: number | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function decimalToNumber(value: { toNumber(): number } | number | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return value;
  return value.toNumber();
}

export function mapSportEventParticipantToDto(
  row: SportEventParticipantRow,
): SportEventParticipantDto {
  return {
    id: row.id,
    sportEventId: row.sportEventId,
    participantId: row.participantId,
    status: row.status,
    worldRanking: row.worldRanking,
    oddsToWin: decimalToNumber(row.oddsToWin),
    seedNumber: row.seedNumber,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
