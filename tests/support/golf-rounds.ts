import type { FieldGameResultView } from '../../packages/shared/db';
import { GameSideStatus, HomeAway, MatchStatus, ParticipantStandingStatus, type SportEventParticipantStanding } from '../../packages/shared/domain';

/**
 * A golfer's round as the field read returns it (#2008): their side result in that round's FIELD
 * Game. `status` is the side's: null while on the course, FINISHED once through.
 */
export function golfRound(input: {
  roundNumber: number;
  strokes: number;
  scoreToPar: number;
  thru?: number | null;
  status?: GameSideStatus | null;
  gameStatus?: MatchStatus;
  completedAt?: Date | null;
  updatedAt?: Date;
}): FieldGameResultView {
  const status = input.status === undefined ? GameSideStatus.FINISHED : input.status;
  const updatedAt = input.updatedAt ?? new Date('2026-05-31T18:00:00.000Z');
  return {
    sportEventRoundId: `event-round-${String(input.roundNumber)}`,
    roundNumber: input.roundNumber,
    gameStatus: input.gameStatus ?? (status === null ? MatchStatus.IN_PROGRESS : MatchStatus.COMPLETED),
    gameCompletedAt: input.completedAt ?? null,
    updatedAt,
    result: {
      sportEventRoundMatchSideId: `side-${String(input.roundNumber)}`,
      sideNumber: 1,
      score: input.strokes,
      homeAway: HomeAway.NONE,
      position: null,
      startPosition: null,
      scoreToPar: input.scoreToPar,
      periodsCompleted: input.thru === undefined ? (status === null ? null : 18) : input.thru,
      status,
      periodScores: [],
    },
  };
}

/** A golfer's core standing in the event, with its to-par and strokes. */
export function golfStanding(input: {
  sportEventParticipantId?: string;
  scoreToPar: number | null;
  total?: number | null;
  status?: ParticipantStandingStatus;
  position?: number | null;
  displayPosition?: string | null;
  asOf?: Date | null;
}): SportEventParticipantStanding {
  return {
    id: `standing-${input.sportEventParticipantId ?? 'golfer'}`,
    sportEventParticipantId: input.sportEventParticipantId ?? 'golfer',
    position: input.position ?? null,
    displayPosition: input.displayPosition ?? null,
    status: input.status ?? ParticipantStandingStatus.ACTIVE,
    asOf: input.asOf === undefined ? new Date('2026-05-31T18:00:00.000Z') : input.asOf,
    total: input.total ?? null,
    scoreToPar: input.scoreToPar,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-31T18:00:00.000Z'),
  };
}
