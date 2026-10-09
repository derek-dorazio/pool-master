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

import type { LineupShortfall } from './types';

export class SelectionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SelectionError';
  }
}

export const selectionErrors = {
  contestNotFound: (contestId: string) =>
    new SelectionError(`Contest ${contestId} was not found`, 'CONTEST_NOT_FOUND', 404),

  entryNotFound: (entryId: string, contestId: string) =>
    new SelectionError(
      `Entry ${entryId} was not found for contest ${contestId}`,
      'ENTRY_NOT_FOUND',
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
   * Two wordings, one code: the selection-state read says "selection-room endpoints", the submission
   * says "pick submission". Both were inline in the route and both are kept verbatim.
   */
  selectionTypeUnsupportedForRead: (selectionType: string) =>
    new SelectionError(
      `${selectionType} selection-room endpoints are not implemented yet`,
      'SELECTION_TYPE_UNSUPPORTED',
      501,
    ),

  selectionTypeUnsupportedForSubmission: (selectionType: string) =>
    new SelectionError(
      `${selectionType} pick submission is not implemented yet`,
      'SELECTION_TYPE_UNSUPPORTED',
      501,
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

  /** Falls back to a generic sentence when the field row carries no reason of its own. */
  participantUnavailable: (participantId: string, reason?: string) =>
    new SelectionError(
      reason ?? `SportEventParticipant ${participantId} is unavailable`,
      'PARTICIPANT_UNAVAILABLE',
      400,
    ),

  duplicatePick: (participantId: string) =>
    new SelectionError(
      `SportEventParticipant ${participantId} is already on this entry`,
      'DUPLICATE_PICK',
      400,
    ),

  participantAlreadyTaken: (participantId: string) =>
    new SelectionError(
      `SportEventParticipant ${participantId} is already selected by another entry`,
      'PARTICIPANT_ALREADY_TAKEN',
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
} as const;
