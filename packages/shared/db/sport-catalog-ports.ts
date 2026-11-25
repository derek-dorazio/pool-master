/**
 * Repository ports for the cross-sport catalog and event core (#235). Each covers its
 * entity's full operation set, including the unscoped reads a root admin needs (access
 * rule A1): the catalog is reference data, narrowed by filters, never paged (§16).
 */

import type { ProviderSyncFindingOpenCount } from './provider-sync-finding-ports';
import type {
  AutoReleaseCheck,
  BackgroundJobRequest,
  EventPricingConfig,
  EventSeries,
  EventTierConfig,
  PlatformPricingProfile,
  ProviderEventRef,
  OverdueEventFacts,
  ParticipantInactiveReason,
  Participant,
  ParticipantType,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  ReleaseCheckKey,
  RoundResultFacts,
  Sport,
  SportConfig,
  SportEvent,
  SportEventContest,
  SportLeagueSeasonSpan,
  SportEventRoundMatch,
  SportEventParticipant,
  SportEventParticipantGolfRound,
  SportEventParticipantGolfStanding,
  SportEventParticipantRaceResult,
  SportEventParticipantRound,
  SportEventParticipantStanding,
  SportEventParticipantValuation,
  SportEventRound,
  SportEventStatus,
  SportEventTier,
  SportLeague,
  SportLeaguePosition,
  TierLayoutValues,
  PlatformTierProfile,
  ValuationSource,
  SportLeaguePhaseDefinition,
  SeasonSpan,
  SportLeagueSeason,
  SportLeagueSeasonDetail,
  SportLeagueSeasonSlot,
  CurrentSeasonCandidate,
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

export type SportLeagueUpdate = Partial<Pick<SportLeague, 'name' | 'isActive' | 'bracketAdvancement' | 'autoReleaseDaysBeforeStart' | 'platformTierProfileId' | 'platformPricingProfileId'>> & {
  /**
   * The provider league whose sync the sport league takes (#1997): its mapping to it is made when
   * missing and selected, in the same write. Null stops the sync and keeps the mapping.
   */
  syncProviderLeagueId?: string | null;
};

/**
 * What still uses a sport league, each a reason it cannot be deleted (#1400). Its series with
 * no events are its own and go with it, so they are not counted; its participants are (#1853).
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
  /** Its participants (#1853): each belongs to it alone, so they go first. */
  participantCount: number;
}

export interface SportLeagueRepository {
  findById(id: string): Promise<SportLeague | null>;
  /** The sports leagues with these ids that exist. */
  findByIds(ids: readonly string[]): Promise<SportLeague[]>;
  /** Ordered by name. */
  findAll(filters: SportLeagueFilters): Promise<SportLeague[]>;
  findBySportAndName(sportId: string, name: string): Promise<SportLeague | null>;
  /** The sport's league at this URL segment (#2042), or null when none has it. */
  findBySportAndUrlSegment(sportId: string, urlSegment: string): Promise<SportLeague | null>;
  /** The active sport leagues whose events a provider's sync creates (ADR 0011, #1725), by name. */
  findEventSynced(): Promise<SportLeague[]>;
  /**
   * The league and its first Season, made its current one, in one transaction (#2003). The Season
   * is a stopgap for the browser journeys' own leagues until they move to test slots (#2004).
   */
  create(
    input: Pick<SportLeague, 'sportId' | 'name' | 'urlSegment' | 'participantType' | 'scoringFamily' | 'bracketAdvancement' | 'platformTierProfileId' | 'platformPricingProfileId' | 'timeZone'>,
    firstSeason: SportLeagueSeasonSpan,
  ): Promise<SportLeague>;
  update(id: string, updates: SportLeagueUpdate): Promise<SportLeague>;
  /**
   * Deletes the sport league unless something still uses it (#1400), in one transaction that locks
   * it and its series first, so nothing can start using it between the count and the delete. Its
   * series go with it, and every league that muted its event emails forgets
   * it. Returns what uses it, counted under the lock: all zero means it was deleted. Null when no
   * such sport league exists.
   */
  deleteUnlessUsed(id: string): Promise<SportLeagueUses | null>;
}

export interface ParticipantRanking {
  participantId: string;
  ranking: number | null;
}

export interface SportEventFilters {
  sport?: Sport;
  /** Only events in one of these statuses. */
  statuses?: readonly SportEventStatus[];
  /** Only events whose series belongs to this sport league. */
  sportLeagueId?: string;
  /** Only events of this Season (#2003). */
  sportLeagueSeasonId?: string;
  /** Only editions of this event series. */
  eventSeriesId?: string;
  /** Case-insensitive substring of the event name. */
  q?: string;
  /** Leave out DRAFT events: what a non-admin may see (#431). */
  releasedOnly?: boolean;
  /**
   * Leave out events of an inactive sport league (#1812): what a member may start a contest on.
   * A switched-off league's season is still read by its sport league id for contests already made.
   */
  activeSportLeaguesOnly?: boolean;
  /** Only events starting at or after this moment. */
  startsFrom?: Date;
  /** Only events starting before this moment. */
  startsBefore?: Date;
}

/**
 * The sport league comes from the series, so it is not supplied. `providerRef` is the provider's id
 * for an event the sync creates (#2004): it is kept under its Season's league's selected provider
 * mapping, which must be that provider's. A test event has none.
 */
export type SportEventCreate = Omit<SportEvent, 'id' | 'sport' | 'sportUrlSegment' | 'createdAt' | 'updatedAt' | 'participantCount' | 'sportLeagueId' | 'championshipYear' | 'participantType' | 'scoringFamily' | 'pricingConfig' | 'tierConfig' | 'providerMappings'> & {
  providerRef?: ProviderEventRef;
  /** The Season slots it covers (#2004), in its own Season: a test event's test slot. */
  seasonSlotIds?: readonly string[];
};

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
}

export interface SportEventStatusTransition {
  from: SportEvent['status'];
  to: SportEvent['status'];
  /** Written with the status, for an event that completes without an end date of its own. */
  endDate?: Date;
  /** Written with a release, DRAFT to SCHEDULED (#1865): when the event was released. */
  releasedAt?: Date;
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
 * `externalId`, or every event it has an id for in the provider league `providerLeagueCode` names
 * (`nfl`), found through the events' provider mappings (#2004). `gameId` names the provider game the notification is about, when it is a game's.
 * `startedBy` is set for a notification that play has started (#1499): it also finds the events
 * still `SCHEDULED` that started by then, which the lifecycle sweep has yet to move.
 */
export type ProviderNotifiedEventQuery = {
  providerId: string;
  sport: Sport;
  gameId?: string;
  startedBy?: Date;
} & ({ externalId: string } | { providerLeagueCode: string });

/** A provider-linked event a notification may sync, and whether it holds the notified game. */
export interface ProviderNotifiedEvent {
  /** PoolMaster's own id for the event (#1819). */
  sportEventId: string;
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

/** The counts a release's ready checks read of one event besides its admin counts (#1823). */
export interface SportEventReleaseFacts {
  scheduledRoundCount: number;
  contestSetupCount: number;
}

/** A DRAFT event the automatic release sweep may try (#1823). */
export interface SportEventAutoReleaseCandidate {
  id: string;
  startDate: Date;
  syncProviderId: string;
  autoReleaseDaysBeforeStart: number;
}

/**
 * An event's identity and what names it, read without the rest of the row: `providerId` is the
 * adapter id of its league's sync provider when that provider has an id for it, else null (#2004).
 */
export type SportEventLink = { id: string; name: string; sportLeagueId: string; providerId: string | null };

export interface SportEventRepository {
  findById(id: string): Promise<SportEvent | null>;
  /** The events with these ids, in no particular order; an unknown id is left out. */
  findByIds(ids: readonly string[]): Promise<SportEvent[]>;
  /** The events with these ids, id, name, sport league and provider only, in one read; an unknown id is left out. */
  findLinks(ids: readonly string[]): Promise<SportEventLink[]>;
  /** The event a provider knows by this identity, if one is linked to it. */
  findByProviderRef(providerId: string, externalId: string): Promise<SportEvent | null>;
  /** The events a provider knows by any of these identities, in one read (#1253). */
  findByProviderRefs(providerId: string, externalIds: readonly string[]): Promise<SportEvent[]>;
  /** Ordered by start date, then name. */
  findAll(filters: SportEventFilters): Promise<SportEvent[]>;
  /**
   * Creates the events in one insert, all or none, answering them in the order given (#1253).
   * Rejects a second edition of a series in one Season: the database's unique constraint on
   * (eventSeriesId, sportLeagueSeasonId) raises, and the caller maps it (plans/147 decision 5).
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
   * An event can't be released while any remain (#431). One auto-tiering placed beyond a capped
   * last tier (no tier, but a tier source) is not counted: the league's layout leaves it out (#1844).
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
   * The Season slots each event covers (#2004), in play order, for each id asked about (empty
   * where none), in a fixed number of reads however many events.
   */
  findSlots(sportEventIds: readonly string[]): Promise<Map<string, SportLeagueSeasonSlot[]>>;
  /**
   * The labels of the tiers no active participant is in, per event, in tier order, for each id
   * asked about (empty where none). An event can't be released while any remain: no entry could
   * pick from them.
   */
  findEmptyTierLabels(sportEventIds: readonly string[]): Promise<Map<string, string[]>>;
  /**
   * What only a release's ready checks read of one event (#1823), each a count: its scheduled
   * rounds, and the active contest setups its sport league offers.
   */
  findReleaseFacts(event: { id: string; sportLeagueId: string }): Promise<SportEventReleaseFacts>;
  /**
   * The automatic release sweep's candidates (#1823): DRAFT events starting after `now` and by
   * `horizon`, of an active sport league whose event sync names a provider and whose automatic
   * release is on, each with what the sweep needs to judge its own window.
   */
  findAutoReleaseCandidates(now: Date, horizon: Date): Promise<SportEventAutoReleaseCandidate[]>;
  /**
   * Stores the event's latest automatic release check (#1847) in place of the one before, or
   * clears it with null (a root admin's release by hand).
   */
  recordAutoReleaseCheck(sportEventId: string, check: AutoReleaseCheck | null): Promise<void>;
  /** The event's latest automatic release check (#1847), or null before its first. */
  findAutoReleaseCheck(sportEventId: string): Promise<AutoReleaseCheck | null>;
  /** Contests run on each event, for each id asked about (0 where none). */
  countContests(sportEventIds: readonly string[]): Promise<Map<string, number>>;
  /** Events per sport league, through their series, for each id asked about (0 where none). */
  countBySportLeagues(sportLeagueIds: readonly string[]): Promise<Map<string, number>>;
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
   * The provider's events a notification from it may sync (#1498): ones it has an id for (#2004)
   * and `IN_PROGRESS`, as the scheduled live-score sweep reads them, and with
   * `startedBy`, also `SCHEDULED` with auto lifecycle on and a start by then. Unordered.
   */
  findLiveNotifiedEvents(query: ProviderNotifiedEventQuery): Promise<ProviderNotifiedEvent[]>;
  /** Sets when the provider last sent a notification about each of these events (#1499). */
  recordProviderNotification(receipt: ProviderNotificationReceipt): Promise<void>;
  /**
   * The events the lifecycle scheduler may move on: auto lifecycle on, and `SCHEDULED`,
   * `IN_PROGRESS` or `POSTPONED`, whose contests follow its start (#1792). Unordered.
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
  /**
   * The results recorded in each of the event's rounds, by round id, grouped by status (#1889): two
   * grouped reads however many rounds and results. A round with nothing recorded is absent.
   */
  findResultFacts(sportEventId: string): Promise<Map<string, RoundResultFacts>>;
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
  /** A manual move into another tier, at this place in it; undefined leaves the tier alone. */
  tier?: { sportEventTierId: string; tierOrderIndex: number };
}

/** A round row with its sport extension, when the sport has one and it has been scored. */
export interface ParticipantRoundView {
  round: SportEventParticipantRound;
  golf: SportEventParticipantGolfRound | null;
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
  matches: SportEventRoundMatch[];
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
   * `sportLeagueId` is the event's, against which each participant's league is flagged.
   */
  findFieldForEvent(sportEventId: string, sportLeagueId: string): Promise<SportEventParticipantView[]>;
  /**
   * `findFieldForEvent` for several events in the same few statements (#1315), each event's
   * participants flagged against its own sport league: in the order of `events`, then in seed order.
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
  /** Null for a place beyond a capped last tier (#1844): ordered, but in no tier and not pickable. */
  sportEventTierId: string | null;
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
   * Auto-tiers field rows and records on the event the layout they were tiered with, all or none
   * (#1844). Prices are untouched.
   */
  assignEventTiers(input: {
    sportEventId: string;
    tierConfig: EventTierConfig;
    assignments: readonly TierAssignment[];
  }): Promise<void>;
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


// --- Sport league overview (#1847) ---------------------------------------------

/** One sport league as the overview reads it. */
export interface SportLeagueOverviewLeague {
  id: string;
  sport: Sport;
  /** Its sport's URL segment (#2042). */
  sportUrlSegment: string;
  /** Its sport's display order (#2042). */
  sportDisplayOrder: number;
  name: string;
  syncProviderId: string | null;
  /** That provider's name (#1999). */
  syncProviderName: string | null;
  isActive: boolean;
}

/** The latest finished (COMPLETED or FAILED) run of one sync kind for one sport league. */
export interface SportLeagueLatestSyncRun {
  id: string;
  sportLeagueId: string;
  kind: ProviderSyncKind;
  status: ProviderSyncRunStatus;
  createdAt: Date;
  /** The run's outcome summary as the sync history shows it; null when it has none. */
  summary: string | null;
}

/** A DRAFT event whose latest automatic release check held it. */
export interface SportLeagueHeldEvent {
  id: string;
  sportLeagueId: string;
  name: string;
  checkedAt: Date;
  failedChecks: ReleaseCheckKey[];
}


/** Everything the overview is computed from, read in a fixed number of grouped queries. */
export interface SportLeagueOverviewFacts {
  leagues: SportLeagueOverviewLeague[];
  latestSyncRuns: SportLeagueLatestSyncRun[];
  heldEvents: SportLeagueHeldEvent[];
  /** Every event, cancelled ones too, per sport league. */
  eventCounts: Map<string, number>;
  /** Each sport league's current Season's span (#2003); a league with no current Season has no entry. */
  currentSeasonSpans: Map<string, SeasonSpan>;
  /** The earliest start after `now` among each sport league's events not cancelled; absent when none. */
  nextEventStarts: Map<string, Date>;
  /** Every event that may be overdue (#1865): released, neither completed nor cancelled, started long enough ago. */
  overdueCandidates: SportLeagueOverdueCandidate[];
  /** Each sport league's OPEN sync findings, per severity (#1999); a league with none has no entry. */
  openFindings: ProviderSyncFindingOpenCount[];
}

/** An event whose results may be overdue, in its sport league (#1865). */
export type SportLeagueOverdueCandidate = OverdueEventFacts & { sportLeagueId: string };

export interface SportLeagueOverviewReader {
  /** Every sport league's facts, as of `now`. */
  readFacts(now: Date): Promise<SportLeagueOverviewFacts>;
}

// --- League page (#1865) ---------------------------------------------------------

/** The sport league a League page read is about, with what decides its syncs and releases. */
export interface SportLeaguePageLeague {
  id: string;
  sport: Sport;
  isActive: boolean;
  syncProviderId: string | null;
  autoReleaseDaysBeforeStart: number | null;
}

/** A sync run as the League page reads it. */
export interface SportLeaguePageRun {
  id: string;
  kind: ProviderSyncKind;
  status: ProviderSyncRunStatus;
  createdAt: Date;
  startedAt: Date | null;
  summary: string | null;
  changedCount: number | null;
}

/** What the Syncs card is computed from. */
export interface SportLeagueSyncFacts {
  league: SportLeaguePageLeague;
  /** The league's latest run of each kind. */
  latestRuns: SportLeaguePageRun[];
}

/** One event of the league as its Events grid reads it. */
export interface SportLeaguePageEvent {
  id: string;
  name: string;
  sportLeagueSeasonId: string;
  startDate: Date;
  endDate: Date | null;
  status: SportEventStatus;
  /** A test event, on a test slot (#2004); every other event is one the league's sync keeps. */
  isTestData: boolean;
  releasedAt: Date | null;
  lastReleaseCheck: AutoReleaseCheck | null;
}

/** What the Events grid is computed from, in a fixed number of grouped reads. */
export interface SportLeagueEventFacts {
  league: SportLeaguePageLeague;
  events: SportLeaguePageEvent[];
  /** Field rows per event; absent while none. */
  fieldSizes: Map<string, number>;
  /** Each event's latest run of each kind. */
  latestRunsByEvent: Map<string, SportLeaguePageRun[]>;
  /** The league's events that may be overdue. */
  overdueCandidates: OverdueEventFacts[];
}

/** One participant of the league with its provider mapping in the league, if any. */
export interface SportLeaguePageParticipant {
  participant: {
    id: string;
    name: string;
    participantType: ParticipantType;
    shortName: string | null;
    nationality: string | null;
    teamAffiliation: string | null;
    role: string | null;
    ranking: number | null;
    createdAt: Date;
  };
  mapping: { externalId: string; lastSeenAt: Date | null } | null;
}

/** One field row of an event as its Event page reads it (#1889). */
export interface SportEventPageFieldRow {
  id: string;
  isActive: boolean;
  oddsToWin: number | null;
  seedNumber: number | null;
  ranking: number | null;
  name: string;
  /** Its participant's latest provider mapping in the event's sport league, if any. */
  mapping: { externalId: string; lastSeenAt: Date | null } | null;
}

/** What the Event page's header and sync rows are computed from, in a fixed number of reads. */
export interface SportEventPageFacts {
  league: SportLeaguePageLeague;
  event: SportLeaguePageEvent;
  /** The event's latest run of each kind. */
  latestRuns: SportLeaguePageRun[];
  /** The event itself when it may be overdue; empty otherwise. */
  overdueCandidates: OverdueEventFacts[];
  field: SportEventPageFieldRow[];
  /**
   * The address of the active event page that offers the event's series; the first by
   * the pages' display order when more than one does. Null when none does.
   */
  eventPagePath: string | null;
}

export interface SportLeaguePageReader {
  /** Null when the league does not exist. */
  readSyncFacts(sportLeagueId: string): Promise<SportLeagueSyncFacts | null>;
  /** Null when the league does not exist. */
  readEventFacts(sportLeagueId: string, now: Date): Promise<SportLeagueEventFacts | null>;
  /** Null when the league does not exist. */
  readParticipants(sportLeagueId: string): Promise<SportLeaguePageParticipant[] | null>;
  /**
   * The league's phase and slot definitions with their provider mappings (#2002), in no order.
   * Null when the league does not exist.
   */
  readStructure(sportLeagueId: string): Promise<SportLeaguePhaseDefinition[] | null>;
  /**
   * The league's Seasons with their provider ids, phases and slots (#2003), in no order. Null when
   * the league does not exist.
   */
  readSeasons(sportLeagueId: string): Promise<SportLeagueSeasonDetail[] | null>;
  /** One event's facts (#1889). Null when the event does not exist. */
  readEventPageFacts(sportEventId: string, now: Date): Promise<SportEventPageFacts | null>;
  /** The league's positions with their provider codes, by display order (#2001). Null when the league does not exist. */
  readPositions(sportLeagueId: string): Promise<SportLeaguePosition[] | null>;
}

/** A profile write: its code, name and values. */
export type PlatformTierProfileWrite = Pick<PlatformTierProfile, 'code' | 'name'> & TierLayoutValues;
export type PlatformPricingProfileWrite = Omit<PlatformPricingProfile, 'id' | 'createdAt' | 'updatedAt'>;

/** Which of a profile's unique keys another profile of the kind already holds. */
export type ProfileTaken = 'codeTaken' | 'nameTaken';

/**
 * A profile kind's operation set (#1844): platform-level definitions each sport league names one
 * of. Reference data, a handful of rows, never paged.
 */
export interface ProfileRepository<TProfile, TWrite> {
  /** Every profile, by name. */
  findAll(): Promise<TProfile[]>;
  findById(id: string): Promise<TProfile | null>;
  /** The profile the sport league names. Null when no such sport league exists. */
  findBySportLeague(sportLeagueId: string): Promise<TProfile | null>;
  /** How many sport leagues name each profile, by profile id; a profile none names is absent. */
  countSportLeagues(): Promise<Map<string, number>>;
  /** How many sport leagues name this one profile. */
  countSportLeaguesNaming(id: string): Promise<number>;
  /**
   * The new profile, or which unique index refused it: `'codeTaken'` or `'nameTaken'` when another
   * profile of the kind has the code or the name.
   */
  create(input: TWrite): Promise<TProfile | ProfileTaken>;
  /** The replaced profile, or which unique index refused it, as for create. */
  update(id: string, input: TWrite): Promise<TProfile | ProfileTaken>;
  /**
   * Deletes the profile unless a sport league names it; the foreign key refuses a delete a league
   * named meanwhile. Returns how many sport leagues name it: zero means it was deleted. Null when no such profile
   * exists.
   */
  deleteUnlessUsed(id: string): Promise<number | null>;
}

export type PlatformTierProfileRepository = ProfileRepository<PlatformTierProfile, PlatformTierProfileWrite>;
export type PlatformPricingProfileRepository = ProfileRepository<PlatformPricingProfile, PlatformPricingProfileWrite>;

/** The customer contests on one sport event (#1889), for the root admin's Event page. */
export interface SportEventContestReader {
  /** Every contest on the event, across every league, newest first; one read however many contests and entries. */
  findContests(sportEventId: string): Promise<SportEventContest[]>;
}

// --- Seasons (#2003) -----------------------------------------------------------------

/** A Season as the events sync reads it: with the provider's id for it, or null when it has none. */
export interface SyncableSportLeagueSeason extends SportLeagueSeason {
  providerSeasonId: string | null;
}

/** One league's current Season and the Seasons the current-Season rule chooses from. */
export interface SportLeagueCurrentSeasonFacts {
  sportLeagueId: string;
  currentSeasonId: string | null;
  seasons: CurrentSeasonCandidate[];
}

export interface SportLeagueSeasonRepository {
  findById(id: string): Promise<SportLeagueSeason | null>;
  /**
   * The league's Seasons, each with its id at the given provider mapping (null where the Season
   * has none), in date order. One read.
   */
  findForSync(sportLeagueId: string, sportLeagueProviderMappingId: string): Promise<SyncableSportLeagueSeason[]>;
  /** Every league's current Season and its Seasons, in a fixed number of reads however many leagues. */
  findCurrentSeasonFacts(): Promise<SportLeagueCurrentSeasonFacts[]>;
  /** Points each league named at its new current Season, in one transaction. */
  setCurrentSeasons(changes: ReadonlyArray<{ sportLeagueId: string; currentSeasonId: string | null }>): Promise<void>;
  /** One Season slot with its Season and the event on it, or null for an unknown id (#2004). */
  findSlot(seasonSlotId: string): Promise<SeasonSlotWithEvent | null>;
  /**
   * Adds a labelled test slot of a definition to a Season (#2004), copying the definition's series
   * format and pairing, in the Season's phase for the definition's phase. Says why when it adds
   * none: the definition is not one of the league's, the Season lacks its phase, or the Season
   * already has a test slot of that label on that definition.
   */
  createTestSlot(input: TestSeasonSlotCreate): Promise<TestSlotCreateResult>;
}

/** What adding a test slot did: the slot, or why there is none. */
export type TestSlotCreateResult =
  | { outcome: 'CREATED'; slot: SportLeagueSeasonSlot }
  | { outcome: 'DEFINITION_NOT_FOUND' }
  | { outcome: 'PHASE_NOT_IN_SEASON' }
  | { outcome: 'LABEL_TAKEN' };

/** A Season slot as an event create reads it: where it is, and the event already on it. */
export interface SeasonSlotWithEvent {
  slot: SportLeagueSeasonSlot;
  sportLeagueId: string;
  sportLeagueSeasonId: string;
  /** The event covering it; null while it is free. */
  sportEventId: string | null;
}

/** A labelled test slot to add to a Season (#2004). */
export interface TestSeasonSlotCreate {
  sportLeagueId: string;
  sportLeagueSeasonId: string;
  slotDefinitionId: string;
  label: string;
  startsAt: Date;
  endsAt: Date | null;
}
