/**
 * When a contest's entries and picks can change, and when its picks are revealed: the rules
 * behind entering, renaming, leaving, picking and submitting (ContestService and SelectionService
 * both ask them).
 *
 * A contest covers one or more events (#713), and each event is its own small workflow: its picks
 * open while the contest takes them and close at the first Game of the slots the contest covers on
 * that event (#2013), which is the event's start unless the contest covers a later slot. A slot
 * moves on when one of its Matches starts, but that update can be late, and a lineup must not
 * change after tee-off while it is, so the first game's scheduled start closes it too.
 *
 * Joining, leaving and renaming are the contest's: only while it is OPEN (#117) and before its
 * first event starts, so nobody joins a contest already being played (design Q5.6).
 *
 * A squares contest (#711) closes later than its event's start: at its one game's kickoff. `ContestCutoff` says which, and `cutoffTiming` gives every check below the timing
 * it runs on, so the checks themselves stay the same for every contest.
 *
 * A random draw closes entries early (#601): once it has dealt, nobody may enter, leave or
 * change an entry, or the deal would no longer be the one every entry was given.
 */
import type { Contest, ContestCoveredSlot, ContestRules, ContestSelectionConfig, ContestSquaresGame, SportEventRoundMatch, SportEventRoundMatchGame } from '@poolmaster/shared/domain';
import { ContestStatus, isMatchUnplayed, SeasonSlotStatus, SelectionType, SportEventStatus, hasSportEventStarted, isSportEventStatusFinished, hasPeriodScores } from '@poolmaster/shared/domain';

export type EventTiming = { status: SportEventStatus; startDate: Date };
/** A game's timing: its status, its kickoff, and any period scores, which only a game under way has (#772). */
type MatchTiming = Pick<SportEventRoundMatch, 'status' | 'scheduledDate' | 'games'>;
type RoundMatchTiming = MatchTiming & { id: string; roundNumber: number };
/** One Game's timing (#2050): its status, its kickoff and its period scores. */
type GameTiming = Pick<SportEventRoundMatchGame, 'id' | 'status' | 'scheduledDate' | 'sideResults'>;

/**
 * Where a contest's window on an event closes (#721): at the first Game of the slots it covers on
 * that event (#2013), as for every contest, or at one Game's kickoff, for a squares contest on that
 * Game (#711). Entries, picks and the tiebreaker close, picks are revealed and the contest goes live
 * at this point.
 */
export const ContestCutoffKind = {
  FIRST_COVERED_GAME: 'FIRST_COVERED_GAME',
  GAME_START: 'GAME_START',
} as const;
export type ContestCutoffKind = (typeof ContestCutoffKind)[keyof typeof ContestCutoffKind];

/** A Season slot a contest covers, as its window reads it: its event, its status, and its first game's start. */
export type CoveredSlotTiming = Pick<ContestCoveredSlot, 'sportEventId' | 'status' | 'startsAt'>;

export type ContestCutoff =
  | { kind: typeof ContestCutoffKind.FIRST_COVERED_GAME; coveredSlots: readonly CoveredSlotTiming[] }
  | { kind: typeof ContestCutoffKind.GAME_START; sportEventRoundMatchGameId: string };

/** Whether a game has moved on from being still to play (scheduled, or postponed before it began), by its status or by a period score entered for it. */
export function hasGameMovedOn(game: MatchTiming): boolean {
  return !isMatchUnplayed(game.status) || hasPeriodScores(game);
}

/**
 * A contest's cutoff, from its rules, its covered slots and, for squares, its Game: a squares
 * contest closes at its Game's kickoff, every other contest at the first Game of the slots it
 * covers. A contest not made yet covers no slot so far, so its window is its events' own.
 */
export function contestCutoff(
  rules: ContestRules | ContestSelectionConfig | undefined,
  contest: { squaresGame?: Pick<ContestSquaresGame, 'sportEventRoundMatchGameId'>; coveredSlots?: readonly CoveredSlotTiming[] } = {},
): ContestCutoff {
  if (rules?.selectionType === SelectionType.SQUARES && contest.squaresGame !== undefined) {
    return { kind: ContestCutoffKind.GAME_START, sportEventRoundMatchGameId: contest.squaresGame.sportEventRoundMatchGameId };
  }
  return { kind: ContestCutoffKind.FIRST_COVERED_GAME, coveredSlots: contest.coveredSlots ?? [] };
}

/**
 * The timing a contest's window runs on for one event, in the shape every check below reads.
 * - At its first covered Game: the earliest start of the slots it covers on the event (a slot's
 *   start is its first game's), and started once any of them has (a slot is in progress once any of
 *   its Matches has started). A later slot of an event under way is still to start, so a contest on
 *   it still takes entries and picks. With no covered slot on the event, the event's own timing.
 * - At a Game's kickoff: that Game's time and whether it has moved on (a cancelled Game has, so its
 *   contest closes, and so has a Game with a period score). The Game is looked up among the event's
 *   matches' Games.
 * A finished event is finished for every cutoff.
 */
export function cutoffTiming(
  cutoff: ContestCutoff,
  sportEvent: EventTiming & { id: string },
  matches: readonly { games: readonly GameTiming[] }[],
): EventTiming {
  if (isSportEventStatusFinished(sportEvent.status)) {
    return sportEvent;
  }
  switch (cutoff.kind) {
    case ContestCutoffKind.FIRST_COVERED_GAME: {
      const covered = cutoff.coveredSlots.filter((slot) => slot.sportEventId === sportEvent.id);
      if (covered.length === 0) {
        return sportEvent;
      }
      const starts = covered.flatMap((slot) => (slot.startsAt === null ? [] : [slot.startsAt.getTime()]));
      const started = covered.some((slot) => slot.status !== SeasonSlotStatus.SCHEDULED);
      return {
        status: started ? SportEventStatus.IN_PROGRESS : stillToStart(sportEvent.status),
        startDate: starts.length === 0 ? sportEvent.startDate : new Date(Math.min(...starts)),
      };
    }
    case ContestCutoffKind.GAME_START: {
      const game = matches.flatMap((match) => match.games).find((candidate) => candidate.id === cutoff.sportEventRoundMatchGameId);
      if (!game) {
        return sportEvent;
      }
      const status = !isMatchUnplayed(game.status) || hasPeriodScores({ games: [game] }) ? SportEventStatus.IN_PROGRESS : stillToStart(sportEvent.status);
      return { status, startDate: game.scheduledDate ?? sportEvent.startDate };
    }
  }
}

/** The status of a window still to start on an event: scheduled while the event is under way with its other games, else the event's own (postponed, say). */
function stillToStart(status: SportEventStatus): SportEventStatus {
  return status === SportEventStatus.IN_PROGRESS ? SportEventStatus.SCHEDULED : status;
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
 * Whether a game has kicked off: its scheduled time (else its event's start) has passed, or it
 * has moved on from SCHEDULED (a period score counts). As with an event, the status update can be late.
 */
export function hasMatchStarted(match: MatchTiming, sportEvent: EventTiming, now: Date): boolean {
  return hasGameMovedOn(match) || (match.scheduledDate ?? sportEvent.startDate) <= now;
}

/**
 * Whether a game picked game by game has kicked off. As `hasMatchStarted`, except that an untimed
 * game of a round after the event's opening round has no kickoff yet (#785): its time comes once
 * the round before is played, so until it is set, or the game moves on, the game has not started.
 */
export function hasRoundMatchStarted(match: RoundMatchTiming, sportEvent: EventTiming, openingRoundNumber: number, now: Date): boolean {
  if (match.scheduledDate === null && match.roundNumber > openingRoundNumber) {
    return hasGameMovedOn(match);
  }
  return hasMatchStarted(match, sportEvent, now);
}

/** The event's opening round: the lowest round any of its games is played in, 1 for an event with none. */
export function openingRoundNumber(games: readonly Pick<RoundMatchTiming, 'roundNumber'>[]): number {
  return games.length > 0 ? Math.min(...games.map((game) => game.roundNumber)) : 1;
}

/**
 * Whether a pick on one game can change (#716), under the engine's pick window: until the event
 * starts, or until that game kicks off while the contest takes picks and the event is not over
 * (`hasRoundMatchStarted`: a later round's game waits on its time).
 */
export function areMatchPicksOpen(
  pickWindow: PickWindow,
  contest: Pick<Contest, 'status' | 'drawnAt'>,
  sportEvent: EventTiming,
  match: RoundMatchTiming,
  openingRound: number,
  now: Date,
): boolean {
  switch (pickWindow) {
    case PickWindow.UNTIL_EVENT_START:
      return areEventPicksOpen(contest, sportEvent, now);
    case PickWindow.UNTIL_MATCH_START:
      if (!PICKING_STATUSES.includes(contest.status) || contest.drawnAt !== undefined) {
        return false;
      }
      return !isSportEventStatusFinished(sportEvent.status) && !hasRoundMatchStarted(match, sportEvent, openingRound, now);
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
  match: RoundMatchTiming,
  openingRound: number,
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
        || isSportEventStatusFinished(sportEvent.status)
        || hasRoundMatchStarted(match, sportEvent, openingRound, now);
  }
}
