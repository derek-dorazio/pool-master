/**
 * The selection module's internal vocabulary (#324) — what `SelectionService` reads, computes and
 * returns, in domain terms. These are not DTOs: `mappers/selections.mapper.ts` projects the view
 * below onto the published `SelectionStateResponse` shape.
 */

import type {
  Contest,
  ContestConfiguration,
  ContestEntry,
  ContestEntryStatus,
  SelectionStatus,
  SquadMembership,
} from '@poolmaster/shared/domain';

/**
 * A tier as the selection room uses it: the event owns tiers now (plans/124 §4.6/§4.6b), and
 * `buildSelectionTiers` is the one place a resolved `SportEventTierGroup[]` becomes this shape.
 */
export interface SelectionTierConfig {
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
 * Everything one selection-room operation reads about a contest, assembled once per request.
 * `tiers` is resolved here so every group-by-tier call site reads it rather than re-deriving
 * it (plans/124 §4.6b).
 */
export interface SelectionContext {
  contest: Contest;
  configuration: ContestConfiguration | null;
  entries: ContestEntry[];
  squadMemberships: SquadMembership[];
  selectionParticipants: SelectionParticipant[];
  tiers: SelectionTierConfig[];
  /**
   * Whether the contest takes pick changes now: it is OPEN and its event has not reached its
   * start time. The start time counts even while the contest still says OPEN, because the
   * status follows the event's own move to IN_PROGRESS, which can lag the start or, with
   * auto-lifecycle off, not come at all.
   */
  acceptsPicks: boolean;
}

/** A pick as the selection room reads it: the row, plus the canonical participant it points at. */
export interface ResolvedPick {
  id: string;
  entryId: string;
  sportEventParticipantId: string;
  participantId: string;
  participantName: string | null;
  role: string | null;
  teamAffiliation: string | null;
  lineupSlot?: number;
  pickSequence?: number;
  isAutoPicked: boolean;
  pickedAt: Date;
}

/** An entry in the room, with the user who owns it, how many picks it holds, and its status. */
export interface SelectionEntry {
  id: string;
  userId: string;
  name: string;
  pickCount: number;
  status: ContestEntryStatus;
}

/** One pick as the room's history shows it, with its round placement resolved. */
export interface PickHistoryRow {
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
export interface SelectionGroup {
  groupId: string;
  groupName: string;
  groupNumber: number;
  picksFromGroup: number;
  participants: Array<SelectionParticipant & { isSelected: boolean }>;
}

/**
 * The outcome of a selection-room operation: the whole room as the caller should now see it.
 * Both operations return this — reading the room, and submitting into it — which is why the
 * submission response and the state response have always been the same shape.
 */
export interface SelectionView {
  contest: Contest;
  configuration: ContestConfiguration | null;
  tiers: SelectionTierConfig[];
  rosterSize: number;
  isCommissioner: boolean;
  status: SelectionStatus;
  entries: SelectionEntry[];
  picks: PickHistoryRow[];
  selectionGroups: SelectionGroup[];
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
 * Why a lineup cannot be submitted yet (#481): how many picks it holds against the roster, and
 * which tiers are short of their picks (empty for a budget-pick roster, which has no tiers).
 */
export interface LineupShortfall {
  pickCount: number;
  rosterSize: number;
  shortTierNames: string[];
}

/**
 * What submitting a selection did. `toggled-off` removed a pick and inserted nothing;
 * `placed` inserted one, having first removed the pick it replaced when there was one. Both
 * answer with the refreshed room, which is why they are one type and not two code paths with
 * two response shapes.
 */
export interface SubmitSelectionResult {
  outcome: 'placed' | 'toggled-off';
  view: SelectionView;
}
