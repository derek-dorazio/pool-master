/**
 * #478 — every round a golfer does not play scores a fixed 80 strokes in contest scoring. A
 * contest ranks on to-par, so a round's 80 counts as 80 minus that round's par: +8 on a par 72.
 * This is contest scoring only; the event's own standing keeps the golfer's real to-par.
 *
 * Which rounds are unplayed:
 * - a golfer out of the event (cut, withdrawn or disqualified, or removed from the field):
 *   every scheduled round they did not finish, including the one they withdrew during;
 * - once the event is complete, every golfer the same way: there is nothing left to wait for;
 * - mid-event, a golfer still in it with no score at all: every round the field has moved past
 *   (a later round has started). A golfer still in it with a score keeps their live to-par
 *   untouched until the event completes, so a round suspended overnight is never penalised.
 *
 * A round's par is the event's `roundsPar` when an admin set one, else strokes minus to-par
 * on any golfer's finished round of that number. With neither, the round is not penalised
 * yet. Rounds past the event's scheduled count are never scored (#375).
 */
import {
  GameSideStatus,
  ParticipantStandingStatus,
  SportEventStatus,
  type SportEvent,
  SportEventParticipantStatus,
} from '@poolmaster/shared/domain';
import type { SportEventParticipantView } from '../../events/sport-event-participant-service';
import { scoredRoundsOf, type ScoredRound } from './scored-rounds';

/** What one unplayed round scores, in strokes. */
export const UNPLAYED_ROUND_STROKES = 80;

/** What unplayed-round scoring reads off the event. */
export type UnplayedRoundScoringEvent = Pick<SportEvent, 'rounds' | 'roundsPar' | 'status' | 'slotDefinitions'>;

/**
 * How many holes each of a stroke-play event's rounds has (#2047): the period count of the slot
 * its rounds are played in, which every round of a tournament shares. Null when the event covers
 * no slot with one, or slots that disagree.
 */
export function holesPerRound(event: Pick<SportEvent, 'slotDefinitions'>): number | null {
  const counts = [...new Set(event.slotDefinitions.map((definition) => definition.periods?.count ?? null))];
  return counts.length === 1 ? counts[0] : null;
}

/** A golfer's contest score and the rounds in it that were scored as 80 strokes. */
export interface GolfContestScore {
  score: number | null;
  unplayedRoundNumbers: number[];
}

/**
 * A round played to the end: finished, or every hole of the round (`holes`, from
 * `holesPerRound`) scored while the status has not caught up (the event can complete before the
 * last group's round is marked finished).
 */
export function isRoundFinished(round: ScoredRound, holes: number | null): boolean {
  return round.result.status === GameSideStatus.FINISHED
    || (round.result.status === null && holes !== null && round.result.periodsCompleted === holes);
}

export function isOutOfEvent(row: SportEventParticipantView): boolean {
  const status = row.standing?.status;
  return row.entry.status !== SportEventParticipantStatus.ACTIVE
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
  /** `holesPerRound` of the event. */
  holes: number | null;
}

export function buildUnplayedRoundContext(
  field: readonly SportEventParticipantView[],
  event: UnplayedRoundScoringEvent,
): UnplayedRoundContext {
  let highestStartedRound = 0;
  const holes = holesPerRound(event);
  const derivedPar = new Map<number, number>();
  for (const row of field) {
    for (const round of scoredRoundsOf(row)) {
      highestStartedRound = Math.max(highestStartedRound, round.roundNumber);
      if (isRoundFinished(round, holes) && !derivedPar.has(round.roundNumber)) {
        derivedPar.set(round.roundNumber, round.result.score - round.result.scoreToPar);
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
    holes,
  };
}

export function scoreGolferForContest(
  row: SportEventParticipantView,
  context: UnplayedRoundContext,
): GolfContestScore {
  // A round with no known par is left out: it cannot be scored against its par yet.
  const scoreUnplayed = (roundNumbers: readonly number[]) => {
    const unplayed = roundNumbers.flatMap((roundNumber) => {
      const par = context.parByRound.get(roundNumber);
      return par === undefined ? [] : [{ roundNumber, par }];
    });
    return {
      unplayedRoundNumbers: unplayed.map(({ roundNumber }) => roundNumber),
      penalty: unplayed.reduce((sum, { par }) => sum + UNPLAYED_ROUND_STROKES - par, 0),
    };
  };

  const rounds = scoredRoundsOf(row);
  const finished = new Map(rounds.filter((round) => isRoundFinished(round, context.holes)).map((round) => [round.roundNumber, round]));
  const missesScheduledRound = context.scheduledRoundNumbers.some((roundNumber) => !finished.has(roundNumber));

  // Out of the event, or the event is over and they did not finish every round: the rounds
  // they finished, then 80 for every other scheduled round. A round they withdrew partway
  // through is dropped for its 80.
  if (isOutOfEvent(row) || (context.eventComplete && missesScheduledRound)) {
    const { unplayedRoundNumbers, penalty } = scoreUnplayed(
      context.scheduledRoundNumbers.filter((roundNumber) => !finished.has(roundNumber)),
    );
    const played = context.scheduledRoundNumbers
      .reduce((sum, roundNumber) => sum + (finished.get(roundNumber)?.result.scoreToPar ?? 0), 0);
    const hasScore = unplayedRoundNumbers.length > 0
      || context.scheduledRoundNumbers.some((roundNumber) => finished.has(roundNumber));
    return { score: hasScore ? played + penalty : null, unplayedRoundNumbers };
  }

  // Still in it with a score (or done with every round): their live event to-par, untouched.
  const live = row.standing?.scoreToPar ?? null;
  if (live !== null || rounds.length > 0) {
    return { score: live, unplayedRoundNumbers: [] };
  }

  // Mid-event, still in it with no score at all: 80 for each round the field has moved past.
  const { unplayedRoundNumbers, penalty } = scoreUnplayed(
    context.scheduledRoundNumbers.filter((roundNumber) => roundNumber < context.highestStartedRound),
  );
  return { score: unplayedRoundNumbers.length > 0 ? penalty : null, unplayedRoundNumbers };
}

/**
 * A lineup that played no round (#714): each of its `pickCount` counting picks scores 80 strokes
 * for every scheduled round, against that round's par, as a golfer who never teed off does once
 * the event is complete. Null while the event has no scheduled rounds or a round's par is unknown,
 * so a missed major is never scored lighter than it will be.
 */
export function scoreUnplayedLineup(context: UnplayedRoundContext, pickCount: number): number | null {
  const pars = context.scheduledRoundNumbers.map((roundNumber) => context.parByRound.get(roundNumber));
  if (pars.length === 0 || !pars.every((par): par is number => par !== undefined)) {
    return null;
  }
  const perGolfer = pars.reduce((sum, par) => sum + UNPLAYED_ROUND_STROKES - par, 0);
  return perGolfer * pickCount;
}
