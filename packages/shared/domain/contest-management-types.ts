import type {
  ContestFormat,
  TemplateCoverageMode,
  LeaguePhase,
  MatchFormat,
  SlotKind,
  SportEventParticipantStatus,
  ParticipantType,
  SelectionType,
  Sport,
  SportEventStatus,
} from './enums';
import type { SportEventProviderMapping } from './providers';
import type { AutoReleaseCheck } from './sport-league-overview';
import type { ContestRulesWithEntryLimit, ContestRules } from './contest-rules';
import type { ContestScoringSettings, ContestScoringSettingsParse } from './contest-scoring';
import type { ScoringFamily } from './sports/scoring-family';
import type { DomainEntity } from './types';
import type { SlotPeriods } from './slot-periods';

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
  /**
   * The provider ids the sync gave the event (#2004), one per provider; empty for a test event.
   * Read its league's provider's with `eventFeedRef`.
   */
  providerMappings: SportEventProviderMapping[];
  /** Its sport league's sport, read through its Season (#2004, #2042); the event keeps no copy. */
  sport: Sport;
  /** That sport's stored URL segment, for the links and pictures that name the sport (#2042). */
  sportUrlSegment: string;
  name: string;
  venue?: string;
  location?: string;
  startDate: Date;
  endDate?: Date;
  status: SportEventStatus;
  /**
   * How many rounds the event has (#2008): the count of its Round rows, read with it and never
   * stored. A bracket has a round per slot, so its count is its FINAL slot's round. 0 before the
   * sync or a test event gives it any.
   */
  roundCount: number;
  /** The slot definitions of the Season slots the event covers, in play order (#2004, #2010): where templates are offered. */
  slotDefinitions: SportEventSlotDefinition[];
  /** The Season the event is played in (#2003). */
  sportLeagueSeasonId: string;
  /**
   * The year its Season is named for (#2003): NFL 2025 for a Super Bowl played in February 2026.
   * Read through the Season, never stored on the event.
   */
  championshipYear: number;
  /** The event's sport league (#2010): stored, and its Season is the same league's (a composite key). */
  sportLeagueId: string;
  /**
   * Its sport league's participant type and scoring family (#2001), read through the
   * league. Read through `eventSportDefinition`.
   */
  participantType: ParticipantType;
  scoringFamily: ScoringFamily;
  /**
   * The provider whose sync creates and keeps its sport league's events (ADR 0011), read
   * through the league; absent when no provider syncs the league. Whether this
   * event is one the sync keeps is `isProviderSyncedEvent`.
   */
  syncProviderId?: string;
  /** That provider's name (#1999), read with it; absent when an admin authors the league's events. */
  syncProviderName?: string;
  /** False stops the lifecycle scheduler moving this event's status. */
  autoLifecycleEnabled: boolean;
  /**
   * The latest automatic release check (#1847): when the release job last judged the event, and
   * whether it released or held it. Unset until the first check, and after a release by hand.
   */
  autoReleaseCheck?: AutoReleaseCheck;
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
  /** The row's place in the event: ACTIVE while it competes, or how it went out (#2184). */
  status: SportEventParticipantStatus;
  /** Rank that applied at this event: copied from the provider's ranking snapshot, then editable. */
  ranking?: number;
  /** Event-scoped implied odds-to-win snapshot (decimal). */
  oddsToWin?: number;
  /** Event-relative seed number (e.g., NCAA tournament seed). */
  seedNumber?: number;
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
  /** The template the contest was made from (#2014): every contest has one. */
  templateId: string;
  templateVersion?: number | null;
  selectionType: SelectionType;
  /** The contest's rules; its `selectionType` matches the contest's (#93). */
  configJson?: ContestRules;
  minimumEntries?: number;
  maxEntriesPerSquad?: number | null;
  totalPrizePoolAmount?: number | null;
}

/** What a contest configuration is written from: everything but its ids and times. */
export type ContestConfigurationWrite = Omit<ContestConfiguration, 'id' | 'createdAt' | 'updatedAt'>;

/** Seeded reusable contest template selected during commissioner create flow. */
export interface ContestConfigTemplate extends DomainEntity {
  /**
   * The sport league whose events this template is offered for. Every template belongs to one
   * (#1825); two leagues offering the same setup each have their own copy.
   */
  sportLeagueId: string;
  /** How a contest made from the template covers its slot definitions (#2010). */
  coverageMode: TemplateCoverageMode;
  /** The slot definitions the template covers, in play order: where it is offered (#2010). */
  slots: ContestTemplateSlot[];
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
}

/** A slot definition one of an event's Season slots plays (#2010): its id and kind. */
export interface SportEventSlotDefinition {
  id: string;
  slotKind: SlotKind;
  /** Whether the slot's games can finish level (#2043); where not, a shoot-out may decide one (#2046). */
  canEndTied: boolean;
  /** What its games are played in (#2047): four quarters, eighteen holes; null for a race or tennis match. */
  periods: SlotPeriods | null;
  /** Two sides meeting, or a whole field ranked (#2043): whether the event plays matches is read from it (`eventPlaysMatches`). */
  matchFormat: MatchFormat;
}

/** One slot definition a contest template covers (#2010), with the facts screens and checks read. */
export interface ContestTemplateSlot {
  /** The slot definition's id. */
  id: string;
  /** Its code in the league (WEEK_14, FINAL, MASTERS); nothing parses it. */
  key: string;
  /** The league's proper name for it, or null for the word for its kind. */
  name: string | null;
  slotKind: SlotKind;
  weekNumber: number | null;
  /** The competition it is in (#2153); a template's slots all sit in one. */
  sportLeagueCompetitionId: string;
  /** That competition's code (REGULAR, CFP); nothing parses it. */
  competitionCode: string;
  /** That competition's place in its phase, and the phase's kind: where the slot sits in play order. */
  competitionOrderIndex: number;
  phase: LeaguePhase;
  matchFormat: MatchFormat;
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

