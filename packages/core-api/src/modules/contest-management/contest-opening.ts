/**
 * Whether Create contest would take a contest of a given setup on an event right now (#1007), for
 * the public event pages' offers. The same checks as creating one (`ContestManagementService`'s
 * `assertSportEventContestEligible` and a bracket's teams), asked as a question instead
 * of refused with an error: past the cutoff is CLOSED, not released or not ready is NOT_YET.
 * It also says when the cutoff falls, so an event page is never kept past it (#1181).
 */
import {
  ContestOpening,
  eventPlaysMatches,
  eventSportDefinition,
  hasSportEventStarted,
  SelectionType,
  SportEventStatus,
  type SportLeagueEvent,
  type SportEvent,
} from '@poolmaster/shared/domain';
import { contestCutoff, type ContestCutoff } from '../contests/entry-window';
import { evaluateEventOperationalState } from '../events/operational-timing';
import type { ContestCreateSportEventReader, ContestCreateSportEventState } from './service';

/** The setup asked about: how its entries pick. */
export interface ContestOpeningSetup {
  selectionType: SelectionType;
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
   * The setup's cutoff on the event, ahead of now: the event's start, or for squares the next game's kickoff (after which another game may still take one). Null when
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
  let closesAt: Date;
  if (setup.selectionType === SelectionType.SQUARES) {
    // A squares contest's cutoff is its own game's kickoff, which the commissioner picks later.
    const kickoff = await reader.nextSquaresKickoff(sportEvent, now);
    if (kickoff === null) {
      return CLOSED;
    }
    closesAt = kickoff;
  } else {
    // A contest not made yet covers no slot so far: its window is the event's own.
    const cutoff: ContestCutoff = contestCutoff(undefined);
    const timing = await reader.findCutoffTiming(sportEvent, cutoff);
    if (hasSportEventStarted(timing, now)) {
      return CLOSED;
    }
    closesAt = timing.startDate;
  }
  const { readinessReasons } = evaluateEventOperationalState({
    status: sportEvent.status,
    startDate: sportEvent.startDate,
    participantCount: sportEvent.participantCount,
    now,
  });
  if (readinessReasons.includes('EVENT_NOT_RELEASED') || readinessReasons.includes('FIELD_NOT_LOADED')) {
    return { opening: ContestOpening.NOT_YET, closesAt };
  }
  if (setup.selectionType === SelectionType.BRACKET && await reader.findBracketProblem(sportEvent.id) !== null) {
    return { opening: ContestOpening.NOT_YET, closesAt };
  }
  return { opening: ContestOpening.OPEN, closesAt };
}

/** What an event's openings are read from: the event row as the event list has it, no other read. */
export interface EventOpeningFacts extends SportLeagueEvent, Pick<SportEvent, 'slotDefinitions'> {
  status: SportEventStatus;
  startDate: Date;
  participantCount: number;
}

/** Whether a contest of one selection type can be created on an event. */
export interface EventContestOpening {
  selectionType: SelectionType;
  opening: ContestOpening;
}

/**
 * Whether each selection type the event's definition offers can start a contest on it now (#1929),
 * from the event row alone, so the event list answers it for every event with no further read.
 * A contest-ready event opens to every one. A knockout under way (released, field loaded, played as
 * matches, in progress) still opens to squares, which closes at its own game's kickoff (#711).
 * Create contest checks the chosen game's own cutoff when it takes the contest.
 */
export function eventContestOpenings(event: EventOpeningFacts, now: Date): EventContestOpening[] {
  const definition = eventSportDefinition(event);
  const { readinessReasons, contestEligible } = evaluateEventOperationalState({
    status: event.status,
    startDate: event.startDate,
    participantCount: event.participantCount,
    now,
  });
  const hasStarted = readinessReasons.includes('EVENT_STARTED');
  const knockoutUnderWay = eventPlaysMatches(event)
    && event.status === SportEventStatus.IN_PROGRESS
    && readinessReasons.every((reason) => reason === 'EVENT_STARTED');
  return definition.selectionTypes.map((selectionType): EventContestOpening => {
    const opensUnderWay = knockoutUnderWay && selectionType === SelectionType.SQUARES;
    let opening: ContestOpening;
    if (contestEligible || opensUnderWay) {
      opening = ContestOpening.OPEN;
    } else if (hasStarted) {
      opening = ContestOpening.CLOSED;
    } else {
      opening = ContestOpening.NOT_YET;
    }
    return { selectionType, opening };
  });
}
