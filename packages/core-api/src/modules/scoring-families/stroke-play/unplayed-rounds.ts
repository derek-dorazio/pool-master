/**
 * #478 — every round a golfer does not play adds the contest's `unplayedRoundToPar` to their
 * contest to-par (+8, the usual rule, is an 80 on a par 72). It is a fixed number against par,
 * never read off a course's par (#2008). This is contest scoring only; the event's own standing
 * keeps the golfer's real to-par.
 *
 * Which rounds are unplayed:
 * - a golfer out of the event (cut, withdrawn or disqualified, or removed from the field):
 *   every scheduled round they did not finish, including the one they withdrew during;
 * - once the event is complete, every golfer the same way: there is nothing left to wait for;
 * - mid-event, a golfer still in it with no score at all: every round the field has moved past
 *   (a later round has started). A golfer still in it with a score keeps their live to-par
 *   untouched until the event completes, so a round suspended overnight is never penalised.
 *
 * Only the event's rounds (its Round rows, #2008) are scored (#375).
 */
import {
  type ContestScoringSettings,
  GameSideStatus,
  ParticipantStandingStatus,
  SportEventStatus,
  type SportEvent,
  SportEventParticipantStatus,
} from '@poolmaster/shared/domain';
import type { SportEventParticipantView } from '../../events/sport-event-participant-service';
import { scoredRoundsOf, type ScoredRound } from './scored-rounds';

/**
 * What an unplayed round adds to par under a contest's scoring, or null for a contest ranked by
 * another family's definition: contest management refuses one, and if one were read it is left
 * unscored rather than scored under rules it lacks.
 */
export function unplayedRoundToParOf(scoring: ContestScoringSettings): number | null {
  return scoring.participantScoringDefinitionId === 'GOLF_RELATIVE_TO_PAR_TOTAL'
    ? scoring.config.unplayedRoundToPar
    : null;
}

/** What unplayed-round scoring reads off the event. */
export type UnplayedRoundScoringEvent = Pick<SportEvent, 'roundCount' | 'status' | 'slotDefinitions'>;

/**
 * How many holes each of a stroke-play event's rounds has (#2047): the period count of the slot
 * its rounds are played in, which every round of a tournament shares. Null when the event covers
 * no slot with one, or slots that disagree.
 */
export function holesPerRound(event: Pick<SportEvent, 'slotDefinitions'>): number | null {
  const counts = [...new Set(event.slotDefinitions.map((definition) => definition.periods?.count ?? null))];
  return counts.length === 1 ? counts[0] : null;
}

/** A golfer's contest score and the rounds in it that were scored as unplayed. */
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
  /** The highest round any golfer has a score for; rounds below it the field has moved past. */
  highestStartedRound: number;
  eventComplete: boolean;
  /** `holesPerRound` of the event. */
  holes: number | null;
  /** What each unplayed round adds to par: the contest's setting. */
  unplayedRoundToPar: number;
}

export function buildUnplayedRoundContext(
  field: readonly SportEventParticipantView[],
  event: UnplayedRoundScoringEvent,
  unplayedRoundToPar: number,
): UnplayedRoundContext {
  let highestStartedRound = 0;
  for (const row of field) {
    for (const round of scoredRoundsOf(row)) {
      highestStartedRound = Math.max(highestStartedRound, round.roundNumber);
    }
  }
  // An event with no rounds yet scores only the rounds the field has played.
  const scheduledRounds = event.roundCount > 0 ? event.roundCount : highestStartedRound;
  return {
    scheduledRoundNumbers: Array.from({ length: scheduledRounds }, (_, index) => index + 1),
    highestStartedRound,
    eventComplete: event.status === SportEventStatus.COMPLETED,
    holes: holesPerRound(event),
    unplayedRoundToPar,
  };
}

export function scoreGolferForContest(
  row: SportEventParticipantView,
  context: UnplayedRoundContext,
): GolfContestScore {
  const scoreUnplayed = (roundNumbers: readonly number[]) => ({
    unplayedRoundNumbers: [...roundNumbers],
    penalty: roundNumbers.length * context.unplayedRoundToPar,
  });

  const rounds = scoredRoundsOf(row);
  const finished = new Map(rounds.filter((round) => isRoundFinished(round, context.holes)).map((round) => [round.roundNumber, round]));
  const missesScheduledRound = context.scheduledRoundNumbers.some((roundNumber) => !finished.has(roundNumber));

  // Out of the event, or the event is over and they did not finish every round: the rounds
  // they finished, then the unplayed score for every other scheduled round. A round they
  // withdrew partway through is dropped for it.
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

  // Mid-event, still in it with no score at all: the unplayed score for each round the field has
  // moved past.
  const { unplayedRoundNumbers, penalty } = scoreUnplayed(
    context.scheduledRoundNumbers.filter((roundNumber) => roundNumber < context.highestStartedRound),
  );
  return { score: unplayedRoundNumbers.length > 0 ? penalty : null, unplayedRoundNumbers };
}

/**
 * A lineup that played no round (#714): each of its `pickCount` counting picks scores the
 * unplayed score for every scheduled round, as a golfer who never teed off does once the event is
 * complete. Null while the event has no scheduled rounds.
 */
export function scoreUnplayedLineup(context: UnplayedRoundContext, pickCount: number): number | null {
  if (context.scheduledRoundNumbers.length === 0) {
    return null;
  }
  return context.scheduledRoundNumbers.length * context.unplayedRoundToPar * pickCount;
}
