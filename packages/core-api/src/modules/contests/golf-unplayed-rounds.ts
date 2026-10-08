/**
 * #478 — every round a golfer does not play scores a fixed 80 strokes in contest scoring. A
 * contest ranks on to-par, so a round's 80 counts as 80 minus that round's par: +8 on a par 72.
 * This is contest scoring only; the event's own standing keeps the golfer's real to-par.
 *
 * Which rounds are unplayed:
 * - a golfer out of the event (cut, withdrawn or disqualified, or removed from the field):
 *   every scheduled round they did not finish, including the one they withdrew during;
 * - a golfer still in it with no score at all: every round the field has moved past (a later
 *   round has started, or the event is complete). A golfer still in it with a score keeps
 *   their live to-par untouched, so a round suspended overnight is never penalised.
 *
 * A round's par is the event's `roundsPar` when an admin set one, else strokes minus to-par
 * on any golfer's finished round of that number. With neither, the round is not penalised
 * yet. Rounds past the event's scheduled count are never scored (#375).
 */
import {
  ParticipantRoundStatus,
  ParticipantStandingStatus,
  SportEventStatus,
  type SportEvent,
} from '@poolmaster/shared/domain';
import type {
  ParticipantRoundView,
  SportEventParticipantView,
} from '../events/sport-event-participant-service';

/** What one unplayed round scores, in strokes. */
export const UNPLAYED_ROUND_STROKES = 80;

/** What unplayed-round scoring reads off the event. */
export type UnplayedRoundScoringEvent = Pick<SportEvent, 'rounds' | 'roundsPar' | 'status'>;

/** A golfer's contest score and the rounds in it that were scored as 80 strokes. */
export interface GolfContestScore {
  score: number | null;
  unplayedRoundNumbers: number[];
}

/** A round played to the end: completed, or completed and then cut on. */
function isRoundFinished(round: ParticipantRoundView): boolean {
  return round.golf !== null && (
    round.round.status === ParticipantRoundStatus.COMPLETED
    || round.round.status === ParticipantRoundStatus.MISSED_CUT
  );
}

function isOutOfEvent(row: SportEventParticipantView): boolean {
  const status = row.standing?.standing.status;
  return !row.entry.isActive
    || status === ParticipantStandingStatus.WITHDRAWN
    || status === ParticipantStandingStatus.ELIMINATED;
}

/** The field-wide facts every golfer's score is read against, computed once per field. */
export interface UnplayedRoundContext {
  scheduledRoundNumbers: number[];
  parByRound: Map<number, number>;
  /** The highest round any golfer has a score for; rounds below it the field has moved past. */
  highestStartedRound: number;
  eventComplete: boolean;
}

export function buildUnplayedRoundContext(
  field: readonly SportEventParticipantView[],
  event: UnplayedRoundScoringEvent,
): UnplayedRoundContext {
  let highestStartedRound = 0;
  const derivedPar = new Map<number, number>();
  for (const row of field) {
    for (const round of row.rounds) {
      highestStartedRound = Math.max(highestStartedRound, round.round.roundNumber);
      if (round.golf && isRoundFinished(round) && !derivedPar.has(round.round.roundNumber)) {
        derivedPar.set(round.round.roundNumber, round.golf.strokes - round.golf.scoreToPar);
      }
    }
  }
  // An event with no round count scores only the rounds the field has played.
  const scheduledRounds = event.rounds ?? highestStartedRound;
  const scheduledRoundNumbers = Array.from({ length: scheduledRounds }, (_, index) => index + 1);
  const parByRound = new Map<number, number>();
  for (const roundNumber of scheduledRoundNumbers) {
    const par = event.roundsPar ?? derivedPar.get(roundNumber);
    if (par !== undefined) {
      parByRound.set(roundNumber, par);
    }
  }
  return {
    scheduledRoundNumbers,
    parByRound,
    highestStartedRound,
    eventComplete: event.status === SportEventStatus.COMPLETED,
  };
}

export function scoreGolferForContest(
  row: SportEventParticipantView,
  context: UnplayedRoundContext,
): GolfContestScore {
  const scoreUnplayed = (roundNumbers: readonly number[]) => {
    const unplayedRoundNumbers = roundNumbers.filter((roundNumber) => context.parByRound.has(roundNumber));
    const penalty = unplayedRoundNumbers.reduce(
      (sum, roundNumber) => sum + UNPLAYED_ROUND_STROKES - (context.parByRound.get(roundNumber) ?? 0),
      0,
    );
    return { unplayedRoundNumbers, penalty };
  };

  // Out of the event: the rounds they finished, then 80 for every other scheduled round. A
  // round they withdrew partway through is dropped for its 80.
  if (isOutOfEvent(row)) {
    const finished = new Map(row.rounds.filter(isRoundFinished).map((round) => [round.round.roundNumber, round]));
    const { unplayedRoundNumbers, penalty } = scoreUnplayed(
      context.scheduledRoundNumbers.filter((roundNumber) => !finished.has(roundNumber)),
    );
    const played = context.scheduledRoundNumbers
      .reduce((sum, roundNumber) => sum + (finished.get(roundNumber)?.golf?.scoreToPar ?? 0), 0);
    const hasScore = unplayedRoundNumbers.length > 0
      || context.scheduledRoundNumbers.some((roundNumber) => finished.has(roundNumber));
    return { score: hasScore ? played + penalty : null, unplayedRoundNumbers };
  }

  // Still in it with a score: their live event to-par, untouched.
  const live = row.standing?.golf?.eventScoreToPar ?? null;
  if (live !== null || row.rounds.length > 0) {
    return { score: live, unplayedRoundNumbers: [] };
  }

  // Still in it with no score at all: 80 for each round the field has moved past.
  const { unplayedRoundNumbers, penalty } = scoreUnplayed(
    context.scheduledRoundNumbers.filter(
      (roundNumber) => context.eventComplete || roundNumber < context.highestStartedRound,
    ),
  );
  return { score: unplayedRoundNumbers.length > 0 ? penalty : null, unplayedRoundNumbers };
}
