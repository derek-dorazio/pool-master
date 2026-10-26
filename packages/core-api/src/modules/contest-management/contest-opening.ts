/**
 * Whether Create contest would take a contest of a given setup on an event right now (#1007), for
 * the public event pages' offers. The same checks as creating one (`ContestManagementService`'s
 * `assertSportEventContestEligible` and a bracket's starting round), asked as a question instead
 * of refused with an error: past the cutoff is CLOSED, not released or not ready is NOT_YET.
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
   * Whether any of the event's games could still take a squares contest: not cancelled, in a
   * round of single games, and not kicked off.
   */
  hasSquaresGameAhead(sportEvent: ContestCreateSportEventState, now: Date): Promise<boolean>;
}

export async function contestOpening(
  reader: ContestOpeningReader,
  sportEventId: string,
  setup: ContestOpeningSetup,
  now: Date,
): Promise<ContestOpening> {
  const sportEvent = await reader.findById(sportEventId);
  if (sportEvent === null) {
    return ContestOpening.CLOSED;
  }
  const startsAtRound = setup.selectionType === SelectionType.BRACKET ? setup.startsAtRound ?? 1 : 1;
  if (setup.selectionType === SelectionType.SQUARES) {
    // A squares contest's cutoff is its own game's kickoff, which the commissioner picks later.
    if (!await reader.hasSquaresGameAhead(sportEvent, now)) {
      return ContestOpening.CLOSED;
    }
  } else {
    const cutoff: ContestCutoff = startsAtRound > 1
      ? { kind: ContestCutoffKind.ROUND_START, roundNumber: startsAtRound }
      : { kind: ContestCutoffKind.EVENT_START };
    if (hasSportEventStarted(await reader.findCutoffTiming(sportEvent, cutoff), now)) {
      return ContestOpening.CLOSED;
    }
  }
  const { readinessReasons } = evaluateEventOperationalState({
    status: sportEvent.status,
    startDate: sportEvent.startDate,
    participantCount: sportEvent.loadedParticipantCount,
    now,
  });
  if (readinessReasons.includes('EVENT_NOT_RELEASED') || readinessReasons.includes('FIELD_NOT_LOADED')) {
    return ContestOpening.NOT_YET;
  }
  if (setup.selectionType === SelectionType.BRACKET && await reader.findBracketProblem(sportEvent.id, startsAtRound) !== null) {
    return ContestOpening.NOT_YET;
  }
  return ContestOpening.OPEN;
}
