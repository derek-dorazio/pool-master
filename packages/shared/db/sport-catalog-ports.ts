/**
 * Repository ports for the cross-sport catalog and event core (#235). Each covers its
 * entity's full operation set, including the unscoped reads a root admin needs (access
 * rule A1): the catalog is reference data, narrowed by filters, never paged (§16).
 */

import type {
  EventSeries,
  ParticipantInactiveReason,
  ParticipantLeagueAffiliation,
  Season,
  Sport,
  SportConfig,
  SportEvent,
  SportEventParticipant,
  SportEventParticipantRound,
  SportEventParticipantStanding,
  SportEventParticipantValuation,
  SportEventRound,
  SportEventStatus,
  SportEventSyncScope,
  SportEventTier,
  SportLeague,
  ValuationSource,
} from '../domain';

export interface SportRepository {
  findById(id: string): Promise<SportConfig | null>;
  findByName(name: Sport): Promise<SportConfig | null>;
  findAll(): Promise<SportConfig[]>;
}

export interface SportLeagueFilters {
  sportId?: string;
  isActive?: boolean;
}

export type SportLeagueUpdate = Partial<Pick<SportLeague, 'name' | 'matchKeyword' | 'isActive' | 'currentSeasonId'>>;

export interface SportLeagueRepository {
  findById(id: string): Promise<SportLeague | null>;
  /** Ordered by name. */
  findAll(filters: SportLeagueFilters): Promise<SportLeague[]>;
  findBySportAndName(sportId: string, name: string): Promise<SportLeague | null>;
  create(input: Pick<SportLeague, 'sportId' | 'name' | 'matchKeyword'>): Promise<SportLeague>;
  update(id: string, updates: SportLeagueUpdate): Promise<SportLeague>;
}

export interface SeasonFilters {
  sportId?: string;
  sportLeagueId?: string;
  isActive?: boolean;
}

export type SeasonUpdate = Partial<Pick<Season, 'name' | 'startDate' | 'endDate' | 'isActive'>>;

export interface SeasonRepository {
  findById(id: string): Promise<Season | null>;
  /** Ordered by sport league, then most recent year first. */
  findAll(filters: SeasonFilters): Promise<Season[]>;
  findBySportLeagueAndYear(sportLeagueId: string, year: number): Promise<Season | null>;
  create(input: Pick<Season, 'sportLeagueId' | 'name' | 'year' | 'startDate' | 'endDate'>): Promise<Season>;
  update(id: string, updates: SeasonUpdate): Promise<Season>;
  /** Seasons per sport league, for each id asked about (0 where none). */
  countBySportLeagues(sportLeagueIds: readonly string[]): Promise<Map<string, number>>;
}

export interface ParticipantRanking {
  participantId: string;
  ranking: number | null;
}

export interface ParticipantLeagueAffiliationRepository {
  /** Best rank first, unranked last, then by participant name. */
  findBySportLeague(sportLeagueId: string): Promise<ParticipantLeagueAffiliation[]>;
  find(sportLeagueId: string, participantId: string): Promise<ParticipantLeagueAffiliation | null>;
  create(sportLeagueId: string, participantId: string): Promise<ParticipantLeagueAffiliation>;
  delete(sportLeagueId: string, participantId: string): Promise<void>;
  /** Re-ranks existing affiliations, all or none. */
  updateRankings(sportLeagueId: string, rankings: readonly ParticipantRanking[]): Promise<void>;
  /** Creates missing affiliations and re-ranks existing ones, all or none. */
  upsertRankings(sportLeagueId: string, rankings: readonly ParticipantRanking[]): Promise<void>;
  /** Affiliations per sport league, for each id asked about (0 where none). */
  countBySportLeagues(sportLeagueIds: readonly string[]): Promise<Map<string, number>>;
}

export interface SportEventFilters {
  sport?: Sport;
  status?: SportEventStatus;
  seasonId?: string;
  /** Case-insensitive substring of the event name. */
  q?: string;
}

export type SportEventCreate = Omit<SportEvent, 'id' | 'createdAt' | 'updatedAt' | 'fieldLocked' | 'metadata' | 'participantCount'>;

/** undefined leaves a field alone; null clears a nullable one. */
export interface SportEventUpdate {
  name?: string;
  venue?: string | null;
  location?: string | null;
  startDate?: Date;
  endDate?: Date | null;
  rounds?: number | null;
  releaseAt?: Date;
  fieldLocksAt?: Date;
  autoLifecycleEnabled?: boolean;
  status?: SportEventStatus;
  providerId?: string;
  externalId?: string;
  syncScope?: SportEventSyncScope;
}

export interface SportEventProviderSummary {
  activeEventCount: number;
  lastChangedAt: Date | null;
}

export interface SportEventFieldRecordCounts {
  valuations: number;
  rounds: number;
  picks: number;
}

export interface SportEventRepository {
  findById(id: string): Promise<SportEvent | null>;
  /** The event a provider knows by this identity, if one is linked to it. */
  findByProviderRef(providerId: string, externalId: string): Promise<SportEvent | null>;
  /** Ordered by start date, then name. */
  findAll(filters: SportEventFilters): Promise<SportEvent[]>;
  create(input: SportEventCreate): Promise<SportEvent>;
  update(id: string, updates: SportEventUpdate): Promise<SportEvent>;
  /** Deletes the event with its rounds, tiers and field. Refuses nothing: the caller guards contests. */
  delete(id: string): Promise<void>;
  /** Event participants per event, for each id asked about (0 where none). */
  countParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>>;
  /** Tiers per event, for each id asked about (0 where none). */
  countTiers(sportEventIds: readonly string[]): Promise<Map<string, number>>;
  /** Contests run on each event, for each id asked about (0 where none). */
  countContests(sportEventIds: readonly string[]): Promise<Map<string, number>>;
  /** Events per season, for each id asked about (0 where none). */
  countBySeasons(seasonIds: readonly string[]): Promise<Map<string, number>>;
  /**
   * Per provider asked about: its `SCHEDULED` or `IN_PROGRESS` events, and when any of its
   * events last changed (null where it has none).
   */
  summarizeByProviders(providerIds: readonly string[]): Promise<Map<string, SportEventProviderSummary>>;
  /**
   * The field records each event holds beyond its participants, for each id asked about
   * (zeros where none): valuations, per-round rows, and contest picks on its participants.
   */
  countFieldRecords(sportEventIds: readonly string[]): Promise<Map<string, SportEventFieldRecordCounts>>;
  /**
   * The events the lifecycle scheduler may move on: auto lifecycle on, not provider-owned
   * (`syncScope` other than `FULL`), and `SCHEDULED` or `IN_PROGRESS`. Unordered.
   */
  findAutoLifecycleCandidates(): Promise<SportEvent[]>;
}

export interface EventSeriesRepository {
  /** The sport league's recurring event of this name, created on first use. */
  findOrCreate(sportLeagueId: string, name: string): Promise<EventSeries>;
}

export interface SportEventRoundSchedule {
  roundNumber: number;
  scheduledDate: Date;
  scheduledEndAt?: Date | null;
}

export interface SportEventRoundRepository {
  /** Ordered by round number. */
  findBySportEvent(sportEventId: string): Promise<SportEventRound[]>;
  /** Each asked-about event's rounds, ordered by round number (an empty list where none). */
  findBySportEvents(sportEventIds: readonly string[]): Promise<Map<string, SportEventRound[]>>;
  /** Creates the given rounds, all or none. */
  createMany(sportEventId: string, rounds: readonly SportEventRoundSchedule[]): Promise<void>;
  /** Reschedules existing rounds, all or none. `scheduledEndAt` left undefined is kept. */
  reschedule(sportEventId: string, rounds: readonly SportEventRoundSchedule[]): Promise<void>;
  /** The event's round of this number, created (scheduled now) when a score arrives for a round it lacks. */
  findOrCreate(sportEventId: string, roundNumber: number): Promise<SportEventRound>;
}

/** undefined leaves a field alone; null clears it. */
export interface SportEventParticipantPatch {
  isActive?: boolean;
  inactiveReason?: ParticipantInactiveReason | null;
  ranking?: number | null;
  oddsToWin?: number | null;
  seedNumber?: number | null;
}

export type SportEventParticipantCreate = SportEventParticipantPatch & { participantId: string };

export interface SportEventParticipantFieldUpdate {
  id: string;
  updates: SportEventParticipantPatch;
  /** A manually set price, or null to clear it; undefined leaves the valuation alone. */
  price?: number | null;
}

export interface SportEventParticipantRepository {
  findById(id: string): Promise<SportEventParticipant | null>;
  /** Ordered by seed, unseeded last. */
  findBySportEvent(sportEventId: string): Promise<SportEventParticipant[]>;
  create(
    participant: Omit<SportEventParticipant, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SportEventParticipant>;
  update(
    id: string,
    updates: Partial<SportEventParticipant>,
  ): Promise<SportEventParticipant>;
  /** Adds participants to an event's field, all or none. */
  createMany(sportEventId: string, rows: readonly SportEventParticipantCreate[]): Promise<void>;
  /** Adds or refreshes participants on an event's field by participant, all or none. */
  upsertMany(sportEventId: string, rows: readonly SportEventParticipantCreate[]): Promise<void>;
  /** Patches field rows and their manual prices, all or none. */
  updateMany(entries: readonly SportEventParticipantFieldUpdate[]): Promise<void>;
  /** Removes a field row with its valuation, standing and rounds. The caller guards picks. */
  delete(id: string): Promise<void>;
  /** Contest-entry picks made of this field row. */
  countPicks(id: string): Promise<number>;
}

export interface SportEventTierRepository {
  /** Ordered by tier number. */
  findBySportEvent(sportEventId: string): Promise<SportEventTier[]>;
  createMany(sportEventId: string, tiers: readonly SportEventTierDefinition[]): Promise<void>;
  /**
   * Replaces an event's tiers with `tiers`, keyed by tierKey, all or none. Valuations on a
   * removed tier move to `reassignTo` (a tierKey in `tiers`) with no order, or lose their
   * tier when none is given.
   */
  replace(sportEventId: string, tiers: readonly SportEventTierDefinition[], reassignTo?: string): Promise<void>;
  /** Valuations placed in each of the event's tiers (0 where none). */
  countValuations(sportEventId: string): Promise<Map<string, number>>;
}

export type SportEventTierDefinition = Pick<SportEventTier, 'tierKey' | 'label' | 'tierNumber' | 'defaultPickCount'>;

export interface TierAssignment {
  sportEventParticipantId: string;
  sportEventTierId: string;
  tierOrderIndex: number;
  source: ValuationSource;
}

export interface PriceAssignment {
  sportEventParticipantId: string;
  price: number;
  source: ValuationSource;
}

export interface SportEventParticipantValuationRepository {
  /** Every valuation on the event's field, with or without a tier. */
  findBySportEvent(sportEventId: string): Promise<SportEventParticipantValuation[]>;
  /** Places field rows in tiers, all or none. Prices are untouched. */
  assignTiers(assignments: readonly TierAssignment[]): Promise<void>;
  /** Prices field rows, all or none. Tiers are untouched. */
  assignPrices(assignments: readonly PriceAssignment[]): Promise<void>;
}

export interface SportEventParticipantRoundRepository {
  /** Every participant's rounds at the event, by participant then round number. */
  findBySportEvent(sportEventId: string): Promise<SportEventParticipantRound[]>;
  /** Ordered by round number. */
  findBySportEventParticipant(sportEventParticipantId: string): Promise<SportEventParticipantRound[]>;
  findBySportEventRound(sportEventRoundId: string): Promise<SportEventParticipantRound[]>;
}

export interface SportEventParticipantStandingRepository {
  /** Best position first, unranked last. Position is direction-free: 1 is best in every sport. */
  findBySportEvent(sportEventId: string): Promise<SportEventParticipantStanding[]>;
  findBySportEventParticipant(sportEventParticipantId: string): Promise<SportEventParticipantStanding | null>;
}

/** Candidate participants for an upload row, within one sport. Exact match on each identifier given. */
export interface ParticipantMatchQuery {
  id?: string;
  externalId?: string;
  /** Case-insensitive exact name. */
  name?: string;
}

