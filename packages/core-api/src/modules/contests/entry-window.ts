/**
 * When a contest's entries and picks can change, and when its picks are revealed: the rules
 * behind entering, renaming, leaving, picking and submitting (ContestService and SelectionService
 * both ask them).
 *
 * A contest covers one or more events (#713), and each event is its own small workflow: its picks
 * open while the contest takes them and close at that event's scheduled start. The event moves on
 * when it is marked In Progress, but that update can be late, and a lineup must not change after
 * tee-off while it is.
 *
 * Joining, leaving and renaming are the contest's: only while it is OPEN (#117) and before its
 * first event starts, so nobody joins a contest already being played (design Q5.6).
 *
 * A second-chance bracket (#721) closes later than its event's start: at its starting round's
 * first game; a squares contest (#711) closes at its one game's kickoff. `ContestCutoff` says which, and `cutoffTiming` gives every check below the timing
 * it runs on, so the checks themselves stay the same for every contest.
 *
 * A random draw closes entries early (#601): once it has dealt, nobody may enter, leave or
 * change an entry, or the deal would no longer be the one every entry was given.
 */
import type { Contest, ContestRules, ContestSelectionConfig } from '@poolmaster/shared/domain';
import { ContestStatus, MatchStatus, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';
import { hasSportEventStarted } from '../events/operational-timing';

export type EventTiming = { status: SportEventStatus; startDate: Date };
/** A game's timing: its status, its kickoff, and any period scores, which only a game under way has (#772). */
type MatchTiming = { status: MatchStatus; scheduledDate: Date | null; periodScores?: readonly { periodNumber: number }[] };
type RoundMatchTiming = MatchTiming & { id: string; roundNumber: number };

/**
 * Where a contest's window on an event closes (#721): at the event's start, as for every contest,
 * at the first game of a later round, for a second-chance bracket that starts there, or at one
 * game's kickoff, for a squares contest on that game (#711). Entries, picks and the tiebreaker
 * close, picks are revealed and the contest goes live at this point.
 */
export const ContestCutoffKind = {
  EVENT_START: 'EVENT_START',
  ROUND_START: 'ROUND_START',
  MATCH_START: 'MATCH_START',
} as const;
export type ContestCutoffKind = (typeof ContestCutoffKind)[keyof typeof ContestCutoffKind];

export type ContestCutoff =
  | { kind: typeof ContestCutoffKind.EVENT_START }
  | { kind: typeof ContestCutoffKind.ROUND_START; roundNumber: number }
  | { kind: typeof ContestCutoffKind.MATCH_START; sportEventMatchId: string };

const AT_EVENT_START: ContestCutoff = { kind: ContestCutoffKind.EVENT_START };

/** Whether a game has moved on from SCHEDULED, by its status or by a period score entered for it. */
function hasGameMovedOn(game: MatchTiming): boolean {
  return game.status !== MatchStatus.SCHEDULED || (game.periodScores?.length ?? 0) > 0;
}

/**
 * A contest's cutoff, from its rules and, for squares, its game: a bracket starting after round 1
 * closes at its starting round, and a squares contest at its game's kickoff.
 */
export function contestCutoff(
  rules: ContestRules | ContestSelectionConfig | undefined,
  squaresGameMatchId?: string,
): ContestCutoff {
  if (rules?.selectionType === SelectionType.BRACKET && rules.startsAtRound > 1) {
    return { kind: ContestCutoffKind.ROUND_START, roundNumber: rules.startsAtRound };
  }
  if (rules?.selectionType === SelectionType.SQUARES && squaresGameMatchId !== undefined) {
    return { kind: ContestCutoffKind.MATCH_START, sportEventMatchId: squaresGameMatchId };
  }
  return AT_EVENT_START;
}

/**
 * The timing a contest's window runs on for one event, in the shape every check below reads: the
 * event's own, or, at a round's start, the round's first game time (a game without a time is
 * timed at the event's start, as a weekly game is) and whether any of its games has moved on from
 * SCHEDULED; at a game's kickoff, that game's time and whether it has moved on (a cancelled game
 * has, so its contest closes, and so has a game with a period score). A finished event is finished for every cutoff.
 */
export function cutoffTiming(cutoff: ContestCutoff, sportEvent: EventTiming, games: readonly RoundMatchTiming[]): EventTiming {
  switch (cutoff.kind) {
    case ContestCutoffKind.EVENT_START:
      return sportEvent;
    case ContestCutoffKind.ROUND_START: {
      if (FINISHED_EVENT_STATUSES.includes(sportEvent.status)) {
        return sportEvent;
      }
      const round = games.filter((game) => game.roundNumber === cutoff.roundNumber && game.status !== MatchStatus.CANCELLED);
      const times = round.map((game) => (game.scheduledDate ?? sportEvent.startDate).getTime());
      const startDate = times.length > 0 ? new Date(Math.min(...times)) : sportEvent.startDate;
      const started = round.some(hasGameMovedOn);
      const status = started
        ? SportEventStatus.IN_PROGRESS
        : sportEvent.status === SportEventStatus.IN_PROGRESS ? SportEventStatus.SCHEDULED : sportEvent.status;
      return { status, startDate };
    }
    case ContestCutoffKind.MATCH_START: {
      if (FINISHED_EVENT_STATUSES.includes(sportEvent.status)) {
        return sportEvent;
      }
      const game = games.find((candidate) => candidate.id === cutoff.sportEventMatchId);
      if (!game) {
        return sportEvent;
      }
      const status = hasGameMovedOn(game)
        ? SportEventStatus.IN_PROGRESS
        : sportEvent.status === SportEventStatus.IN_PROGRESS ? SportEventStatus.SCHEDULED : sportEvent.status;
      return { status, startDate: game.scheduledDate ?? sportEvent.startDate };
    }
  }
}

/**
 * When an engine's picks close, and are revealed (#716): at its event's start (every roster pick,
 * and a bracket filled in before it starts), or at each game's own kickoff (weekly pick'em).
 */
export const PickWindow = {
  UNTIL_EVENT_START: 'UNTIL_EVENT_START',
  UNTIL_MATCH_START: 'UNTIL_MATCH_START',
} as const;
export type PickWindow = (typeof PickWindow)[keyof typeof PickWindow];

/** Event statuses that finish an event: none of its games takes picks, and its contests settle (#743). */
export const FINISHED_EVENT_STATUSES: readonly SportEventStatus[] = [SportEventStatus.COMPLETED, SportEventStatus.CANCELLED];

/** Contest statuses whose events take picks: OPEN, and ACTIVE while a later event is still to start. */
const PICKING_STATUSES: readonly ContestStatus[] = [ContestStatus.OPEN, ContestStatus.ACTIVE];

/** Whether entries can be created, renamed or left: the contest is OPEN, undrawn, and none of its events has started. */
export function areContestEntriesOpen(
  contest: Pick<Contest, 'status' | 'drawnAt'>,
  sportEvents: readonly EventTiming[],
  now: Date,
): boolean {
  if (contest.status !== ContestStatus.OPEN || contest.drawnAt !== undefined) {
    return false;
  }
  return !sportEvents.some((sportEvent) => hasSportEventStarted(sportEvent, now));
}

/** Whether one event's picks can change, and its lineup be submitted: the contest takes picks, is undrawn, and the event has not started. */
export function areEventPicksOpen(
  contest: Pick<Contest, 'status' | 'drawnAt'>,
  sportEvent: EventTiming,
  now: Date,
): boolean {
  if (!PICKING_STATUSES.includes(contest.status) || contest.drawnAt !== undefined) {
    return false;
  }
  return !hasSportEventStarted(sportEvent, now);
}

/**
 * Whether one event's picks are visible to everyone in the league, not only their owners.
 *
 * pool-master-dxd.13: picks are hidden from non-owners while the contest takes entries (DRAFT or
 * OPEN). Once it is live, each event's picks are revealed when that event starts (#713), so week
 * 7's picks stay hidden while week 6 is played. A random draw is public from the moment it is
 * dealt (#601): nobody chose those picks, so there is nothing to hide.
 */
export function areEventPicksRevealed(
  contest: Pick<Contest, 'status' | 'drawnAt'>,
  sportEvent: EventTiming,
  now: Date,
): boolean {
  if (contest.drawnAt !== undefined) {
    return true;
  }
  if (contest.status === ContestStatus.DRAFT || contest.status === ContestStatus.OPEN) {
    return false;
  }
  return contest.status === ContestStatus.COMPLETED || hasSportEventStarted(sportEvent, now);
}

/**
 * The event a contest's pages open on when none is named: its next event that has not started
 * (the one being picked), else its last (the latest played). `sportEvents` is in sequence order.
 */
export function currentContestEvent<Event extends EventTiming>(sportEvents: readonly Event[], now: Date): Event | undefined {
  return sportEvents.find((sportEvent) => !hasSportEventStarted(sportEvent, now)) ?? sportEvents.at(-1);
}

/**
 * Whether a game has kicked off: its scheduled time (else its event's start) has passed, or it
 * has moved on from SCHEDULED (a period score counts). As with an event, the status update can be late.
 */
export function hasMatchStarted(match: MatchTiming, sportEvent: EventTiming, now: Date): boolean {
  return hasGameMovedOn(match) || (match.scheduledDate ?? sportEvent.startDate) <= now;
}

/**
 * Whether a pick on one game can change (#716), under the engine's pick window: until the event
 * starts, or until that game kicks off while the contest takes picks and the event is not over.
 */
export function areMatchPicksOpen(
  pickWindow: PickWindow,
  contest: Pick<Contest, 'status' | 'drawnAt'>,
  sportEvent: EventTiming,
  match: MatchTiming,
  now: Date,
): boolean {
  switch (pickWindow) {
    case PickWindow.UNTIL_EVENT_START:
      return areEventPicksOpen(contest, sportEvent, now);
    case PickWindow.UNTIL_MATCH_START:
      if (!PICKING_STATUSES.includes(contest.status) || contest.drawnAt !== undefined) {
        return false;
      }
      return !FINISHED_EVENT_STATUSES.includes(sportEvent.status) && !hasMatchStarted(match, sportEvent, now);
  }
}

/**
 * Whether a pick on one game is visible to everyone in the league (#716). Under a game-by-game
 * window each pick is revealed at its own game's kickoff, so a Thursday pick shows while the
 * Sunday picks stay hidden; otherwise the event's picks are revealed together.
 */
export function areMatchPicksRevealed(
  pickWindow: PickWindow,
  contest: Pick<Contest, 'status' | 'drawnAt'>,
  sportEvent: EventTiming,
  match: MatchTiming,
  now: Date,
): boolean {
  switch (pickWindow) {
    case PickWindow.UNTIL_EVENT_START:
      return areEventPicksRevealed(contest, sportEvent, now);
    case PickWindow.UNTIL_MATCH_START:
      if (contest.status === ContestStatus.DRAFT || contest.status === ContestStatus.OPEN) {
        return false;
      }
      return contest.status === ContestStatus.COMPLETED
        || FINISHED_EVENT_STATUSES.includes(sportEvent.status)
        || hasMatchStarted(match, sportEvent, now);
  }
}
