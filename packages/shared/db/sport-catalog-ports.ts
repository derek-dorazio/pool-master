/**
 * Repository ports for the cross-sport catalog and event core (#235). Each covers its
 * entity's full operation set, including the unscoped reads a root admin needs (access
 * rule A1): the catalog is reference data, narrowed by filters, never paged (§16).
 */

import type {
  BackgroundJobRequest,
  EventPricingConfig,
  EventSeries,
  MatchSide,
  ParticipantInactiveReason,
  Participant,
  ParticipantLeagueAffiliation,
  Sport,
  SportConfig,
  SportEvent,
  SportEventMatch,
  SportEventParticipant,
  SportEventParticipantGolfRound,
  SportEventParticipantGolfStanding,
  SportEventParticipantRaceResult,
  SportEventParticipantRound,
  SportEventParticipantStanding,
  SportEventParticipantStatLine,
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
  findBySport(sport: Sport): Promise<SportConfig | null>;
  findAll(): Promise<SportConfig[]>;
}

export interface SportLeagueFilters {
  sportId?: string;
  isActive?: boolean;
}

export type SportLeagueUpdate = Partial<Pick<SportLeague, 'name' | 'matchKeyword' | 'isActive' | 'currentEventYear' | 'bracketAdvancement'>>;

/**
 * What still uses a sport league, each a reason it cannot be deleted (#1400). Its affiliations
 * and its series with no events are its own and go with it, so they are not counted.
 */
export interface SportLeagueUses {
  /** Events across every series of the sport league, every year. */
  sportEventCount: number;
  /** Contest setups offered for its events. */
  contestTemplateCount: number;
  /** Event page offers on its series. */
  eventPageOfferCount: number;
  /** Leagues' season cups for it. */
  cupCount: number;
  /** Playoff round sport leagues that name it as their season league (#1701). */
  roundCount: number;
}

export interface SportLeagueRepository {
  findById(id: string): Promise<SportLeague | null>;
  /** The sports leagues with these ids that exist. */
  findByIds(ids: readonly string[]): Promise<SportLeague[]>;
  /** Ordered by name. */
  findAll(filters: SportLeagueFilters): Promise<SportLeague[]>;
  findBySportAndName(sportId: string, name: string): Promise<SportLeague | null>;
  create(input: Pick<SportLeague, 'sportId' | 'name' | 'matchKeyword' | 'bracketAdvancement'>): Promise<SportLeague>;
  update(id: string, updates: SportLeagueUpdate): Promise<SportLeague>;
  /**
   * Deletes the sport league unless something still uses it (#1400), in one transaction that locks
   * it and its series first, so nothing can start using it between the count and the delete. Its
   * affiliations and its series go with it, and every league that muted its event emails forgets
   * it. Returns what uses it, counted under the lock: all zero means it was deleted. Null when no
   * such sport league exists.
   */
  deleteUnlessUsed(id: string): Promise<SportLeagueUses | null>;
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
  /** Only events in one of these statuses. */
  statuses?: readonly SportEventStatus[];
  /** Only events whose series belongs to this sport league. */
  sportLeagueId?: string;
  eventYear?: number;
  /** Case-insensitive substring of the event name. */
  q?: string;
  /** Leave out DRAFT events: what a non-admin may see (#431). */
  releasedOnly?: boolean;
  /** Only events starting at or after this moment. */
  startsFrom?: Date;
  /** Only events starting before this moment. */
  startsBefore?: Date;
}

/** The sport league comes from the series, so it is not supplied. */
export type SportEventCreate = Omit<SportEvent, 'id' | 'createdAt' | 'updatedAt' | 'metadata' | 'participantCount' | 'sportLeagueId' | 'pricingConfig'>;

/** undefined leaves a field alone; null clears a nullable one. */
export interface SportEventUpdate {
  name?: string;
  venue?: string | null;
  location?: string | null;
  startDate?: Date;
  endDate?: Date | null;
  rounds?: number | null;
  roundsPar?: number | null;
  autoLifecycleEnabled?: boolean;
  status?: SportEventStatus;
  providerId?: string;
  externalId?: string;
  syncScope?: SportEventSyncScope;
}

export interface SportEventStatusTransition {
  from: SportEvent['status'];
  to: SportEvent['status'];
  /** Written with the status, for an event that completes without an end date of its own. */
  endDate?: Date;
  /**
   * Written in the same transaction as the status, and only when the status moves, such as the
   * job that settles the event's contests (#1448): a move that rolls back queues nothing.
   */
  jobs?: readonly BackgroundJobRequest[];
}

export interface SportEventProviderSummary {
  activeEventCount: number;
  lastChangedAt: Date | null;
}

/**
 * Which of a provider's events a notification from it is about (#1498): the one it knows by
 * `externalId`, or every one whose id starts with `externalIdPrefix` (a league's scopes, such
 * as `nfl-`). `gameId` names the provider game the notification is about, when it is a game's.
 * `startedBy` is set for a notification that play has started (#1499): it also finds the events
 * still `SCHEDULED` that started by then, which the lifecycle sweep has yet to move.
 */
export type ProviderNotifiedEventQuery = {
  providerId: string;
  sport: Sport;
  gameId?: string;
  startedBy?: Date;
} & ({ externalId: string } | { externalIdPrefix: string });

/** A provider-linked event a notification may sync, and whether it holds the notified game. */
export interface ProviderNotifiedEvent {
  sport: Sport;
  providerId: string;
  externalId: string;
  /** Whether one of its matches is linked to the query's `gameId`; false with no `gameId`. */
  holdsGame: boolean;
  /** Whether the event is `IN_PROGRESS`; false for one still `SCHEDULED` past its start. */
  inProgress: boolean;
}

/** A provider's notification about some of its events, recorded when it arrived (#1499). */
export interface ProviderNotificationReceipt {
  providerId: string;
  externalIds: readonly string[];
  receivedAt: Date;
}

export interface SportEventRepository {
  findById(id: string): Promise<SportEvent | null>;
  /** The events with these ids, in no particular order; an unknown id is left out. */
  findByIds(ids: readonly string[]): Promise<SportEvent[]>;
  /** The event a provider knows by this identity, if one is linked to it. */
  findByProviderRef(providerId: string, externalId: string): Promise<SportEvent | null>;
  /** The events a provider knows by any of these identities, in one read (#1253). */
  findByProviderRefs(providerId: string, externalIds: readonly string[]): Promise<SportEvent[]>;
  /** Ordered by start date, then name. */
  findAll(filters: SportEventFilters): Promise<SportEvent[]>;
  /**
   * The event years the sport league has events in, through their series, earliest first.
   * `releasedOnly` leaves out years whose only events are DRAFT (#431).
   */
  findEventYears(sportLeagueId: string, options: { releasedOnly: boolean }): Promise<number[]>;
  /**
   * Creates the events in one insert, all or none, answering them in the order given (#1253).
   * Rejects a second edition of a series in one year: the database's unique constraint on
   * (eventSeriesId, eventYear) raises, and the caller maps it (plans/147 decision 5).
   */
  createMany(inputs: readonly SportEventCreate[]): Promise<SportEvent[]>;
  /**
   * `jobs`, when given, are written in the same transaction as the edit, such as a moved start's
   * "event changed" email jobs (#1464): an edit that fails queues nothing.
   */
  update(id: string, updates: SportEventUpdate, options?: { jobs?: readonly BackgroundJobRequest[] }): Promise<SportEvent>;
  /**
   * Moves the event to `to`, but only while it is still in `from`: a guarded single write, so of
   * two callers making the same change at once exactly one wins (#1159). Returns the event as
   * written, or null when its status had already moved on and nothing was written.
   */
  transitionStatus(id: string, transition: SportEventStatusTransition): Promise<SportEvent | null>;
  /** Deletes the event with its rounds, tiers and field. Refuses nothing: the caller guards contests. */
  delete(id: string): Promise<void>;
  /** Event participants per event, for each id asked about (0 where none). */
  countParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>>;
  /**
   * Active event participants with no tier, per event, for each id asked about (0 where none).
   * An event can't be released while any remain (#431).
   */
  countUntieredActiveParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>>;
  /**
   * Active event participants with no price, per event, for each id asked about (0 where none).
   * An event can't be released while any remain (#93).
   */
  countUnpricedActiveParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>>;
  /** Tiers per event, for each id asked about (0 where none). */
  countTiers(sportEventIds: readonly string[]): Promise<Map<string, number>>;
  /**
   * The labels of the tiers no active participant is in, per event, in tier order, for each id
   * asked about (empty where none). An event can't be released while any remain: no entry could
   * pick from them.
   */
  findEmptyTierLabels(sportEventIds: readonly string[]): Promise<Map<string, string[]>>;
  /** Contests run on each event, for each id asked about (0 where none). */
  countContests(sportEventIds: readonly string[]): Promise<Map<string, number>>;
  /** Events per sport league, through their series, for each id asked about (0 where none). */
  countBySportLeagues(sportLeagueIds: readonly string[], filters?: { eventYear?: number }): Promise<Map<string, number>>;
  /**
   * Whether any event of the sport league, through its series and in any year, has a bracket
   * loaded: at least one match. While one has, the league's bracket rule cannot change (#730).
   */
  sportLeagueHasLoadedBracket(sportLeagueId: string): Promise<boolean>;
  /**
   * Per provider asked about: its `SCHEDULED` or `IN_PROGRESS` events, and when any of its
   * events last changed (null where it has none).
   */
  summarizeByProviders(providerIds: readonly string[]): Promise<Map<string, SportEventProviderSummary>>;
  /**
   * The provider's events a notification from it may sync (#1498): linked for scores
   * (`SCORES_ONLY`) and `IN_PROGRESS`, as the scheduled live-score sweep reads them, and with
   * `startedBy`, also `SCHEDULED` with auto lifecycle on and a start by then. Unordered.
   */
  findLiveNotifiedEvents(query: ProviderNotifiedEventQuery): Promise<ProviderNotifiedEvent[]>;
  /** Sets when the provider last sent a notification about each of these events (#1499). */
  recordProviderNotification(receipt: ProviderNotificationReceipt): Promise<void>;
  /**
   * The events the lifecycle scheduler may move on: auto lifecycle on, and `SCHEDULED` or
   * `IN_PROGRESS`. Unordered.
   */
  findAutoLifecycleCandidates(): Promise<SportEvent[]>;
}

export interface EventSeriesRepository {
  /** The sport league's series of these names, each created on first use, in two queries (#1253). */
  findOrCreateMany(sportLeagueId: string, names: readonly string[]): Promise<EventSeries[]>;
}

export interface SportEventRoundSchedule {
  roundNumber: number;
  scheduledDate: Date;
  scheduledEndAt?: Date | null;
}

/** A round to create, on its event. */
export type SportEventRoundCreate = SportEventRoundSchedule & { sportEventId: string };

export interface SportEventRoundRepository {
  /** Ordered by round number. */
  findBySportEvent(sportEventId: string): Promise<SportEventRound[]>;
  /** Each asked-about event's rounds, ordered by round number (an empty list where none). */
  findBySportEvents(sportEventIds: readonly string[]): Promise<Map<string, SportEventRound[]>>;
  /** Creates the given rounds, of one event or several, in one insert (#1253). */
  createMany(rounds: readonly SportEventRoundCreate[]): Promise<void>;
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
  isPlayInPlace?: boolean;
}

export type SportEventParticipantCreate = SportEventParticipantPatch & { participantId: string };

export interface SportEventParticipantFieldUpdate {
  id: string;
  updates: SportEventParticipantPatch;
  /** A manually set price, or null to clear it; undefined leaves the valuation alone. */
  price?: number | null;
}

/** A round row with its sport extension, when the sport has one and it has been scored. */
export interface ParticipantRoundView {
  round: SportEventParticipantRound;
  golf: SportEventParticipantGolfRound | null;
  /** The composite family's extension (#934): a stat pool player's stats in the game, empty for any other family. */
  statLines: SportEventParticipantStatLine[];
}

/** A standing row with its sport extension. */
export interface ParticipantStandingView {
  standing: SportEventParticipantStanding;
  golf: SportEventParticipantGolfStanding | null;
}

/** One field row, as every reader of an event's participants sees it (#236). */
export interface SportEventParticipantView {
  entry: SportEventParticipant;
  participant: Participant;
  valuation: SportEventParticipantValuation | null;
  standing: ParticipantStandingView | null;
  /** In round number order. */
  rounds: ParticipantRoundView[];
  /** The finish-position extension: how the runner's race ended, once a result is entered. */
  raceResult: SportEventParticipantRaceResult | null;
  /** The bracket matches naming this row on either side, in match order: head to head scores from them (#699). */
  matches: SportEventMatch[];
  /** Whether the participant is affiliated with the event's sport league — false flags an invite from elsewhere. */
  affiliatedWithSportLeague: boolean;
}

export interface SportEventParticipantRepository {
  findById(id: string): Promise<SportEventParticipant | null>;
  /** The rows with these ids, in no set order; an id with no row is left out (#1201). */
  findByIds(ids: readonly string[]): Promise<SportEventParticipant[]>;
  /** Ordered by seed, unseeded last. */
  findBySportEvent(sportEventId: string): Promise<SportEventParticipant[]>;
  /** Several events' fields in one read (#1201), each event's ordered by seed, unseeded last. */
  findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventParticipant[]>;
  /**
   * The event's field as every reader sees it, in one read (#1163): each row with its
   * participant, valuation, standing, rounds, race result and matches, in seed order, unseeded
   * last. Every scoring family's rows come along; a family's empty ones cost nothing.
   * `sportLeagueId` is the event's, against which each participant's affiliation is flagged.
   */
  findFieldForEvent(sportEventId: string, sportLeagueId: string): Promise<SportEventParticipantView[]>;
  /**
   * `findFieldForEvent` for several events in the same few statements (#1315), each event's
   * affiliations flagged against its own sport league: in the order of `events`, then in seed order.
   */
  findFieldsForEvents(events: readonly { sportEventId: string; sportLeagueId: string }[]): Promise<SportEventParticipantView[]>;
  /** One field row of the event, read as `findFieldForEvent` reads each, or null when the event has no such row. */
  findFieldRow(sportEventId: string, sportEventParticipantId: string, sportLeagueId: string): Promise<SportEventParticipantView | null>;
  /** How many different participants the events' fields hold between them: a season's teams (#836). */
  countDistinctParticipants(sportEventIds: readonly string[]): Promise<number>;
  /**
   * Adds participants to an event's field, all or none. Each of these field writes takes the
   * background jobs it causes (the event's leaderboard rebuild, #1466) and writes them with it.
   */
  createMany(sportEventId: string, rows: readonly SportEventParticipantCreate[], jobs?: readonly BackgroundJobRequest[]): Promise<void>;
  /** Patches field rows and their manual prices, all or none. */
  updateMany(entries: readonly SportEventParticipantFieldUpdate[], jobs?: readonly BackgroundJobRequest[]): Promise<void>;
  /** Removes a field row with its valuation, standing and rounds. The caller guards picks. */
  delete(id: string, jobs?: readonly BackgroundJobRequest[]): Promise<void>;
  /** Contest-entry picks made of this field row. */
  countPicks(id: string): Promise<number>;
  /**
   * Points a play-in slot's field row at the team that won the play-in and inactivates the
   * participant that stood for the pairing, in one transaction (#698). The row keeps its seed,
   * tier, price and picks, and is no longer a play-in place (#709). `jobs` are written with it.
   */
  fillPlayInSlot(input: { id: string; winnerParticipantId: string; pairingParticipantId: string }, jobs?: readonly BackgroundJobRequest[]): Promise<void>;
  /**
   * Replaces a withdrawn field row in its bracket place, in one transaction (#704): adds the
   * replacement's field row (unseeded) with `valuation`, names it on the match's side, and
   * inactivates the withdrawn row as WITHDRAWN, with `jobs`. Returns the replacement's field row id.
   */
  replaceWithdrawn(input: {
    withdrawnId: string;
    matchId: string;
    side: MatchSide;
    replacementParticipantId: string;
    valuation: ReplacementValuation | null;
  }, jobs?: readonly BackgroundJobRequest[]): Promise<string>;
}

/** A replacement's tier, its place in the tier and its price; each null where the event has none. */
export interface ReplacementValuation {
  sportEventTierId: string | null;
  tierOrderIndex: number | null;
  price: number | null;
}

export interface SportEventTierRepository {
  /** Ordered by tier number. */
  findBySportEvent(sportEventId: string): Promise<SportEventTier[]>;
  /** Several events' tiers in one read (#1201), each event's ordered by tier number. */
  findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventTier[]>;
  /** Creates the given tiers, of one event or several, in one insert (#1253). */
  createMany(tiers: readonly SportEventTierCreate[]): Promise<void>;
  /**
   * Replaces an event's tiers with `tiers`, keyed by tierKey, all or none. Valuations on a
   * removed tier move to `reassignTo` (a tierKey in `tiers`) with no order, or lose their
   * tier when none is given.
   */
  replace(sportEventId: string, tiers: readonly SportEventTierDefinition[], reassignTo?: string): Promise<void>;
  /** Valuations placed in each of the event's tiers; a tier with none is left out. */
  countValuations(sportEventId: string): Promise<Map<string, number>>;
}

export type SportEventTierDefinition = Pick<SportEventTier, 'tierKey' | 'label' | 'tierNumber'>;

/** A tier to create, on its event. */
export type SportEventTierCreate = SportEventTierDefinition & { sportEventId: string };

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
  /** Every valuation on several events' fields in one read (#1201). */
  findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventParticipantValuation[]>;
  /** Places field rows in tiers, all or none. Prices are untouched. */
  assignTiers(assignments: readonly TierAssignment[]): Promise<void>;
  /**
   * Prices field rows and records on the event the values they were priced with, all or none
   * (#93). Tiers are untouched.
   */
  assignEventPrices(input: {
    sportEventId: string;
    pricingConfig: EventPricingConfig;
    assignments: readonly PriceAssignment[];
  }): Promise<void>;
}

/** Candidate participants for an upload row, within one sport. Exact match on each identifier given. */
export interface ParticipantMatchQuery {
  id?: string;
  externalId?: string;
  /** Case-insensitive exact name. */
  name?: string;
}

