import type {
  AdminEventParticipantDto,
  AdminEventSummaryDto,
} from '@poolmaster/shared/dto';
import type {
  EventReadinessReasonDto,
  EventReadinessStatusDto,
  EventStatusDto,
} from '@poolmaster/shared/dto/events.dto';
import type { Sport } from '@poolmaster/shared/domain';
import { evaluateEventOperationalState } from '../modules/events/operational-timing';

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

export interface AdminEventSummaryRow {
  id: string;
  externalId: string;
  providerId: string;
  sport: string;
  name: string;
  venue: string | null;
  location: string | null;
  status: string;
  startDate: Date;
  endDate: Date | null;
  releaseAt: Date;
  fieldLocksAt: Date;
  fieldLocked: boolean;
  participantCount: number | null;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    sportEventParticipants: number;
  };
}

export interface AdminEventParticipantRow {
  id: string;
  sportEventId: string;
  participantId: string;
  status: string | null;
  worldRanking: number | null;
  oddsToWin: DecimalLike | number | null;
  seedNumber: number | null;
  updatedAt: Date;
  participant: {
    name: string;
    shortName: string | null;
    nationality: string | null;
  };
  valuations: Array<{
    price: number | null;
    tier: string | null;
    orderIndex: number | null;
  }>;
  golfRounds: Array<{
    round: number;
    strokes: number;
    scoreToPar: number;
    status: string;
    completedAt: Date | null;
  }>;
}

export function mapAdminEventSummaryToDto(
  row: AdminEventSummaryRow,
): AdminEventSummaryDto {
  const loadedParticipantCount = row._count.sportEventParticipants;
  const operationalState = evaluateEventOperationalState({
    participantCount: loadedParticipantCount,
    releaseAt: row.releaseAt,
    fieldLocksAt: row.fieldLocksAt,
    providerFieldLocked: row.fieldLocked,
  });

  return {
    id: row.id,
    externalId: row.externalId,
    providerId: row.providerId,
    sport: row.sport as Sport,
    name: row.name,
    ...(row.venue !== null ? { venue: row.venue } : {}),
    ...(row.location !== null ? { location: row.location } : {}),
    status: row.status as EventStatusDto,
    startDate: row.startDate.toISOString(),
    ...(row.endDate ? { endDate: row.endDate.toISOString() } : {}),
    releaseAt: row.releaseAt.toISOString(),
    fieldLocksAt: row.fieldLocksAt.toISOString(),
    fieldLocked: operationalState.fieldLocked,
    ...(row.participantCount !== null ? { participantCount: row.participantCount } : {}),
    loadedParticipantCount,
    readinessStatus: operationalState.readinessStatus as EventReadinessStatusDto,
    readinessReasons: operationalState.readinessReasons as EventReadinessReasonDto[],
    contestEligible: operationalState.contestEligible,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapAdminEventParticipantToDto(
  row: AdminEventParticipantRow,
): AdminEventParticipantDto {
  const primaryValuation = row.valuations[0];
  const oddsToWin = toNumberOrNull(row.oddsToWin);
  const scoreToPar = row.golfRounds.length
    ? row.golfRounds.reduce((sum, round) => sum + round.scoreToPar, 0)
    : null;
  const totalStrokes = row.golfRounds.length
    ? row.golfRounds.reduce((sum, round) => sum + round.strokes, 0)
    : null;

  return {
    id: row.id,
    sportEventId: row.sportEventId,
    participantId: row.participantId,
    participantName: row.participant.name,
    ...(row.participant.shortName !== null ? { shortName: row.participant.shortName } : {}),
    ...(row.participant.nationality !== null ? { nationality: row.participant.nationality } : {}),
    ...(row.status !== null ? { status: row.status } : {}),
    ...(row.worldRanking !== null ? { worldRanking: row.worldRanking } : {}),
    ...(oddsToWin !== null ? { oddsToWin } : {}),
    ...(row.seedNumber !== null ? { seedNumber: row.seedNumber } : {}),
    ...(primaryValuation?.price !== null && primaryValuation?.price !== undefined
      ? { valuationPrice: primaryValuation.price }
      : {}),
    ...(primaryValuation?.tier !== null && primaryValuation?.tier !== undefined
      ? { valuationTier: primaryValuation.tier }
      : {}),
    ...(primaryValuation?.orderIndex !== null && primaryValuation?.orderIndex !== undefined
      ? { valuationOrderIndex: primaryValuation.orderIndex }
      : {}),
    roundCount: row.golfRounds.length,
    ...(totalStrokes !== null ? { totalStrokes } : {}),
    ...(scoreToPar !== null ? { scoreToPar } : {}),
    golfRounds: row.golfRounds.map((round) => ({
      round: round.round,
      strokes: round.strokes,
      scoreToPar: round.scoreToPar,
      status: round.status,
      ...(round.completedAt ? { completedAt: round.completedAt.toISOString() } : {}),
    })),
    updatedAt: row.updatedAt.toISOString(),
  };
}
