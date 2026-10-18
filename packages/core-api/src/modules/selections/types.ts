/**
 * The selection module's internal vocabulary (#324) — what `SelectionService` reads, computes and
 * returns, in domain terms. These are not DTOs: `mappers/selections.mapper.ts` projects the view
 * below onto the published `SelectionStateResponse` shape.
 */

import type {
  Contest,
  RosterSelectionType,
  ContestConfiguration,
  ContestEntry,
  ContestEntryStatus,
  SelectionStatus,
  SelectionType,
  SportEvent,
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
  /** The bracket seed (#701): 1 is the best; null where the event seeds nobody. */
  seedNumber: number | null;
  tier?: string | null;
  orderIndex?: number;
  isAvailable: boolean;
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
  /** The contest's selection type: the room serves roster contests only (#716). */
  selectionType: RosterSelectionType;
  /**
   * The contest event the operation is about (#713): its field, tiers and prices are the ones
   * below, and only its picks count. A contest of one event always has that one.
   */
  sportEvent: SportEvent;
  configuration: ContestConfiguration | null;
  entries: ContestEntry[];
  squadMemberships: SquadMembership[];
  selectionParticipants: SelectionParticipant[];
  tiers: SelectionTierConfig[];
  /**
   * Whether the event takes pick changes now: the contest is OPEN (or ACTIVE, with this event
   * still to start) and the event has not reached its start time. The start time counts even
   * while the contest still says OPEN, because the status follows the event's own move to
   * IN_PROGRESS, which can lag the start or, with auto-lifecycle off, not come at all.
   */
  acceptsPicks: boolean;
  /** Whether the event's picks are visible to the whole league (contests/entry-window). */
  picksRevealed: boolean;
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

/** An entry in the room, with the user who owns it, how many picks it holds in the event, and its status there. */
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
  /** The event the room shows (#713). */
  sportEventId: string;
  /** Whether the event's picks can still change. */
  acceptsPicks: boolean;
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
  isComplete: boolean;
  /** The viewed entry's lineup as its engine summarises it; null without an entry or a summary. */
  lineupSummary: LineupSummary | null;
}

/**
 * Why a lineup cannot be submitted yet (#481): how many picks it holds against the roster, and
 * which tiers are short of their picks (empty for a budget-pick roster, which has no tiers).
 * What `ENTRY_LINEUP_INCOMPLETE` reports.
 */
export interface LineupShortfall {
  pickCount: number;
  rosterSize: number;
  shortTierNames: string[];
}

/** The kinds of thing that stop a lineup being submitted. */
export const LineupIssueKind = {
  /** The lineup does not hold exactly the roster's picks, or the roster has no places. */
  ROSTER_SHORT: 'ROSTER_SHORT',
  /** Tiers still owed picks (tiered). */
  TIER_SHORT: 'TIER_SHORT',
  /** The picks cost more than the salary cap (budget, #93). */
  OVER_BUDGET: 'OVER_BUDGET',
} as const;
export type LineupIssueKind = (typeof LineupIssueKind)[keyof typeof LineupIssueKind];

/** One thing that stops a lineup being submitted. Money is in dollars, summed in cents. */
export type LineupIssue =
  | { kind: typeof LineupIssueKind.ROSTER_SHORT; pickCount: number; rosterSize: number }
  | { kind: typeof LineupIssueKind.TIER_SHORT; tierNames: string[] }
  | { kind: typeof LineupIssueKind.OVER_BUDGET; spent: number; salaryCap: number };

/** A group of the field as an engine lists it, before the room marks the viewed entry's picks. */
export interface FieldGroup {
  groupId: string;
  groupName: string;
  groupNumber: number;
  picksFromGroup: number;
  participants: SelectionParticipant[];
}

/**
 * The viewed budget lineup's spend (#93), in dollars summed in cents. `cheapestFill` is what
 * the cheapest available golfers not on the entry would cost to fill its open places, null
 * when the field cannot fill them; the page warns with it and never blocks a pick.
 */
export interface BudgetLineupSummary {
  selectionType: typeof SelectionType.BUDGET_PICK;
  salaryCap: number;
  spent: number;
  remaining: number;
  isOverBudget: boolean;
  openSlots: number;
  cheapestFill: number | null;
}

/** What the room says about the viewed lineup beyond its picks, one shape per selection type. */
export type LineupSummary = BudgetLineupSummary;

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
