/**
 * The one error type for the draft-room operations (#324): reading a draft room, and
 * submitting a selection into one. Each carries its contract code and HTTP status, so the
 * handler maps any of them the same way and the codes are stated once instead of as string
 * literals beside each `reply.status(...)`.
 *
 * The wording of every message below is the wording the route sent before the extraction, and
 * the status codes are unchanged — #324 is a restructure, so a reworded message would be a
 * contract change wearing a refactor's clothes.
 */

export class DraftError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DraftError';
  }
}

export const draftErrors = {
  contestNotFound: (contestId: string) =>
    new DraftError(`Contest ${contestId} was not found`, 'CONTEST_NOT_FOUND', 404),

  entryNotFound: (entryId: string, contestId: string) =>
    new DraftError(
      `Entry ${entryId} was not found for contest ${contestId}`,
      'ENTRY_NOT_FOUND',
      404,
    ),

  authSessionRequired: () =>
    new DraftError('Authenticated session required', 'AUTH_SESSION_REQUIRED', 401),

  entryAccessDenied: () =>
    new DraftError(
      'You can only submit draft picks for your own contest entry',
      'DRAFT_ENTRY_ACCESS_DENIED',
      403,
    ),

  /**
   * Two wordings, one code: the draft-state read says "draft-room endpoints", the submission
   * says "pick submission". Both were inline in the route and both are kept verbatim.
   */
  draftModeUnsupportedForRead: (selectionType: string) =>
    new DraftError(
      `${selectionType} draft-room endpoints are not implemented yet`,
      'DRAFT_MODE_UNSUPPORTED',
      501,
    ),

  draftModeUnsupportedForSubmission: (selectionType: string) =>
    new DraftError(
      `${selectionType} pick submission is not implemented yet`,
      'DRAFT_MODE_UNSUPPORTED',
      501,
    ),

  selectionConfigInvalid: (contestId: string) =>
    new DraftError(
      `Contest ${contestId} does not have a usable roster size or pick count`,
      'SELECTION_CONFIG_INVALID',
      400,
    ),

  participantNotInEvent: (participantId: string, contestId: string) =>
    new DraftError(
      `SportEventParticipant ${participantId} is not part of contest ${contestId}`,
      'PARTICIPANT_NOT_IN_EVENT',
      400,
    ),

  participantNotSelectable: (participantId: string, contestId: string) =>
    new DraftError(
      `SportEventParticipant ${participantId} is not selectable for contest ${contestId}`,
      'PARTICIPANT_NOT_SELECTABLE',
      400,
    ),

  /** Falls back to a generic sentence when the field row carries no reason of its own. */
  participantUnavailable: (participantId: string, reason?: string) =>
    new DraftError(
      reason ?? `SportEventParticipant ${participantId} is unavailable`,
      'PARTICIPANT_UNAVAILABLE',
      400,
    ),

  duplicatePick: (participantId: string) =>
    new DraftError(
      `SportEventParticipant ${participantId} is already on this entry`,
      'DUPLICATE_PICK',
      400,
    ),

  participantAlreadyTaken: (participantId: string) =>
    new DraftError(
      `SportEventParticipant ${participantId} is already selected by another entry`,
      'PARTICIPANT_ALREADY_TAKEN',
      400,
    ),

  tierMissing: (participantId: string) =>
    new DraftError(
      `SportEventParticipant ${participantId} is missing a tier assignment`,
      'TIER_MISSING',
      400,
    ),

  tierNotFound: (tier: string, contestId: string) =>
    new DraftError(
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
    new DraftError(
      `Entry ${entryId} has already submitted all ${rosterSize} picks`,
      'ENTRY_COMPLETE',
      400,
    ),
} as const;
