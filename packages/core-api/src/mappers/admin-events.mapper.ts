import type { AdminEventParticipantDto } from '@poolmaster/shared/dto';
import type { ParticipantStandingStatus } from '@prisma/client';
import {
  deriveLegacyParticipantStatus,
  type ParticipantInactiveReason,
} from '@poolmaster/shared/domain';

interface DecimalLike {
  toNumber(): number;
}

function isDecimalLike(value: unknown): value is DecimalLike {
  return typeof value === 'object' && value !== null && typeof (value as DecimalLike).toNumber === 'function';
}

function toNumberOrNull(value: DecimalLike | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (isDecimalLike(value)) {
    return value.toNumber();
  }
  return null;
}

function mapGolfStandingStatusToDto(
  status: ParticipantStandingStatus,
): 'active' | 'in-progress' | 'complete' | 'withdrawn' | 'missed-cut' {
  switch (status) {
    case 'IN_PROGRESS':
      return 'in-progress';
    case 'COMPLETE':
      return 'complete';
    case 'WITHDRAWN':
      return 'withdrawn';
    // The golf browser renders the cross-sport ELIMINATED as a missed cut.
    case 'ELIMINATED':
      return 'missed-cut';
    case 'ACTIVE':
      return 'active';
  }
}

export interface AdminEventParticipantRow {
  id: string;
  sportEventId: string;
  participantId: string;
  isActive: boolean;
  inactiveReason: string | null;
  ranking: number | null;
  oddsToWin: DecimalLike | number | null;
  seedNumber: number | null;
  updatedAt: Date;
  participant: {
    name: string;
    shortName: string | null;
    nationality: string | null;
  };
  /** Resolved via golf-tier-service.getEffectiveValuationsForSportEvent (plans/124 §4.6b) — undefined when the golfer has no tier/price assigned yet. */
  valuation?: {
    price: number | null;
    tierLabel: string | null;
    tierOrderIndex: number | null;
  };
  golfRounds: Array<{
    sportEventRound: { roundNumber: number };
    strokes: number;
    scoreToPar: number;
    thru: number | null;
    status: string;
    completedAt: Date | null;
  }>;
  golfStanding: {
    eventScoreToPar: number;
    eventStrokes: number;
    currentRound: number | null;
    currentRoundThru: number | null;
    status: ParticipantStandingStatus;
    position: number | null;
    displayPosition: string | null;
    asOf: Date | null;
  } | null;
}

export function mapAdminEventParticipantToDto(
  row: AdminEventParticipantRow,
): AdminEventParticipantDto {
  const oddsToWin = toNumberOrNull(row.oddsToWin);
  const scoreToPar = row.golfStanding
    ? row.golfStanding.eventScoreToPar
    : row.golfRounds.length
    ? row.golfRounds.reduce((sum, round) => sum + round.scoreToPar, 0)
    : null;
  const totalStrokes = row.golfStanding
    ? row.golfStanding.eventStrokes
    : row.golfRounds.length
    ? row.golfRounds.reduce((sum, round) => sum + round.strokes, 0)
    : null;

  return {
    id: row.id,
    sportEventId: row.sportEventId,
    participantId: row.participantId,
    participantName: row.participant.name,
    ...(row.participant.shortName !== null ? { shortName: row.participant.shortName } : {}),
    ...(row.participant.nationality !== null ? { nationality: row.participant.nationality } : {}),
    status: deriveLegacyParticipantStatus(row.isActive, row.inactiveReason as ParticipantInactiveReason | null),
    ...(row.ranking !== null ? { ranking: row.ranking } : {}),
    ...(oddsToWin !== null ? { oddsToWin } : {}),
    ...(row.seedNumber !== null ? { seedNumber: row.seedNumber } : {}),
    ...(row.valuation?.price !== null && row.valuation?.price !== undefined
      ? { valuationPrice: row.valuation.price }
      : {}),
    ...(row.valuation?.tierLabel !== undefined && row.valuation?.tierLabel !== null
      ? { valuationTier: row.valuation.tierLabel }
      : {}),
    ...(row.valuation?.tierOrderIndex !== null && row.valuation?.tierOrderIndex !== undefined
      ? { valuationOrderIndex: row.valuation.tierOrderIndex }
      : {}),
    roundCount: row.golfRounds.length,
    ...(totalStrokes !== null ? { totalStrokes } : {}),
    ...(scoreToPar !== null ? { scoreToPar } : {}),
    ...(row.golfStanding
      ? {
          golfStanding: {
            eventScoreToPar: row.golfStanding.eventScoreToPar,
            eventStrokes: row.golfStanding.eventStrokes,
            ...(row.golfStanding.currentRound !== null ? { currentRound: row.golfStanding.currentRound } : {}),
            ...(row.golfStanding.currentRoundThru !== null ? { currentRoundThru: row.golfStanding.currentRoundThru } : {}),
            status: mapGolfStandingStatusToDto(row.golfStanding.status),
            ...(row.golfStanding.position !== null ? { position: row.golfStanding.position } : {}),
            ...(row.golfStanding.displayPosition !== null ? { displayPosition: row.golfStanding.displayPosition } : {}),
            ...(row.golfStanding.asOf ? { asOf: row.golfStanding.asOf.toISOString() } : {}),
          },
        }
      : {}),
    golfRounds: row.golfRounds.map((round) => ({
      round: round.sportEventRound.roundNumber,
      strokes: round.strokes,
      scoreToPar: round.scoreToPar,
      ...(round.thru !== null ? { thru: round.thru } : {}),
      status: round.status,
      ...(round.completedAt ? { completedAt: round.completedAt.toISOString() } : {}),
    })),
    updatedAt: row.updatedAt.toISOString(),
  };
}
