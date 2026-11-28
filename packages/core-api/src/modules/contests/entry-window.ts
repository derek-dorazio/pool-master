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
import type { Contest, ContestCoveredSlot, ContestRules, ContestSquaresGame, SportEventRoundMatch, SportEventRoundMatchGame } from '@poolmaster/shared/domain';
import { ContestStatus, isMatchUnplayed, MatchStatus, SeasonSlotStatus, SelectionType, SportEventStatus, hasSportEventStarted, isSportEventStatusFinished, hasPeriodScores } from '@poolmaster/shared/domain';

/**
 * The timing a check runs on: an event's, or a contest's window on it. A window has no start yet
 * (null) on a later slot the sync has not scheduled, such as a playoff round waiting on the one
 * before it (#2013): it is still to start until its status moves.
 */
export type EventTiming = { status: SportEventStatus; startDate: Date | null };
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
export type CoveredSlotTiming = Pick<ContestCoveredSlot, 'sportEventId' | 'status' | 'startsAt' | 'isTestData'>;

/** The covered slot statuses that start a contest's window: in progress or complete, never cancelled. */
const STARTED_SLOT_STATUSES: readonly SeasonSlotStatus[] = [SeasonSlotStatus.IN_PROGRESS, SeasonSlotStatus.COMPLETED];

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
  rules: ContestRules | undefined,
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
 *   start is its first game's), and started once any of them is in progress or complete (a slot is
 *   in progress once any of its Matches has started). A later slot of an event under way is still
 *   to start, so a contest on it still takes entries and picks. A cancelled slot is left out: it
 *   neither starts the window nor gives it a start. A synced slot with no start yet is not
 *   scheduled, so it gives the window none. With no covered slot on the event, or a test slot
 *   (which the sync never schedules), the event's own timing.
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
      // A test slot is never scheduled by the sync, and a root admin moves its event by hand: it
      // stands on its event's own timing. Test and synced events never share a slot.
      if (covered.length === 0 || covered.some((slot) => slot.isTestData)) {
        return sportEvent;
      }
      const started = covered.some((slot) => STARTED_SLOT_STATUSES.includes(slot.status));
      const starts = covered.flatMap((slot) => (
        slot.status === SeasonSlotStatus.CANCELLED || slot.startsAt === null ? [] : [slot.startsAt.getTime()]
      ));
      return {
        status: started ? SportEventStatus.IN_PROGRESS : stillToStart(sportEvent.status),
        startDate: starts.length === 0 ? null : new Date(Math.min(...starts)),
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
 * The covered slot a contest starts at on the event (#2015): of the slots it covers there, the one
 * the event plays first. The event's slot definitions are in play order; a contest's covered slots
 * are ordered by their dates, and a slot whose games are not scheduled yet has none, so their
 * order is not the order of play.
 */
export function contestStartSlot<Slot extends { sportEventId: string | null; slotDefinitionId: string }>(
  coveredSlots: readonly Slot[],
  event: { id: string; slotDefinitionIds: readonly string[] },
): Slot | undefined {
  const playOrder = (slot: Slot) => event.slotDefinitionIds.indexOf(slot.slotDefinitionId);
  return coveredSlots
    .filter((slot) => slot.sportEventId === event.id && playOrder(slot) >= 0)
    .reduce<Slot | undefined>((first, slot) => (first === undefined || playOrder(slot) < playOrder(first) ? slot : first), undefined);
}

/**
 * Whether a field contest starting at the slot waits for the games before it (#2015): the event
 * plays matches and the slot is not its first, so earlier slots' games feed its teams. A contest
 * starting at the event's first slot, or on an event played as one field, has no game to wait for,
 * so nothing is read for it.
 */
export function slotWaitsForFeedingGames(
  event: { playsMatches: boolean; slotDefinitionIds: readonly string[] },
  slotDefinitionId: string,
): boolean {
  return event.playsMatches && event.slotDefinitionIds.indexOf(slotDefinitionId) > 0;
}

/**
 * Whether every team of a Season slot is known (#2015): no side of the slot's games, cancelled ones
 * left out, still waits for the game feeding it. A contest picking from the field (tiered, budget,
 * sweepstakes) waits for it before it opens, since its field is the slot's teams; brackets and
 * pick'em pick sides, which can be "winner of". A slot with no game yet has nothing to decide.
 */
export function isSlotFieldDecided(
  matches: readonly (Pick<SportEventRoundMatch, 'status' | 'sides'> & { slot: Pick<SportEventRoundMatch['slot'], 'seasonSlotId'> })[],
  seasonSlotId: string,
): boolean {
  return matches.every((match) => match.slot.seasonSlotId !== seasonSlotId
    || match.status === MatchStatus.CANCELLED
    || match.sides.every((side) => side.sportEventParticipantId !== null));
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
  const kickoff = match.scheduledDate ?? sportEvent.startDate;
  return hasGameMovedOn(match) || (kickoff !== null && kickoff <= now);
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
