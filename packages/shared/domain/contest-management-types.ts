import type {
  ContestFormat,
  ContestTemplateEventType,
  ParticipantInactiveReason,
  SelectionType,
  Sport,
  SportEventStatus,
  SportEventSyncScope,
} from './enums';
import type { EventPricingConfig } from './budget-pricing';
import type { ContestRulesWithEntryLimit, ContestSelectionConfig } from './contest-rules';
import type { ContestScoringSettings, ContestScoringSettingsParse } from './contest-scoring';
import type { DomainEntity } from './types';

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
  /** A bracket place standing for a play-in pairing until its winner fills it (#709). */
  isPlayInPlace: boolean;
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
  /** The contest's rules; its `selectionType` matches the contest's (#93). */
  configJson?: ContestSelectionConfig;
  minimumEntries?: number;
  maxEntriesPerSquad?: number | null;
  totalPrizePoolAmount?: number | null;
}

/** Seeded reusable contest template selected during commissioner create flow. */
export interface ContestConfigTemplate extends DomainEntity {
  sport: Sport;
  /**
   * The sport league whose events this template is offered for (a league's own official preset).
   * Null means sport-wide: offered for every league of its sport.
   */
  sportLeagueId: string | null;
  /** The kind of event the template is offered for (#802); null offers it for every event of its sport. */
  eventType?: ContestTemplateEventType | null;
  contestFormat: ContestFormat;
  /** How an entry in a contest created from this template picks. */
  selectionType: SelectionType;
  templateKey: string;
  name: string;
  description: string;
  sortOrder: number;
  isDefault: boolean;
  active: boolean;
  configJson: ContestRulesWithEntryLimit;
  schemaVersion: number;
  /**
   * The event series a contest made from this template covers, by name in its sport league (#714:
   * a majors pool's four majors). The contest takes each series' edition of its year as that
   * edition is released for contests. Empty: the commissioner adds the contest's events.
   */
  eventSeriesNames: string[];
}

/**
 * Participant scoring rule attached to a managed contest configuration, as read. Its stored
 * definition id and `config` column are read through the definition's settings schema
 * (`PARTICIPANT_SCORING_SETTINGS_SCHEMAS`), so a valid rule carries typed settings and one that
 * names a retired definition or holds refused settings says so.
 */
export interface ParticipantContestScoringRule extends DomainEntity {
  contestConfigurationId: string;
  sortOrder: number;
  scoring: ContestScoringSettingsParse;
  active: boolean;
}

/** A participant scoring rule as written: its settings are typed by its definition. */
export interface ParticipantContestScoringRuleCreate {
  contestConfigurationId: string;
  sortOrder: number;
  scoring: ContestScoringSettings;
  active: boolean;
}

