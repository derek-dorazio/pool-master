/**
 * Whether Create contest would take a contest of a given setup on an event right now (#1007), for
 * the public event pages' offers. The same checks as creating one (`ContestManagementService`'s
 * `assertSportEventContestEligible` and a bracket's starting round), asked as a question instead
 * of refused with an error: past the cutoff is CLOSED, not released or not ready is NOT_YET.
 * It also says when the cutoff falls, so an event page is never kept past it (#1181).
 */
import { SelectionType } from '@poolmaster/shared/domain';
import { ContestCutoffKind, type ContestCutoff } from '../contests/entry-window';
import { evaluateEventOperationalState, hasSportEventStarted } from '../events/operational-timing';
import type { ContestCreateSportEventReader, ContestCreateSportEventState } from './service';

export const ContestOpening = {
  /** A contest of the setup can be created on the event now. */
  OPEN: 'OPEN',
  /** Not yet: the event is unreleased, its field not loaded, or a later-round bracket's teams not set. */
  NOT_YET: 'NOT_YET',
  /** Too late: the contest's cutoff on the event has passed. */
  CLOSED: 'CLOSED',
} as const;
export type ContestOpening = (typeof ContestOpening)[keyof typeof ContestOpening];

/** The setup asked about: how its entries pick, and for a bracket the round it starts at. */
export interface ContestOpeningSetup {
  selectionType: SelectionType;
  /** A bracket's starting round; 1 or null for the whole knockout. Read only for a bracket. */
  startsAtRound: number | null;
}

export interface ContestOpeningReader extends Pick<ContestCreateSportEventReader, 'findById' | 'findCutoffTiming' | 'findBracketProblem'> {
  /**
   * The soonest kickoff of the event's games that could still take a squares contest (not
   * cancelled, in a round of single games, not kicked off), or null when none is left.
   */
  nextSquaresKickoff(sportEvent: ContestCreateSportEventState, now: Date): Promise<Date | null>;
}

/** Whether the setup opens on the event now, and when the cutoff that would close it falls. */
export interface ContestOpeningWindow {
  opening: ContestOpening;
  /**
   * The setup's cutoff on the event, ahead of now: the event's start, its starting round's, or
   * for squares the next game's kickoff (after which another game may still take one). Null when
   * CLOSED.
   */
  closesAt: Date | null;
}

const CLOSED: ContestOpeningWindow = { opening: ContestOpening.CLOSED, closesAt: null };

export async function contestOpening(
  reader: ContestOpeningReader,
  sportEventId: string,
  setup: ContestOpeningSetup,
  now: Date,
): Promise<ContestOpeningWindow> {
  const sportEvent = await reader.findById(sportEventId);
  if (sportEvent === null) {
    return CLOSED;
  }
  const startsAtRound = setup.selectionType === SelectionType.BRACKET ? setup.startsAtRound ?? 1 : 1;
  let closesAt: Date;
  if (setup.selectionType === SelectionType.SQUARES) {
    // A squares contest's cutoff is its own game's kickoff, which the commissioner picks later.
    const kickoff = await reader.nextSquaresKickoff(sportEvent, now);
    if (kickoff === null) {
      return CLOSED;
    }
    closesAt = kickoff;
  } else {
    const cutoff: ContestCutoff = startsAtRound > 1
      ? { kind: ContestCutoffKind.ROUND_START, roundNumber: startsAtRound }
      : { kind: ContestCutoffKind.EVENT_START };
    const timing = await reader.findCutoffTiming(sportEvent, cutoff);
    if (hasSportEventStarted(timing, now)) {
      return CLOSED;
    }
    closesAt = timing.startDate;
  }
  const { readinessReasons } = evaluateEventOperationalState({
    status: sportEvent.status,
    startDate: sportEvent.startDate,
    participantCount: sportEvent.loadedParticipantCount,
    now,
  });
  if (readinessReasons.includes('EVENT_NOT_RELEASED') || readinessReasons.includes('FIELD_NOT_LOADED')) {
    return { opening: ContestOpening.NOT_YET, closesAt };
  }
  if (setup.selectionType === SelectionType.BRACKET && await reader.findBracketProblem(sportEvent.id, startsAtRound) !== null) {
    return { opening: ContestOpening.NOT_YET, closesAt };
  }
  return { opening: ContestOpening.OPEN, closesAt };
}
