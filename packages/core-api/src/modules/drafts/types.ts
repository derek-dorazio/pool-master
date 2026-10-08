/**
 * The draft module's internal vocabulary (#324) — what `DraftService` reads, computes and
 * returns, in domain terms. These are not DTOs: `mappers/drafts.mapper.ts` projects the view
 * below onto the published `DraftStateResponse` shape.
 */

import type {
  Contest,
  ContestConfiguration,
  ContestEntry,
  DraftStatus,
  SquadMembership,
} from '@poolmaster/shared/domain';

/**
 * A tier as the draft room uses it: the event owns tiers now (plans/124 §4.6/§4.6b), and
 * `buildDraftTiers` is the one place a resolved `SportEventTierGroup[]` becomes this shape.
 */
export interface DraftTierConfig {
  tierId: string;
  tierName: string;
  tierNumber: number;
  picksFromTier: number;
  participantIds: string[];
}

/** One selectable field row, with its effective tier and price already resolved. */
export interface SelectionParticipant {
  sportEventParticipantId: string;
  participantId: string;
  participantName: string;
  role?: string | null;
  teamAffiliation?: string | null;
  status?: string | null;
  price?: number;
  ranking?: number;
  tier?: string | null;
  orderIndex?: number;
  isAvailable: boolean;
  unavailableReason?: string;
}

/** One field row's effective tier and price, keyed by `sportEventParticipantId`. */
export interface ParticipantValuation {
  tierLabel: string | null;
  tierOrderIndex: number | null;
  price: number | null;
}

/**
 * Everything one draft-room operation reads about a contest, assembled once per request.
 * `tiers` is resolved here so every group-by-tier call site reads it rather than re-deriving
 * it (plans/124 §4.6b).
 */
export interface DraftContext {
  contest: Contest;
  configuration: ContestConfiguration | null;
  entries: ContestEntry[];
  squadMemberships: SquadMembership[];
  selectionParticipants: SelectionParticipant[];
  tiers: DraftTierConfig[];
  /**
   * Whether the contest takes pick changes now: it is OPEN and its event has not reached its
   * start time. The start time counts even while the contest still says OPEN, because the
   * status follows the event's own move to IN_PROGRESS, which can lag the start or, with
   * auto-lifecycle off, not come at all.
   */
  acceptsPicks: boolean;
}

/** A pick as the draft room reads it: the row, plus the canonical participant it points at. */
export interface DraftPick {
  id: string;
  entryId: string;
  sportEventParticipantId: string;
  participantId: string;
  participantName: string | null;
  role: string | null;
  teamAffiliation: string | null;
  draftRound?: number;
  draftPickNumber?: number;
  isAutoPicked: boolean;
  pickedAt: Date;
}

/** An entry in the room, with the user who owns it and how many picks it holds. */
export interface DraftRoomEntry {
  id: string;
  userId: string;
  name: string;
  pickCount: number;
}

/** One pick as the room's history shows it, with its round placement resolved. */
export interface DraftRoomPick {
  pickNumber: number;
  round: number;
  pickInRound: number;
  entryId: string;
  entryName: string;
  sportEventParticipantId: string;
  participantName: string;
  role?: string;
  teamAffiliation?: string;
  price?: number;
  tierId?: string;
  tierName?: string;
  isAutoPicked: boolean;
  pickedAt: Date;
}

/** A tier with its selectable participants, and which of them the viewed entry holds. */
export interface DraftSelectionGroup {
  groupId: string;
  groupName: string;
  groupNumber: number;
  picksFromGroup: number;
  participants: Array<SelectionParticipant & { isSelected: boolean }>;
}

/**
 * The outcome of a draft-room operation: the whole room as the caller should now see it.
 * Both operations return this — reading the room, and submitting into it — which is why the
 * submission response and the state response have always been the same shape.
 */
export interface DraftRoomView {
  contest: Contest;
  configuration: ContestConfiguration | null;
  tiers: DraftTierConfig[];
  rosterSize: number;
  isCommissioner: boolean;
  status: DraftStatus;
  entries: DraftRoomEntry[];
  picks: DraftRoomPick[];
  selectionGroups: DraftSelectionGroup[];
  availableSportEventParticipantIds: string[];
  myEntryId: string | null;
  selectedEntryId: string | null;
  selectedEntryName: string | null;
  tiebreakerValue: number | null;
  currentPickNumber: number;
  currentRound: number;
  totalPicks: number;
  totalRounds: number;
  currentEntryId: string | null;
  currentEntryName: string | null;
  canCurrentUserSubmit: boolean;
  isComplete: boolean;
}

/**
 * Where a tiered selection lands, as a value rather than a boolean.
 *
 * `plans/144` records why this is a union: the first draft-abstraction attempt gave
 * `validatePick` a `{ valid, reason }` return, and a boolean cannot express *replace* or
 * *toggle off*. The route's real behaviour could therefore never live behind that interface,
 * the engines that did drifted into disagreeing with production, and #323 deleted them. The
 * three outcomes below are the behaviour; keeping them distinct is the point.
 */
export type TieredPlacement =
  | { kind: 'place'; draftRound: number }
  | { kind: 'replace'; draftRound: number; replacedPickId: string }
  | { kind: 'entry-complete' };

/**
 * What submitting a selection did. `toggled-off` removed a pick and inserted nothing;
 * `placed` inserted one, having first removed the pick it replaced when there was one. Both
 * answer with the refreshed room, which is why they are one type and not two code paths with
 * two response shapes.
 */
export interface SubmitSelectionResult {
  outcome: 'placed' | 'toggled-off';
  view: DraftRoomView;
}
