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
} as const;

function formatDollars(amount: number): string {
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
