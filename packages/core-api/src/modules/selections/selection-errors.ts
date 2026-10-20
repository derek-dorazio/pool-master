/**
 * The one error type for the selection-room operations (#324): reading a selection room, and
 * submitting a selection into one. Each carries its contract code and HTTP status, so the
 * handler maps any of them the same way and the codes are stated once instead of as string
 * literals beside each `reply.status(...)`.
 *
 * The wording of every message below is the wording the route sent before the extraction, and
 * the status codes are unchanged — #324 is a restructure, so a reworded message would be a
 * contract change wearing a refactor's clothes.
 */

import type { ContestStatus, SelectionType } from '@poolmaster/shared/domain';
import type { LineupShortfall } from './types';
import type { ApiErrorCode } from '@poolmaster/shared/dto';

export class SelectionError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SelectionError';
  }
}

export const selectionErrors = {
  contestNotFound: (contestId: string) =>
    new SelectionError(`Contest ${contestId} was not found`, 'CONTEST_NOT_FOUND', 404),

  eventNotInContest: (sportEventId: string, contestId: string) =>
    new SelectionError(`Event ${sportEventId} is not one contest ${contestId} covers`, 'CONTEST_EVENT_NOT_IN_CONTEST', 404),

  /** A contest from before #713 whose single event was never set covers none, so it has no room. */
  contestHasNoEvent: (contestId: string) =>
    new SelectionError(`Contest ${contestId} covers no sport event yet`, 'CONTEST_EVENT_REQUIRED', 409),

  /** The selection room picks a lineup; a pick'em contest's entries pick games instead (#716). */
  contestTakesGamePicks: (contestId: string) =>
    new SelectionError(
      `Contest ${contestId} is a prediction contest; its entries pick the winners of games, not a lineup`,
      'CONTEST_FORMAT_MISMATCH',
      409,
    ),

  /** Game picks are a prediction contest's; a roster contest's entries pick a lineup (#716). */
  contestTakesRosterPicks: (contestId: string) =>
    new SelectionError(
      `Contest ${contestId} is a roster contest; its entries pick a lineup, not the winners of games`,
      'CONTEST_FORMAT_MISMATCH',
      409,
    ),

  /** A squares contest's entries claim boxes of its grid, and pick neither a lineup nor games (#711). */
  contestTakesSquares: (contestId: string) =>
    new SelectionError(
      `Contest ${contestId} is a squares contest; its entries claim boxes of its grid, not picks`,
      'CONTEST_FORMAT_MISMATCH',
      409,
    ),

  entryNotFound: (entryId: string, contestId: string) =>
    new SelectionError(
      `Entry ${entryId} was not found for contest ${contestId}`,
      'CONTEST_ENTRY_NOT_FOUND',
      404,
    ),

  authSessionRequired: () =>
    new SelectionError('Authenticated session required', 'AUTH_SESSION_REQUIRED', 401),

  entryAccessDenied: () =>
    new SelectionError(
      'You can only submit picks for your own contest entry',
      'ENTRY_ACCESS_DENIED',
      403,
    ),

  /**
   * Picks change only while the contest is OPEN, the same window and the same code as
   * creating, editing or leaving the entry itself (`ContestService`, #117): a DRAFT is the
   * commissioner's alone, and from ACTIVE on every entry's picks are public.
   */
  selectionLocked: (contestId: string, status: string) =>
    new SelectionError(
      `Contest ${contestId} is ${status}; picks can only be changed while it is open`,
      'CONTEST_ENTRY_LOCKED',
      409,
    ),

  /** The same lock, reached by the event's start time while the contest still says OPEN. */
  selectionLockedByEventStart: (contestId: string) =>
    new SelectionError(
      `Contest ${contestId}'s event has started; picks can no longer be changed`,
      'CONTEST_ENTRY_LOCKED',
      409,
    ),

  selectionConfigInvalid: (contestId: string) =>
    new SelectionError(
      `Contest ${contestId} does not have a usable roster size or pick count`,
      'SELECTION_CONFIG_INVALID',
      400,
    ),

  participantNotInEvent: (participantId: string, contestId: string) =>
    new SelectionError(
      `SportEventParticipant ${participantId} is not part of contest ${contestId}`,
      'PARTICIPANT_NOT_IN_EVENT',
      400,
    ),

  participantNotSelectable: (participantId: string, contestId: string) =>
    new SelectionError(
      `SportEventParticipant ${participantId} is not selectable for contest ${contestId}`,
      'PARTICIPANT_NOT_SELECTABLE',
      400,
    ),

  /** Names the field row's status in the message when it has one. */
  participantUnavailable: (participantId: string, status: string | null) =>
    new SelectionError(
      status
        ? `SportEventParticipant ${participantId} is unavailable with status ${status}`
        : `SportEventParticipant ${participantId} is unavailable`,
      'PARTICIPANT_UNAVAILABLE',
      400,
    ),

  tierMissing: (participantId: string) =>
    new SelectionError(
      `SportEventParticipant ${participantId} is missing a tier assignment`,
      'TIER_MISSING',
      400,
    ),

  tierNotFound: (tier: string, contestId: string) =>
    new SelectionError(
      `Tier ${tier} is not configured for contest ${contestId}`,
      'TIER_NOT_FOUND',
      400,
    ),

  /** A budget pick must be spent against the cap, so a golfer with no price cannot be picked (#93). */
  priceMissing: (participantId: string) =>
    new SelectionError(
      `SportEventParticipant ${participantId} has no price, so it cannot be picked in a budget contest`,
      'PRICE_MISSING',
      400,
    ),

  /**
   * Raised on two paths that must stay distinct in the code even though they answer
   * identically: a tiered entry that is full with no tier to replace within, and a
   * budget-pick entry that is simply full.
   */
  entryComplete: (entryId: string, rosterSize: number) =>
    new SelectionError(
      `Entry ${entryId} has already submitted all ${rosterSize} picks`,
      'ENTRY_COMPLETE',
      400,
    ),

  /** Submitting an entry closes with its picks (#481): the same window and the same code. */
  submitLocked: (contestId: string, status: string) =>
    new SelectionError(
      `Contest ${contestId} is ${status}; entries can only be submitted while it is open`,
      'CONTEST_ENTRY_LOCKED',
      409,
    ),

  submitLockedByEventStart: (contestId: string) =>
    new SelectionError(
      `Contest ${contestId}'s event has started; entries can no longer be submitted`,
      'CONTEST_ENTRY_LOCKED',
      409,
    ),

  /** An entry is submitted only with a complete lineup (#481). Names the short tiers, if any. */
  lineupIncomplete: (entryId: string, shortfall: LineupShortfall) =>
    new SelectionError(
      shortfall.shortTierNames.length > 0
        ? `Entry ${entryId} cannot be submitted until every tier is filled: ${shortfall.shortTierNames.join(', ')} still need picks`
        : `Entry ${entryId} cannot be submitted until its lineup is complete: it holds ${shortfall.pickCount} of ${shortfall.rosterSize} picks`,
      'ENTRY_LINEUP_INCOMPLETE',
      409,
    ),

  /**
   * A budget entry is submitted only when its picks cost no more than the salary cap (#93).
   * Picks are never refused for the budget; only submitting is.
   */
  overBudget: (entryId: string, spent: number, salaryCap: number) =>
    new SelectionError(
      `Entry ${entryId} cannot be submitted while its picks cost ${formatDollars(spent)}, over the ${formatDollars(salaryCap)} salary cap`,
      'ENTRY_OVER_BUDGET',
      409,
    ),

  /** In a random-draw contest nobody picks: the draw deals every pick (#601). */
  dealtByDraw: (contestId: string) =>
    new SelectionError(
      `Contest ${contestId} is a random draw; its picks are dealt by the draw, not chosen`,
      'SELECTION_DEALT_BY_DRAW',
      409,
    ),

  /** Only a random-draw contest has a draw to run (#601). */
  notRandomDraw: (contestId: string, selectionType: SelectionType) =>
    new SelectionError(
      `Contest ${contestId} is ${selectionType}; only a random-draw contest runs a draw`,
      'CONTEST_NOT_RANDOM_DRAW',
      409,
    ),

  /** A contest is drawn once, and the draw is final (#601). */
  drawAlreadyRun: (contestId: string) =>
    new SelectionError(`Contest ${contestId} has already been drawn`, 'CONTEST_DRAW_ALREADY_RUN', 409),

  /** The draw deals to the entries of an OPEN contest: a DRAFT has none, and later is too late. */
  drawNotOpen: (contestId: string, status: ContestStatus) =>
    new SelectionError(
      `Contest ${contestId} is ${status}; the draw runs only while it is open`,
      'CONTEST_DRAW_NOT_OPEN',
      409,
    ),

  /** The draw must come before the golfers start playing. */
  drawEventStarted: (contestId: string) =>
    new SelectionError(
      `Contest ${contestId}'s event has started; it can no longer be drawn`,
      'CONTEST_EVENT_ALREADY_STARTED',
      409,
    ),

  drawNoEntries: (contestId: string) =>
    new SelectionError(`Contest ${contestId} has no entries to draw for`, 'CONTEST_DRAW_NO_ENTRIES', 409),

  /** Every entry is dealt the same count, so the field must hold that many for each. */
  drawFieldTooSmall: (contestId: string, fieldSize: number, entryCount: number, picksPerEntry: number) =>
    new SelectionError(
      `Contest ${contestId}'s field of ${fieldSize} cannot deal ${picksPerEntry} to each of ${entryCount} entries (${entryCount * picksPerEntry} needed)`,
      'CONTEST_DRAW_FIELD_TOO_SMALL',
      409,
    ),

  /** An entry was added or removed while the draw was dealing; nothing was dealt. */
  drawEntriesChanged: (contestId: string) =>
    new SelectionError(
      `Contest ${contestId}'s entries changed while it was being drawn; nothing was dealt, so run the draw again`,
      'CONTEST_DRAW_ENTRIES_CHANGED',
      409,
    ),

  /** Only the entry's own squad, and members of its league, see its game picks (#716). */
  entryViewDenied: () =>
    new SelectionError(
      'You can only view the entries of a league you belong to',
      'ENTRY_ACCESS_DENIED',
      403,
    ),

  /** A pick names one of the event's games (#716). */
  gameNotFound: (sportEventMatchId: string, sportEventId: string) =>
    new SelectionError(
      `Game ${sportEventMatchId} is not one of event ${sportEventId}'s games`,
      'PREDICTION_GAME_NOT_FOUND',
      404,
    ),

  /** A pick names one of the two teams playing the game, so a game with a side still to be decided takes none. */
  teamNotInGame: (sportEventParticipantId: string, sportEventMatchId: string) =>
    new SelectionError(
      `SportEventParticipant ${sportEventParticipantId} is not playing in game ${sportEventMatchId}`,
      'PREDICTION_TEAM_NOT_IN_GAME',
      400,
    ),

  /** Each game's pick locks at its kickoff (#716). */
  gameStarted: (sportEventMatchId: string) =>
    new SelectionError(
      `Game ${sportEventMatchId} has started; its pick can no longer be changed`,
      'PREDICTION_GAME_STARTED',
      409,
    ),

  /** A week of games is picked while the contest takes picks (#716). */
  weekLocked: (contestId: string, status: string) =>
    new SelectionError(
      `Contest ${contestId} is ${status}; game picks can only be changed while it takes picks`,
      'CONTEST_ENTRY_LOCKED',
      409,
    ),

  /** A week still in draft at its first kickoff doesn't count, so it can no longer be picked or submitted (#716). */
  weekNotSubmittedInTime: (entryId: string, sportEventId: string) =>
    new SelectionError(
      `Entry ${entryId} did not submit event ${sportEventId}'s picks before its first game started, so they can no longer be changed or submitted`,
      'CONTEST_ENTRY_LOCKED',
      409,
    ),

  /** A confidence value is 1 to the week's game count, and only a confidence pool takes one (#716). */
  confidenceInvalid: (detail: string) =>
    new SelectionError(detail, 'PREDICTION_CONFIDENCE_INVALID', 409),

  /** A week is submitted only once every game is picked (#716). */
  weekIncomplete: (entryId: string, pickedCount: number, gameCount: number) =>
    new SelectionError(
      `Entry ${entryId} cannot be submitted until every game is picked: it has ${pickedCount} of ${gameCount}`,
      'PREDICTION_WEEK_INCOMPLETE',
      409,
    ),

  /** A survivor week (#719) is submitted with exactly one pick; a playoff round (#785) holds one. */
  onePickRequired: (entryId: string, pickedCount: number) =>
    new SelectionError(
      `Entry ${entryId} picks one team a week (or playoff round) in a survivor pool: it has ${pickedCount}`,
      'PREDICTION_ONE_PICK_REQUIRED',
      409,
    ),

  /** A survivor entry (#719) picks each team once a season. */
  teamAlreadyUsed: (entryId: string, sportEventParticipantId: string) =>
    new SelectionError(
      `Entry ${entryId} picked team ${sportEventParticipantId} in another week or round: a survivor entry picks each team once`,
      'PREDICTION_TEAM_ALREADY_USED',
      409,
    ),

  /** A survivor entry (#719) that is out plays no later week. */
  entryEliminated: (entryId: string, weekNumber: number) =>
    new SelectionError(
      `Entry ${entryId} went out in week ${weekNumber}, so it picks no later week`,
      'PREDICTION_ENTRY_ELIMINATED',
      409,
    ),

  /** Every week is submitted with its tiebreaker (#717): a guess of its tiebreaker game's total points. */
  tiebreakerMissing: (entryId: string) =>
    new SelectionError(
      `Entry ${entryId} cannot be submitted until it gives a tiebreaker: the total points of its tiebreaker game`,
      'PREDICTION_TIEBREAKER_MISSING',
      409,
    ),

  /** The tiebreaker locks with its game's pick: when a bracket starts (#721), at a week's last kickoff (#717). */
  tiebreakerLocked: (entryId: string) =>
    new SelectionError(
      `The tiebreaker game has started; entry ${entryId}'s tiebreaker can no longer be changed`,
      'CONTEST_ENTRY_LOCKED',
      409,
    ),

  /** After the first kickoff a submitted week stays submitted: a pick can be swapped, not cleared (#716). */
  clearAfterFirstKickoff: (sportEventMatchId: string) =>
    new SelectionError(
      `The week's first game has started; the pick on game ${sportEventMatchId} can be changed to the other team but not cleared`,
      'PREDICTION_CLEAR_AFTER_FIRST_KICKOFF',
      409,
    ),
} as const;

function formatDollars(amount: number): string {
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
