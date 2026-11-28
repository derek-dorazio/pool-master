/**
 * Whether Create contest would take a contest of a given setup on an event right now (#1007), for
 * the public event pages' offers. The same checks as creating one (`ContestManagementService`'s
 * `assertSportEventContestEligible` and a bracket's teams), asked as a question instead
 * of refused with an error: past the cutoff is CLOSED, not released or not ready is NOT_YET.
 * It also says when the cutoff falls, so an event page is never kept past it (#1181).
 */
import {
  ContestOpening,
  ContestOpeningReason,
  eventPlaysMatches,
  eventSportDefinition,
  SelectionType,
  SportEventStatus,
  type SportLeagueEvent,
  type SportEvent,
} from '@poolmaster/shared/domain';
import { evaluateEventOperationalState } from '../events/operational-timing';
import type { ContestCreateSportEventReader, ContestCreateSportEventState } from './service';

/** The setup asked about: how its entries pick. */
export interface ContestOpeningSetup {
  selectionType: SelectionType;
}

export interface ContestOpeningReader extends Pick<ContestCreateSportEventReader, 'findById' | 'findBracketProblem'> {
  /**
   * The soonest kickoff of the event's games that could still take a squares contest (not
   * cancelled, in a round of single games, not kicked off), or null when none is left.
   */
  nextSquaresKickoff(sportEvent: ContestCreateSportEventState, now: Date): Promise<Date | null>;
}

/** Whether the setup opens on the event now, why not, and when the cutoff that would close it falls. */
export interface ContestOpeningWindow {
  opening: ContestOpening;
  /** Why it is NOT_YET or CLOSED; null when OPEN, or CLOSED because the event no longer exists. */
  reason: ContestOpeningReason | null;
  /**
   * The setup's cutoff on the event, ahead of now: the event's start, or for squares the next
   * game's kickoff (after which another game may still take one). Null when CLOSED.
   */
  closesAt: Date | null;
}

/** What the event-level rule reads of an event: its row as the event list has it, no other read. */
export interface EventOpeningState {
  status: SportEventStatus;
  startDate: Date;
  participantCount: number;
  /** Whether it plays matches (`eventPlaysMatches`): only a knockout under way still opens to squares. */
  playsMatches: boolean;
}

/** The reasons the event-level rule gives, from the event row alone. */
export type EventOpeningReason = typeof ContestOpeningReason.EVENT_NOT_RELEASED | typeof ContestOpeningReason.FIELD_NOT_LOADED | typeof ContestOpeningReason.EVENT_STARTED;

/** Whether a contest of one selection type can be created on an event, and why not. */
export interface EventContestOpening {
  selectionType: SelectionType;
  opening: ContestOpening;
  /** Why it is NOT_YET or CLOSED; null when OPEN. */
  reason: EventOpeningReason | null;
}

/**
 * The one event-level rule (#1929, #1932): whether a selection type can start a contest on the
 * event now, from the event row alone. A contest-ready event opens to every one. A knockout under
 * way (released, field loaded, played as matches, in progress) still opens to squares, which closes
 * at its own game's kickoff (#711). Otherwise a started event is closed, and an event not started
 * waits to be released, then for its field.
 */
export function eventOpening(event: EventOpeningState, selectionType: SelectionType, now: Date): EventContestOpening {
  const { readinessReasons, contestEligible } = evaluateEventOperationalState({
    status: event.status,
    startDate: event.startDate,
    participantCount: event.participantCount,
    now,
  });
  const knockoutUnderWay = event.playsMatches
    && event.status === SportEventStatus.IN_PROGRESS
    && readinessReasons.every((reason) => reason === 'EVENT_STARTED');
  if (contestEligible || (knockoutUnderWay && selectionType === SelectionType.SQUARES)) {
    return { selectionType, opening: ContestOpening.OPEN, reason: null };
  }
  if (readinessReasons.includes('EVENT_STARTED')) {
    return { selectionType, opening: ContestOpening.CLOSED, reason: ContestOpeningReason.EVENT_STARTED };
  }
  const reason = readinessReasons.includes('EVENT_NOT_RELEASED') ? ContestOpeningReason.EVENT_NOT_RELEASED : ContestOpeningReason.FIELD_NOT_LOADED;
  return { selectionType, opening: ContestOpening.NOT_YET, reason };
}

/** An event that no longer exists: nothing opens on it, and it has no wait or start to name. */
const CLOSED_UNKNOWN: ContestOpeningWindow = { opening: ContestOpening.CLOSED, reason: null, closesAt: null };

/**
 * Whether Create contest would take a setup on the event now. It starts from the event-level rule
 * (`eventOpening`) and only narrows it: a setup's own cutoff (the event's start, or for squares the
 * next game's kickoff) and a bracket's teams. A CLOSED or NOT_YET event row stays so.
 */
export async function contestOpening(
  reader: ContestOpeningReader,
  sportEventId: string,
  setup: ContestOpeningSetup,
  now: Date,
): Promise<ContestOpeningWindow> {
  const sportEvent = await reader.findById(sportEventId);
  if (sportEvent === null) {
    return CLOSED_UNKNOWN;
  }
  const eventRow = eventOpening(sportEvent, setup.selectionType, now);
  if (eventRow.opening === ContestOpening.CLOSED) {
    return { opening: ContestOpening.CLOSED, reason: eventRow.reason, closesAt: null };
  }
  let closesAt: Date;
  if (setup.selectionType === SelectionType.SQUARES) {
    // A squares contest's cutoff is its own game's kickoff, which the commissioner picks later.
    const kickoff = await reader.nextSquaresKickoff(sportEvent, now);
    if (kickoff === null) {
      return { opening: ContestOpening.CLOSED, reason: ContestOpeningReason.NO_GAME_LEFT, closesAt: null };
    }
    closesAt = kickoff;
  } else {
    // A contest not made yet covers no slot so far: its window is the event's own, which the
    // event row has already found still ahead.
    closesAt = sportEvent.startDate;
  }
  if (eventRow.opening === ContestOpening.NOT_YET) {
    return { opening: ContestOpening.NOT_YET, reason: eventRow.reason, closesAt };
  }
  if (setup.selectionType === SelectionType.BRACKET && await reader.findBracketProblem(sportEvent.id) !== null) {
    return { opening: ContestOpening.NOT_YET, reason: ContestOpeningReason.BRACKET_NOT_SET, closesAt };
  }
  return { opening: ContestOpening.OPEN, reason: null, closesAt };
}

/** What an event's openings are read from: the event row as the event list has it, no other read. */
export interface EventOpeningFacts extends SportLeagueEvent, Pick<SportEvent, 'slotDefinitions'> {
  status: SportEventStatus;
  startDate: Date;
  participantCount: number;
}

/**
 * Whether each selection type the event's definition offers can start a contest on it now (#1929),
 * by the event-level rule, so the event list answers it for every event with no further read.
 * Create contest checks the chosen game's own cutoff when it takes the contest.
 */
export function eventContestOpenings(event: EventOpeningFacts, now: Date): EventContestOpening[] {
  const state: EventOpeningState = { ...event, playsMatches: eventPlaysMatches(event) };
  return eventSportDefinition(event).selectionTypes.map((selectionType) => eventOpening(state, selectionType, now));
}
