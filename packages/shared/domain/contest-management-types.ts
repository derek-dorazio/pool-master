import type {
  AutoPickPolicy,
  ContestFormat,
  ParticipantInactiveReason,
  SelectionType,
  Sport,
  SportEventStatus,
  SportEventSyncScope,
} from './enums';
import type { EventPricingConfig } from './budget-pricing';
import type { ParticipantScoringDefinitionId } from './contest-scoring';
import type { DomainEntity } from './types';

export interface GolfContestTierDefinition {
  tierKey: string;
  label: string;
  pickCount: number;
  startPosition: number;
  endPosition: number | null;
}

export interface PersistedGolfContestTierDefinition extends GolfContestTierDefinition {
  tierId?: string;
  tierName?: string;
  tierNumber?: number;
  picksFromTier?: number;
  participantIds?: string[];
}

/**
 * Shrunk per plans/124 §4.6/§4.6a: tiers and price are event-owned data
 * (SportEventTier/SportEventParticipantValuation via
 * SportEventTierService.getEffectiveTiersForSportEvent), never a per-contest
 * override, so tierSource/tierGeneration/tiers all drop. cutRule/
 * playoffHandling/displayScoring/tiebreaker each had exactly one possible
 * value and zero real reads downstream — dropped as dead configuration, not
 * simplified. picksPerTier/countedScores are the one thing that's genuinely a
 * per-pool rule (two commissioners on the same tournament can legitimately
 * pick different numbers per tier). The roster is the event's tier count times
 * picksPerTier, derived on read (#479; see tiered-roster.ts).
 */
export interface GolfTieredContestConfig {
  /** Picks every tier takes; the same for each tier. */
  picksPerTier: number;
  /** Best N picks that count toward the entry total; at most the derived roster size. */
  countedScores: number;
}

/**
 * Golf-first managed contest configuration. Only the tiered mode is
 * implemented today; `GOLF_CATEGORY_PICKS` was a fully-typed stub with no
 * backend and was removed (plans/124 §4.11). `plans/127-golf-category-drafts.md`
 * rebuilds category picks on a clean slate, not by resurrecting the stub.
 */
export type GolfContestConfig = GolfTieredContestConfig;

export type SportEventReadinessStatus =
  | 'NOT_RELEASED'
  | 'PENDING_FIELD'
  | 'CONTEST_ELIGIBLE'
  | 'EVENT_STARTED';

export type SportEventReadinessReason =
  | 'EVENT_NOT_RELEASED'
  | 'FIELD_NOT_LOADED'
  | 'EVENT_STARTED';

/** A real-world event a contest can be run on. `DRAFT` until an admin releases it (#431). */
export interface SportEvent extends DomainEntity {
  externalId: string;
  providerId: string;
  sport: Sport;
  name: string;
  venue?: string;
  location?: string;
  startDate: Date;
  endDate?: Date;
  status: SportEventStatus;
  rounds?: number;
  /** Par for every round, when an admin set it; unset, contest scoring derives each round's par from the field (#478). */
  roundsPar?: number;
  participantCount?: number;
  metadata: Record<string, unknown>;
  /** The event series — the recurring tournament — this is one edition of. Its only parent. */
  eventSeriesId: string;
  /** The year this edition is branded with ("the 2026 Masters"); not always the year it starts. */
  eventYear: number;
  /** The series' sport league, read through the series — never stored on the event (plans/147 decision 7). */
  sportLeagueId: string;
  syncScope: SportEventSyncScope;
  /** False stops the lifecycle scheduler moving this event's status. */
  autoLifecycleEnabled: boolean;
  /**
   * The values the field was last priced with for budget contests (#93); unset until prices are
   * assigned. Locks with the prices at release, and is every budget contest's salary cap.
   */
  pricingConfig?: EventPricingConfig;
}

/**
 * Join record linking a provider event to a normalized participant. The
 * Per-event participant state for a normalized event field. `ranking` is the
 * rank that applied at this event — copied from the latest provider ranking
 * snapshot during event hydration, then editable; odds and seed are
 * event-scoped values from the event detail feed.
 */
export interface SportEventParticipant extends DomainEntity {
  sportEventId: string;
  participantId: string;
  /** Whether this golfer is currently eligible/available for this tournament. */
  isActive: boolean;
  /** Meaningful only when `isActive` is false; undefined covers "inactive, no more specific reason recorded." */
  inactiveReason?: ParticipantInactiveReason;
  /** Rank that applied at this event: copied from the provider's ranking snapshot, then editable. */
  ranking?: number;
  /** Event-scoped implied odds-to-win snapshot (decimal). */
  oddsToWin?: number;
  /** Event-relative seed number (e.g., NCAA tournament seed). */
  seedNumber?: number;
  metadata: Record<string, unknown>;
}

/** Raw provider payload captured for a sport-event participant synchronization. */
export interface SportEventParticipantSourceData extends DomainEntity {
  sportEventParticipantId: string;
  providerId: string;
  externalId: string;
  rawPayload: Record<string, unknown>;
  normalizedData: Record<string, unknown>;
  receivedAt: Date;
}

/** Commissioner-managed contest configuration persisted alongside the contest. */
export interface ContestConfiguration extends DomainEntity {
  contestId: string;
  templateId?: string | null;
  templateVersion?: number | null;
  selectionType: SelectionType;
  configJson?: GolfContestConfig;
  rounds?: number;
  timePerPickSeconds?: number;
  autoPickPolicy?: AutoPickPolicy;
  minimumEntries?: number;
  maxEntriesPerSquad?: number | null;
  totalPrizePoolAmount?: number | null;

  // Legacy support fields retained temporarily for read paths not yet narrowed.
  roundValues?: number[];
  startRound?: string;
  tierConfig?: PersistedGolfContestTierDefinition[];
  budget?: number;
  pickCount?: number;
  isExclusive?: boolean;
  picksPerPeriod?: number;
  rosterSize?: number;
}

/** Seeded reusable contest template selected during commissioner create flow. */
export interface ContestConfigTemplate extends DomainEntity {
  sport: Sport;
  eventType?: string | null;
  contestFormat: ContestFormat;
  /** How an entry in a contest created from this template picks. */
  selectionType: SelectionType;
  templateKey: string;
  name: string;
  description: string;
  sortOrder: number;
  isDefault: boolean;
  active: boolean;
  configJson: GolfContestConfig;
  schemaVersion: number;
}

/** Participant scoring rule attached to a managed contest configuration. */
export interface ParticipantContestScoringRule extends DomainEntity {
  contestConfigurationId: string;
  participantScoringDefinitionId: ParticipantScoringDefinitionId;
  sortOrder: number;
  config: Record<string, unknown>;
  active: boolean;
}

