/**
 * Repository ports for the cross-sport catalog and event core (#235). Each covers its
 * entity's full operation set, including the unscoped reads a root admin needs (access
 * rule A1): the catalog is reference data, narrowed by filters, never paged (§16).
 */

import type { ProviderSyncFindingOpenCount } from './provider-sync-finding-ports';
import type {
  AutoReleaseCheck,
  BackgroundJobRequest,
  FieldOrderBasis,
  MatchStatus,
  PlatformPricingProfile,
  ProviderEventRef,
  OverdueEventFacts,
  SportEventParticipantStatus,
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
  SportEventRoundMatch,
  SportEventRoundMatchGameSideResult,
  SportEventParticipant,
  SportEventParticipantStanding,
  SportEventSlotParticipantValuation,
  SportEventRound,
  SportEventStatus,
  SportEventSlotTier,
  SportEventTierSlot,
  SlotPricing,
  SlotTierSettings,
  SportLeague,
  SportLeaguePosition,
  TierProfileValues,
  PlatformTierProfile,
  ValuationSource,
  SportLeaguePhaseDefinition,
  SeasonSpan,
  SportLeagueSeason,
  SportLeagueSeasonDetail,
  SportLeagueSeasonSlot,
  SyncSeasonSlot,
  SlotNamePattern,
  SlotKind,
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

export type SportLeagueUpdate = Partial<Pick<SportLeague, 'name' | 'isActive' | 'autoReleaseDaysBeforeStart' | 'platformTierProfileId' | 'platformPricingProfileId'>> & {
  /**
   * The provider league whose sync the sport league takes (#1997): its mapping to it is made when
   * missing and selected, in the same write. Null stops the sync and keeps the mapping.
   */
  syncProviderLeagueId?: string | null;
};

/**
 * What still uses a sport league, each a reason it cannot be deleted (#1400). Its participants
 * are counted (#1853).
 */
export interface SportLeagueUses {
  /** Events of the sport league, every year. */
  sportEventCount: number;
  /** Contest setups offered for its events. */
  contestTemplateCount: number;
  /** Event page offers on its slots. */
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
  /** The active sport leagues whose events a provider's sync creates (ADR 0011, #1725), by name. */
  findEventSynced(): Promise<SportLeague[]>;
  update(id: string, updates: SportLeagueUpdate): Promise<SportLeague>;
  /**
   * Deletes the sport league unless something still uses it (#1400), in one transaction that locks
   * it first, so nothing can start using it between the count and the delete. Every league that
   * muted its event emails forgets it. Returns what uses it, counted under the lock: all zero means it was deleted. Null when no
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
  /** Only events of this sport league. */
  sportLeagueId?: string;
  /** Only events of this Season (#2003). */
  sportLeagueSeasonId?: string;
  /** Only events that own a Season slot of one of these slot definitions (#2010). */
  slotDefinitionIds?: readonly string[];
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
 * The sport league is stored with the event, and its Season must be that league's (#2010). `providerRef` is the provider's id
 * for an event the sync creates (#2004): it is kept under its Season's league's selected provider
 * mapping, which must be that provider's. A test event has none.
 */
export type SportEventCreate = Omit<SportEvent, 'id' | 'sport' | 'sportUrlSegment' | 'createdAt' | 'updatedAt' | 'slotDefinitions' | 'championshipYear' | 'participantType' | 'scoringFamily' | 'providerMappings' | 'roundCount'> & {
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
 * `externalId` (an event's own notification), or the events holding the Games a game's provider
 * id is mapped to (#2007), by PoolMaster's ids for them. `startedBy` is set for a notification that
 * play has started (#1499): it also finds the events still `SCHEDULED` that started by then, which
 * the lifecycle sweep has yet to move.
 */
export type ProviderNotifiedEventQuery = {
  providerId: string;
  sport: Sport;
  startedBy?: Date;
} & ({ externalId: string } | { sportEventIds: readonly string[] });

/** A provider-linked event a notification may sync. */
export interface ProviderNotifiedEvent {
  /** PoolMaster's own id for the event (#1819). */
  sportEventId: string;
  sport: Sport;
  providerId: string;
  externalId: string;
  /** Whether the event is `IN_PROGRESS`; false for one still `SCHEDULED` past its start. */
  inProgress: boolean;
}

/** The counts a release's ready checks read of one event besides its admin counts (#1823). */
export interface SportEventReleaseFacts {
  scheduledRoundCount: number;
  contestSetupCount: number;
  /** The active tiered and budget setups covering one of the event's slots: those the field's tiers and prices serve. */
  rosterSetupCount: number;
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
  /**
   * The events a provider knows by any of these identities, in one read (#1253). One identity can
   * name several events, one per competition its games reach (#2154).
   */
  findByProviderRefs(providerId: string, externalIds: readonly string[]): Promise<SportEvent[]>;
  /**
   * Each event's active field as the provider's feed ids for its teams in the sport league, by
   * event id, in one read (#2012): what a date window places by. An event with no field is left out.
   */
  findFieldFeedIds(providerId: string, sportLeagueId: string, sportEventIds: readonly string[]): Promise<Map<string, ReadonlySet<string>>>;
  /** Ordered by start date, then name. */
  findAll(filters: SportEventFilters): Promise<SportEvent[]>;
  /**
   * Creates the events in one insert, all or none, answering them in the order given (#1253).
   * An event's Season must be its own sport league's: the composite key refuses another's (#2010).
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
  /**
   * Removes a test slot (#2075) in one transaction: its event (`sportEventId`, null when it has
   * none) as `delete` does, the slot, and each test participant on that event's field that no other
   * field holds. No other participant is touched. A synced slot is never removed. Returns how many
   * test participants went.
   */
  deleteTestSlot(seasonSlotId: string, sportEventId: string | null): Promise<number>;
  /** Event participants per event, for each id asked about (0 where none). */
  countParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>>;
  /**
   * Active field rows with no tier in each event slot's set (#2044), per slot id, for each slot
   * asked about (0 where none); at most one slot of an event. An event can't be released while
   * any remain in its first slot's set (#431). One auto-tiering placed beyond a capped last tier
   * (no tier, but a tier source) is not counted: the league's layout leaves it out (#1844).
   */
  countUntieredActiveParticipants(slots: readonly ValuedSlot[]): Promise<Map<string, number>>;
  /**
   * Active field rows with no price in each event slot's set (#2044), per slot id, for each slot
   * asked about (0 where none); at most one slot of an event. An event can't be released while
   * any remain in its first slot's set (#93).
   */
  countUnpricedActiveParticipants(slots: readonly ValuedSlot[]): Promise<Map<string, number>>;
  /** Tiers in each event slot's set (#2044), per slot id, for each slot asked about (0 where none). */
  countTiers(sportEventSlotIds: readonly string[]): Promise<Map<string, number>>;
  /**
   * The Season slots each event covers (#2004), in play order, for each id asked about (empty
   * where none), in a fixed number of reads however many events.
   */
  findSlots(sportEventIds: readonly string[]): Promise<Map<string, SportLeagueSeasonSlot[]>>;
  /**
   * Whether the event is a test event, one covering a test slot (#2074): null when there is no such
   * event. One read, for the admin result writes' guard.
   */
  isTestEvent(sportEventId: string): Promise<boolean | null>;
  /**
   * The numbers of the tiers no active field row is in, per event slot id (#2044), in tier order,
   * for each slot asked about (empty where none). An event can't be released while its first
   * slot's set has any: no entry could pick from them.
   */
  findEmptyTierNumbers(sportEventSlotIds: readonly string[]): Promise<Map<string, number[]>>;
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
  /** Events per sport league, for each id asked about (0 where none). */
  countBySportLeagues(sportLeagueIds: readonly string[]): Promise<Map<string, number>>;
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
  /**
   * The events the lifecycle scheduler may move on: auto lifecycle on, and `SCHEDULED`,
   * `IN_PROGRESS` or `POSTPONED`, whose contests follow its start (#1792). Unordered.
   */
  findAutoLifecycleCandidates(): Promise<AutoLifecycleCandidate[]>;
}

/** A status the lifecycle scheduler moves an event on from. */
export type AutoLifecycleStatus = typeof SportEventStatus.SCHEDULED | typeof SportEventStatus.IN_PROGRESS | typeof SportEventStatus.POSTPONED;

/** An event the lifecycle scheduler may move on, its status narrowed so the scheduler's switch is checked whole. */
export type AutoLifecycleCandidate = SportEvent & { status: AutoLifecycleStatus };

export interface SportEventRoundSchedule {
  roundNumber: number;
  scheduledDate: Date;
  scheduledEndAt?: Date | null;
}

/** A round to create, on its event, in the Season slot of the event it is played in (#2006). */
export type SportEventRoundCreate = SportEventRoundSchedule & { sportEventId: string; seasonSlotId: string };

export interface SportEventRoundRepository {
  /** Ordered by round number. */
  findBySportEvent(sportEventId: string): Promise<SportEventRound[]>;
  /** Each asked-about event's rounds, ordered by round number (an empty list where none). */
  findBySportEvents(sportEventIds: readonly string[]): Promise<Map<string, SportEventRound[]>>;
  /** Creates the given rounds, of one event or several, in one insert (#1253). */
  createMany(rounds: readonly SportEventRoundCreate[]): Promise<void>;
  /** Reschedules existing rounds, all or none. `scheduledEndAt` left undefined is kept. */
  reschedule(sportEventId: string, rounds: readonly SportEventRoundSchedule[]): Promise<void>;
  /**
   * The results recorded in each of the event's rounds, by round id, grouped by status (#1889): two
   * grouped reads however many rounds and results. A round with nothing recorded is absent.
   */
  findResultFacts(sportEventId: string): Promise<Map<string, RoundResultFacts>>;
}

/** undefined leaves a field alone; null clears it. */
export interface SportEventParticipantPatch {
  status?: SportEventParticipantStatus;
  ranking?: number | null;
  oddsToWin?: number | null;
  seedNumber?: number | null;
}

export type SportEventParticipantCreate = SportEventParticipantPatch & { participantId: string };

export interface SportEventParticipantFieldUpdate {
  id: string;
  updates: SportEventParticipantPatch;
  /**
   * A hand edit of the row's valuation in one event slot's set (#2044); undefined leaves every
   * valuation alone.
   */
  valuation?: {
    slot: Pick<SportEventTierSlot, 'id' | 'sportEventId'>;
    /** A manually set price, or null to clear it; undefined leaves the price alone. */
    price?: number | null;
    /** A manual move into another tier of the set, at this place in it; undefined leaves the tier alone. */
    tier?: { sportEventSlotTierId: string; tierOrderIndex: number };
  };
}

/** A round row with its sport extension, when the sport has one and it has been scored. */
/** A field row's side result in one FIELD Game of its event (#2008). */
export interface FieldGameResultView {
  sportEventRoundId: string;
  roundNumber: number;
  /** The Game's status: a race's result is official once its Game is COMPLETED, a golf round once every golfer has finished it. */
  gameStatus: MatchStatus;
  /** When the Game was completed; null while it is not. */
  gameCompletedAt: Date | null;
  result: SportEventRoundMatchGameSideResult;
  updatedAt: Date;
}

/** One field row, as every reader of an event's participants sees it (#236). */
export interface SportEventParticipantView {
  entry: SportEventParticipant;
  participant: Participant;
  /**
   * The row's valuation in its event's first slot's set (#2044: today's only starting point, and
   * the set every field read shows); null when it has none there.
   */
  valuation: SportEventSlotParticipantValuation | null;
  standing: SportEventParticipantStanding | null;
  /**
   * This row's side result in each FIELD Game of its event (#2008), in round order: a race's one
   * Game, a golf round. A round with no side for the row (after a cut) has none.
   */
  fieldResults: FieldGameResultView[];
  /** The head-to-head matches naming this row on either side, in match order: head to head scores from them (#699). FIELD matches are in `fieldResults`. */
  matches: SportEventRoundMatch[];
  /** Whether the participant is affiliated with the event's sport league — false flags an invite from elsewhere. */
  affiliatedWithSportLeague: boolean;
}

/**
 * An event as the field reads take it (#2227): its id, its sport league (against which each
 * participant's league is flagged), and whether any of its slots plays FIELD, which the caller
 * already knows from the event's slot definitions. Only such an event's FIELD matches are looked up.
 */
export interface FieldReadEvent {
  sportEventId: string;
  sportLeagueId: string;
  playsField: boolean;
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
   * Each row's valuation is its event's tier-set slot's (#2044), or the one played in `seasonSlotId`'s.
   */
  findFieldForEvent(event: FieldReadEvent, seasonSlotId?: string): Promise<SportEventParticipantView[]>;
  /**
   * `findFieldForEvent` for several events in the same few statements (#1315), each event's
   * participants flagged against its own sport league: in the order of `events`, then in seed order.
   */
  findFieldsForEvents(events: readonly FieldReadEvent[]): Promise<SportEventParticipantView[]>;
  /** One field row of the event, read as `findFieldForEvent` reads each, or null when the event has no such row. */
  findFieldRow(event: FieldReadEvent, sportEventParticipantId: string): Promise<SportEventParticipantView | null>;
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
}

export interface SportEventSlotTierRepository {
  /**
   * Each event's slots as their team tier sets read them (#2044), in play order
   * (`compareSeasonSlots`) with the first marked, for each id asked about (empty where none), in a
   * fixed number of reads however many events.
   */
  findTierSlots(sportEventIds: readonly string[]): Promise<Map<string, SportEventTierSlot[]>>;
  /** The slot's tiers, ordered by tier number. */
  findBySlot(sportEventSlotId: string): Promise<SportEventSlotTier[]>;
  /** Several slots' tiers in one read (#1201), each slot's ordered by tier number. */
  findBySlots(sportEventSlotIds: readonly string[]): Promise<SportEventSlotTier[]>;
  /** Creates the given tiers, of one slot or several, in one insert (#1253). */
  createMany(tiers: readonly SportEventSlotTierCreate[]): Promise<void>;
  /**
   * Replaces a slot's tiers with `tiers`, keyed by tierKey, all or none. Valuations on a removed
   * tier move to `reassignTo` (a tierKey in `tiers`) with no order, or lose their tier when none
   * is given.
   */
  replace(sportEventSlotId: string, tiers: readonly SportEventSlotTierDefinition[], reassignTo?: string): Promise<void>;
  /** Valuations placed in each of the slot's tiers; a tier with none is left out. */
  countValuations(sportEventSlotId: string): Promise<Map<string, number>>;
}

export type SportEventSlotTierDefinition = Pick<SportEventSlotTier, 'tierKey' | 'tierNumber'>;

/** A tier to create, on its event slot. */
export type SportEventSlotTierCreate = SportEventSlotTierDefinition & { sportEventSlotId: string };

export interface TierAssignment {
  sportEventParticipantId: string;
  /** Null for a place beyond a capped last tier (#1844): ordered, but in no tier and not pickable. */
  sportEventSlotTierId: string | null;
  tierOrderIndex: number;
  source: ValuationSource;
}

export interface PriceAssignment {
  sportEventParticipantId: string;
  price: number;
  source: ValuationSource;
}

/** The slot a valuation write is on: its id, and its event's, which its field rows are of. */
export type ValuedSlot = Pick<SportEventTierSlot, 'id' | 'sportEventId'>;

export interface SportEventSlotParticipantValuationRepository {
  /** Every valuation in the slot's set, with or without a tier. */
  findBySlot(sportEventSlotId: string): Promise<SportEventSlotParticipantValuation[]>;
  /** Every valuation in several slots' sets in one read (#1201). */
  findBySlots(sportEventSlotIds: readonly string[]): Promise<SportEventSlotParticipantValuation[]>;
  /** Places field rows in the slot's tiers, all or none. Prices are untouched. */
  assignTiers(slot: ValuedSlot, assignments: readonly TierAssignment[]): Promise<void>;
  /**
   * Auto-tiers field rows and records on the slot the profile and tier size they were tiered
   * with, all or none (#1844, #2044). Prices are untouched.
   */
  assignSlotTiers(input: {
    slot: ValuedSlot;
    tierSettings: SlotTierSettings;
    assignments: readonly TierAssignment[];
  }): Promise<void>;
  /**
   * Prices field rows and records on the slot the values they were priced with, all or none
   * (#93, #2044). Tiers are untouched.
   */
  assignSlotPrices(input: {
    slot: ValuedSlot;
    pricing: SlotPricing;
    assignments: readonly PriceAssignment[];
  }): Promise<void>;
}

/** Which participant a result row names: its id, or a feed id one of its provider mappings holds. Never a name (#2114). */
export interface ParticipantMatchQuery {
  id?: string;
  externalId?: string;
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

/**
 * A sync of a sport league that failed and has not completed since (#2092): its OPEN SYNC_FAILED
 * finding, with the latest run that failed while the sync history still keeps it.
 */
export interface SportLeagueFailedSync {
  sportLeagueId: string;
  syncKind: ProviderSyncKind;
  /** When a run last failed: the finding's last sighting. */
  lastFailedAt: Date;
  /** That run, with its outcome summary as the sync history shows it; null once the history has cleared it. */
  run: { id: string; summary: string | null } | null;
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
  /** The sport leagues with any sync run kept: one with none has not synced yet. */
  leaguesWithSyncRuns: Set<string>;
  /** Every sport league's failed syncs (#2092): the Sync chip and the ERROR health read them. */
  failedSyncs: SportLeagueFailedSync[];
  heldEvents: SportLeagueHeldEvent[];
  /** Every event, cancelled ones too, per sport league. */
  eventCounts: Map<string, number>;
  /** Each sport league's current Season's span (#2003); a league with no current Season has no entry. */
  currentSeasonSpans: Map<string, SeasonSpan>;
  /** The earliest start after `now` among each sport league's events not cancelled; absent when none. */
  nextEventStarts: Map<string, Date>;
  /** Every event that may be overdue (#1865): released, neither completed nor cancelled, started long enough ago. */
  overdueCandidates: SportLeagueOverdueCandidate[];
  /**
   * Each sport league's OPEN sync findings, per severity (#1999); a league with none has no entry.
   * A failed sync whose run is kept is left out, since the Sync chip lists it with its run.
   */
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
  /** The values its tier profile orders a field by, first deciding (#2160). */
  tierSources: FieldOrderBasis[];
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
  /** Whether its selected provider mapping names any position codes, so the roster sync runs for it (#2025). */
  syncsRoster: boolean;
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
    abbreviation: string | null;
    ranking: number | null;
    createdAt: Date;
  };
  mapping: { externalId: string; lastSeenAt: Date | null } | null;
  /** A player's roster row in the league's current Season (#2025); null for a team and a player on none. */
  roster: SportLeaguePageRosterRow | null;
}

/** A player's team and position in a Season, from their roster row. */
export interface SportLeaguePageRosterRow {
  teamParticipantId: string;
  teamName: string;
  positionCode: string;
  lastSeenAt: Date;
}

/** One field row of an event as its Event page reads it (#1889). */
export interface SportEventPageFieldRow {
  id: string;
  status: SportEventParticipantStatus;
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
export type PlatformTierProfileWrite = Pick<PlatformTierProfile, 'code' | 'name' | 'description'> & TierProfileValues;
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
   * The first source of the other kind's profile of each sport league that names this one (#2160):
   * for a tier profile, its leagues' pricing profiles' first sources, and the other way round. A
   * league's two profiles must start with the same source, so a changed first source is checked here.
   */
  findPairedFirstSources(id: string): Promise<FieldOrderBasis[]>;
  /**
   * The new profile, or which unique index refused it: `'codeTaken'` or `'nameTaken'` when another
   * profile of the kind has the code or the name.
   */
  create(input: TWrite): Promise<TProfile | ProfileTaken>;
  /** The replaced profile, or which unique index refused it, as for create. */
  update(id: string, input: TWrite): Promise<TProfile | ProfileTaken>;
  /**
   * Deletes the profile unless a sport league or an event slot's tier set names it (#2044); the
   * foreign keys refuse a delete one named meanwhile. Returns how many sport leagues and tier sets
   * name it: zero means it was deleted. Null when no such profile exists.
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

/** A Season slot as coverage resolution reads it (#2014); its place comes from the template's slot. */
export interface CoverableSeasonSlotRow {
  id: string;
  slotDefinitionId: string;
  seasonCompetitionId: string;
  sportEventId: string | null;
  isTestData: boolean;
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
   * The Season's slots that play any of the definitions, each with its competition, the event on
   * it (null while free) and whether it is a test slot (#2014): what a new contest's coverage is
   * resolved from. One read.
   */
  findCoverableSlots(sportLeagueSeasonId: string, slotDefinitionIds: readonly string[]): Promise<CoverableSeasonSlotRow[]>;
  /** Season slots by id, each with its Season and the event on it, in one read; an unknown id is left out (#2006). */
  findSlotsByIds(seasonSlotIds: readonly string[]): Promise<SeasonSlotWithEvent[]>;
  /**
   * Adds a labelled test slot of a definition to a Season (#2004), copying the definition's series
   * format and pairing, in the Season's phase for the definition's phase. Says why when it adds
   * none: the definition is not one of the league's, the Season lacks its phase, or the Season
   * already has a test slot of that label on that definition.
   */
  createTestSlot(input: TestSeasonSlotCreate): Promise<TestSlotCreateResult>;
  /**
   * A Season's slots as its events sync reads them (#2005): each with its definition, the
   * PROVIDER_CODE value the league's provider mapping names that definition by, the provider's
   * tournament code it was linked to by name (#2011), whether one of the league's active contest
   * templates lists that definition, the event on it and its dates. Test slots are left out, since
   * the sync never reads or writes them. A fixed number of reads however many slots.
   */
  findSyncSlots(sportLeagueSeasonId: string, sportLeagueProviderMappingId: string): Promise<SyncSeasonSlot[]>;
  /**
   * The NAME_PATTERN mappings of a league's provider mapping (#2011): each normalized tournament
   * name and the slot definition it places a tournament on. Empty for a league that matches no
   * tournament by name. One read.
   */
  findSlotNamePatterns(sportLeagueProviderMappingId: string): Promise<SlotNamePattern[]>;
  /**
   * The session types a league's provider mapping plays as Rounds (#2045): F1's `Race`. Empty for a
   * league whose feed lists no sessions. One read.
   */
  findSessionTypes(sportLeagueProviderMappingId: string): Promise<string[]>;
  /**
   * The session types the event's league plays as Rounds, by its selected provider mapping
   * (#2045); empty when the league has no selected mapping or plays no sessions. One read.
   */
  findEventSessionTypes(sportEventId: string): Promise<string[]>;
  /**
   * The tournaments the events sync placed by name (#2011), in one transaction: an existing Season
   * slot linked to its tournament's code, or a new Season slot of the definition, in the Season's
   * competition for the definition's competition, with the definition's series format and pairing,
   * and linked. A definition whose competition the Season lacks gets no slot, and is answered in
   * `competitionMissing` so the sync can say so. A link already taken is skipped.
   */
  linkNameMatchedSlots(input: NameMatchedSlotsRecord): Promise<{ competitionMissing: string[] }>;
  /**
   * What the events sync learned of a Season's slots (#2005), in one transaction: the slots already
   * synced events now play (a slot that has an event already keeps it), and each slot's dates from
   * its games.
   */
  recordSyncedSlots(input: SyncedSlotsRecord): Promise<void>;
}

/**
 * A league's NAME_PATTERN slot definitions, as "link to existing" on a SLOT_NAME_UNMATCHED finding
 * reads and adds to them (#2011). Definitions are set by migration; only their patterns are added.
 */
export interface SlotNamePatternRepository {
  /**
   * The slot definitions a tournament of the league can be linked to through its mapping to the
   * Provider: those the mapping matches by NAME_PATTERN, in key order, each with its patterns. Null
   * when the league has no mapping to the Provider. A fixed number of reads.
   */
  findChoices(sportLeagueId: string, providerId: string): Promise<SlotNamePatternChoices | null>;
  /** Adds a pattern to a definition; TAKEN when the mapping already has that pattern on any slot. */
  addPattern(input: { sportLeagueId: string; sportLeagueProviderMappingId: string; slotDefinitionId: string; pattern: string }): Promise<'ADDED' | 'TAKEN'>;
}

/** The definitions one league's mapping to a Provider matches tournaments to by name. */
export interface SlotNamePatternChoices {
  sportLeagueProviderMappingId: string;
  slots: SlotNamePatternChoice[];
}

/** One definition a tournament can be linked to, with the names that already place tournaments on it. */
export interface SlotNamePatternChoice {
  slotDefinitionId: string;
  key: string;
  slotKind: SlotKind;
  weekNumber: number | null;
  name: string | null;
  patterns: string[];
}

/** The Season slots tournaments were placed on by name, for `linkNameMatchedSlots`. */
export interface NameMatchedSlotsRecord {
  sportLeagueId: string;
  sportLeagueSeasonId: string;
  sportLeagueProviderMappingId: string;
  links: ReadonlyArray<{ seasonSlotId: string; code: string }>;
  creates: ReadonlyArray<{ slotDefinitionId: string; code: string }>;
}

/** The slots synced events now play, and slot dates from their games, for `recordSyncedSlots`. */
export interface SyncedSlotsRecord {
  eventSlots: ReadonlyArray<{ sportEventId: string; sportLeagueSeasonId: string; seasonSlotId: string }>;
  slotDates: ReadonlyArray<{ seasonSlotId: string; startsAt: Date; endsAt: Date }>;
  /** Season slots whose TENTATIVE window the feed has now placed a game in: they become CONFIRMED (#2012). */
  confirmedWindows: readonly string[];
  /**
   * The provider's games each slot now holds (#2154), for a sync whose feed names its games: each
   * listed game moves to its slot, and a listed slot keeps only its listed games. Null when the feed
   * names no game ids.
   */
  placedGames?: {
    sportLeagueId: string;
    sportLeagueProviderMappingId: string;
    bySlot: ReadonlyArray<{ seasonSlotId: string; externalIds: readonly string[] }>;
  } | null;
}

/** What adding a test slot did: the slot, or why there is none. */
export type TestSlotCreateResult =
  | { outcome: 'CREATED'; slot: SportLeagueSeasonSlot }
  | { outcome: 'DEFINITION_NOT_FOUND' }
  | { outcome: 'COMPETITION_NOT_IN_SEASON' }
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
