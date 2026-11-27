/**
 * SportEventService — the SportEvent operation set (#236): list, read, create, update and
 * delete one event. Before #236 this was split between `listEvents` here and eleven
 * golf-named operations over the same rows in `GolfTournamentService`.
 *
 * An event is one sport league's, in one of its Seasons (#2003, #2010). Its sport comes from
 * the sport league, never from the caller. Creation is where the sport matters: golf seeds four rounds (or the rounds its
 * provider schedule implies) and six default tiers. Any other sport is refused with 422
 * rather than created as if it were golf.
 *
 * Every event is created `DRAFT` and hidden from commissioners until an admin releases it
 * (#431). Status changes, the release included, go through `EventLifecycleService`, the one
 * path that also activates and settles the event's contests; `releaseEvent` here only checks
 * the event is ready first.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestRepository,
  SportEventCreate,
  SportEventRoundSchedule,
  SportEventFilters,
  SportEventRepository,
  SportEventUpdate,
  SportLeagueRepository,
  SportLeagueSeasonRepository,
  SportRepository,
  SyncedSlotsRecord,
} from '@poolmaster/shared/db';
import {
  AutoReleaseCheckOutcome,
  blocksManualRelease,
  eventDatesFromSlots,
  testEventSlotRefusal,
  type TestEventSlotRefusal,
  eventPlaysMatches,
  eventSportDefinition,
  isProviderSyncedEvent,
  isWithinAutoReleaseWindow,
  matchProviderSlots,
  placeSlotsByName,
  providerSourceIdOf,
  type ProviderSlotPlay,
  slotNeedsDates,
  SlotWindowStatus,
  ReleaseAttemptOutcome,
  type ReleaseAttemptResult,
  ReleaseAttemptSkipReason,
  type ReleaseCheck,
  ReleaseCheckKey,
  type Sport,
  type SportEvent,
  SportEventStatus,
  type SportLeague,
  type SportLeagueSeasonSlot,
  slotDatesChange,
  sportLeagueDefinitionOf,
  sportVocabulary,
  type SlotNamePattern,
  type SyncSeasonSlot,
} from '@poolmaster/shared/domain';
import { SportEventError } from './errors';
import { describeFailedReleaseCheck, evaluateReleaseChecks, failedReleaseChecks } from './release-checks';
import type { EventLifecycleService } from './event-lifecycle-service';
import type { SportEventBracketService } from './sport-event-bracket-service';
import { dailyRoundSchedule, providerEventRoundSchedule, roundsInSlots, type SportEventRoundService } from './sport-event-round-service';
import type { SportEventTierService } from './sport-event-tier-service';
import { NO_JOBS_FOR_WRITE, combineJobsForWrite } from '../background-jobs';
import { DomainEventType, type DomainEvents } from '../domain-events';

/**
 * What only a root admin reads of an event: its release readiness and whether it can be deleted.
 * Five more queries per read, so they are counted for a root admin only (#1198); the contest
 * count spans every league, which a commissioner must never see.
 */
export interface SportEventAdminCounts {
  /** Active participants with no tier: a DRAFT event can't be released while any remain. */
  untieredParticipantCount: number;
  /** Active participants with no price: a DRAFT event can't be released while any remain (#93). */
  unpricedParticipantCount: number;
  /** Labels of the tiers no active participant is in, in tier order: a DRAFT event can't be released while any remain. */
  emptyTierNumbers: number[];
  contestCount: number;
}

/** An event with the counts every reader needs, and a root admin's own counts when asked for. */
export interface SportEventSummary {
  event: SportEvent;
  participantCount: number;
  tierCount: number;
  /** The Season slots it covers (#2004), in play order; empty for an event with none yet. */
  slots: SportLeagueSeasonSlot[];
  /** Null unless the read asked for them: see `SportEventAdminCounts`. */
  adminCounts: SportEventAdminCounts | null;
  /**
   * A DRAFT event's ready checks (#1823), on a root admin's read of the one event only: absent on
   * lists (its bracket check reads each event's bracket), on an admin action's answer (the page
   * reads the event again) and for a released event.
   */
  releaseChecks?: ReleaseCheck[];
}

/** An event summary with the root admin's counts filled in. */
export type SportEventAdminSummary = SportEventSummary & { adminCounts: SportEventAdminCounts };

/** Whether a read counts the root admin's numbers: only a root admin's read does (#1198). */
export interface SportEventReadOptions {
  adminCounts: boolean;
}

/** A test event (#2004): made by hand on a free test slot of its league's current Season. */
export interface CreateSportEventInput {
  /** The test slots it covers, in one Season; their Season and league are the event's, and their dates the event's. */
  seasonSlotIds: readonly string[];
  name: string;
  venue?: string;
  location?: string;
  autoLifecycleEnabled?: boolean;
}

export interface ProviderEventDetail {
  name: string;
  venue: string | null;
  startDate: Date;
  endDate: Date | null;
  /** The places its games are in, by the provider's code (#2005). */
  providerSlots: readonly ProviderSlotPlay[];
}

/**
 * Why a provider Season import left a provider event alone: it is linked already, it has started,
 * its games matched no slot, no template lists a slot they matched, or those slots have an event.
 */
export type ProviderEventSkipReason = 'ALREADY_LINKED' | 'ALREADY_STARTED' | 'NO_SLOT' | 'NO_TEMPLATE' | 'SLOT_TAKEN';

/** What a provider Season import (#385, #2003, #2005) created, what it left alone and why, and the codes it could not place. */
export interface ProviderSeasonImport {
  created: SportEventAdminSummary[];
  skipped: Array<{ externalId: string; name: string; reason: ProviderEventSkipReason }>;
  /** Each code no slot mapping includes, once, with the name of an event whose games carry it. */
  unmatched: Array<{ code: string; eventName: string }>;
  /** Each place the slot mappings placed games in, with the name of the event they are in (#2012). */
  placed: Array<ProviderSlotPlay & { eventName: string }>;
  /** Each game with no code that no slot's window holds, with its event's name: not synced (#2012). */
  unplaced: Array<ProviderSlotPlay & { eventName: string }>;
  /**
   * The keys of the slots placed by date window that still need their dates after this import
   * (#2012, #1924); null when the Season has no slot placed by date window.
   */
  slotsNeedingDates: string[] | null;
  /**
   * Each tournament name no NAME_PATTERN mapping placed (#2011), once per normalized name: matched
   * by none, ambiguous (more than one slot, or a slot another tournament already has), or matched
   * to a slot whose competition the Season lacks.
   */
  unplacedNames: Array<{ normalizedName: string; name: string; reason: 'UNMATCHED' | 'AMBIGUOUS' | 'SEASON_COMPETITION_MISSING' }>;
  /**
   * The name each of the Season's events takes from its competition (#2154), by event id: a
   * provider event whose games reach several competitions names none of them, so these events keep
   * their competition's name rather than the provider's.
   */
  competitionNames: ReadonlyMap<string, string>;
}

/** One synced event whose details its provider changed, and which details (#1727). */
export interface ProviderEventDetailsChange {
  sportEventId: string;
  externalId: string;
  changed: ReadonlyArray<keyof Pick<SportEventUpdate, 'name' | 'venue' | 'startDate' | 'endDate'>>;
}

/**
 * Which of a synced event's details its provider may still change, by status (#1727): every one
 * before play, only the name, venue and end while it is under way (a rain delay moves the end, never
 * the start that already happened), and none once it is over.
 */
const PROVIDER_DETAILS_BY_STATUS: Readonly<Record<SportEventStatus, ReadonlyArray<ProviderEventDetailsChange['changed'][number]>>> = {
  [SportEventStatus.DRAFT]: ['name', 'venue', 'startDate', 'endDate'],
  [SportEventStatus.SCHEDULED]: ['name', 'venue', 'startDate', 'endDate'],
  [SportEventStatus.POSTPONED]: ['name', 'venue', 'startDate', 'endDate'],
  [SportEventStatus.IN_PROGRESS]: ['name', 'venue', 'endDate'],
  [SportEventStatus.COMPLETED]: [],
  [SportEventStatus.CANCELLED]: [],
};

/** A Prisma unique violation's target, or null. Duck-typed so the service does not depend on the Prisma client. */
function uniqueViolationTarget(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } };
  return code === 'P2002' ? JSON.stringify(meta?.target ?? '') : null;
}

/** The database refusing a second event on one Season slot (#2004): the slot's unique key. */
function isSlotConflict(error: unknown): boolean {
  const target = uniqueViolationTarget(error);
  return target !== null && (target.includes('sport_league_season_competition_slot_id') || target.includes('sportLeagueSeasonCompetitionSlotId') || target.includes('sport_event_slots_season_slot_key'));
}

export interface SportEventServiceDeps {
  sportEvents: SportEventRepository;
  sportLeagues: SportLeagueRepository;
  sports: SportRepository;
  /** The Season slot a test event is made on (#2004). */
  seasons: Pick<SportLeagueSeasonRepository, 'findSlotsByIds' | 'findSyncSlots' | 'findSlotNamePatterns' | 'linkNameMatchedSlots' | 'recordSyncedSlots'>;
  rounds: SportEventRoundService;
  tiers: SportEventTierService;
  bracket: Pick<SportEventBracketService, 'releaseBlockers'>;
  lifecycle: Pick<EventLifecycleService, 'applySportEventStatusTransition' | 'sportEventRescheduledJobs'>;
  /** A new start moves the event's contests' entry reminders (#1170). */
  contests: Pick<ContestRepository, 'recheckReminders'>;
  /** What follows each results, field or game change it writes (#1946): the app's one map. */
  domainEvents: Pick<DomainEvents, 'collect'>;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

/** The error each test-slot refusal answers with (#2004). */
const TEST_EVENT_SLOT_REFUSALS: Readonly<Record<TestEventSlotRefusal, (seasonSlotId: string, sportLeagueName: string) => SportEventError>> = {
  SEASON_SLOT_NOT_TEST: () => new SportEventError('Only a test slot takes an event made by hand; the sync makes every other.', 'SEASON_SLOT_NOT_TEST', 422),
  SEASON_SLOT_NOT_CURRENT: (seasonSlotId, sportLeagueName) =>
    new SportEventError(`Season slot ${seasonSlotId} is not in ${sportLeagueName}'s current Season.`, 'SEASON_SLOT_NOT_CURRENT', 422),
  SEASON_SLOT_TAKEN: (seasonSlotId) => new SportEventError(`Season slot ${seasonSlotId} already has an event.`, 'SEASON_SLOT_TAKEN', 409),
};

/** An event loaded with only its date starts at noon UTC until its real start time is filled in. */
function isDateOnlyPlaceholder(start: Date): boolean {
  return start.getUTCHours() === 12 && start.getUTCMinutes() === 0 && start.getUTCSeconds() === 0 && start.getUTCMilliseconds() === 0;
}

export class SportEventService {
  constructor(private readonly deps: SportEventServiceDeps) {}

  /**
   * The whole catalog for the filters — narrowed, never paged (§16). A sport, sport league or
   * Season is required (#1180), so the list never reads every event ever with its counts.
   */
  async listEvents(filters: SportEventFilters, options: SportEventReadOptions): Promise<SportEventSummary[]> {
    this.deps.logger?.debug({ action: 'events.list.start', data: { ...filters } }, 'Listing sport events');
    if (filters.sport === undefined && filters.sportLeagueId === undefined && filters.sportLeagueSeasonId === undefined) {
      this.deps.logger?.warn({ action: 'events.list.filterRequired', data: { ...filters } }, 'Rejected a sport event list without a sport, sport league or Season');
      throw new SportEventError('Choose a sport, a sport league or a Season to list events.', 'SPORT_EVENT_FILTER_REQUIRED', 400);
    }
    const events = await this.deps.sportEvents.findAll(filters);
    const summaries = options.adminCounts ? await this.summarizeForAdmin(events) : await this.summarize(events);
    this.deps.logger?.info({ action: 'events.list.success', data: { ...filters, count: events.length } }, 'Listed sport events');
    return summaries;
  }

  /**
   * A test event on test slots (#2004, plan §2, #2006): only a test slot takes an event made by
   * hand, since the sync makes every other. Each slot must be free and in its league's current
   * Season, all of one Season; the event's dates are the slots'. One slot plays the league's
   * default round count in it; several play a round each, in play order (a test bracket, its
   * FINAL slot last). 404 SEASON_SLOT_NOT_FOUND; 422 SEASON_SLOT_NOT_TEST,
   * SEASON_SLOT_NOT_CURRENT, SEASON_SLOTS_NOT_ONE_SEASON; 409 SEASON_SLOT_TAKEN.
   */
  async createEvent(input: CreateSportEventInput): Promise<SportEventAdminSummary> {
    if (input.seasonSlotIds.length === 0) throw new SportEventError('A test event is made on at least one test slot.', 'SEASON_SLOT_NOT_FOUND', 404);
    const seasonSlotIds = [...new Set(input.seasonSlotIds)];
    const byId = new Map((await this.deps.seasons.findSlotsByIds(seasonSlotIds)).map((found) => [found.slot.id, found]));
    const founds = seasonSlotIds.map((seasonSlotId) => {
      const found = byId.get(seasonSlotId);
      if (found === undefined) throw new SportEventError(`Season slot ${seasonSlotId} was not found.`, 'SEASON_SLOT_NOT_FOUND', 404);
      return found;
    });
    const seasonIds = new Set(founds.map((found) => found.sportLeagueSeasonId));
    const [first] = founds;
    if (seasonIds.size !== 1) {
      throw new SportEventError('A test event\'s slots are all of one Season.', 'SEASON_SLOTS_NOT_ONE_SEASON', 422);
    }
    const { sportLeague, sport } = await this.resolveSportLeague(first.sportLeagueId);
    for (const found of founds) {
      const refusal = testEventSlotRefusal(
        { isTestData: found.slot.isTestData, sportEventId: found.sportEventId },
        found.sportLeagueSeasonId === sportLeague.currentSeasonId,
      );
      if (refusal !== null) throw TEST_EVENT_SLOT_REFUSALS[refusal](found.slot.id, sportLeague.name);
    }
    const slots = founds.map((found) => found.slot);
    // A test slot is always made with a start (createTestSlot), so its dates are never null.
    const dates = eventDatesFromSlots(slots);
    if (dates === null) throw new Error(`Season slots ${input.seasonSlotIds.join(', ')} have no start.`);
    const rounds = slots.length > 1 ? slots.length : sportLeagueDefinitionOf(sport, sportLeague).defaultRounds;
    const found = first;

    const summary = onlyOne(await this.createEditions(sportLeague, [{
      event: {
        name: input.name,
        venue: input.venue,
        location: input.location,
        startDate: dates.startDate,
        endDate: dates.endDate ?? undefined,
        status: SportEventStatus.DRAFT,
        rounds,
        sportLeagueId: sportLeague.id,
        sportLeagueSeasonId: found.sportLeagueSeasonId,
        autoLifecycleEnabled: input.autoLifecycleEnabled ?? true,
        seasonSlotIds: slots.map((slot) => slot.id),
      },
      rounds: dailyRoundSchedule(rounds, dates.startDate),
    }], slots));

    this.deps.logger?.info(
      { sportEventId: summary.event.id, sportLeagueId: sportLeague.id, sportLeagueSeasonId: found.sportLeagueSeasonId, seasonSlotIds: slots.map((slot) => slot.id), rounds },
      'Created test sport event',
    );
    return summary;
  }

  /**
   * #385, #2003, #2005 — one Season's provider slate, created in that Season in one action, in a
   * fixed number of queries however long the slate (#1253), each with the provider's id for it
   * (#2004). Each provider event's games are matched to the Season's slots by the code the
   * provider names their place by, through the league's slot provider mappings
   * (`matchProviderSlots`): an event is created only for the slots it matches that are free, and
   * only when one of them is listed by one of the league's active contest templates, so no event
   * nobody can play is made (ADR 0011). Its dates are those slots'. A code no mapping includes is
   * synced nowhere and comes back in `unmatched`, for the sync's finding.
   *
   * Events PoolMaster already has are skipped rather than refused, so the import can be run again:
   * one already linked to the provider event is reported as linked, takes any slot its games now
   * reach that no event plays yet (a playoff's later rounds), and keeps updating through
   * `keepProviderEventsCurrent`. Events are told apart by the provider's id, never by name (#2010).
   * A provider event whose start has passed is skipped too (#1821): created now it would be a
   * draft nobody can release or play. Every matched slot takes its dates from its games. Nothing is
   * ever deleted: a page that lists fewer events or games leaves the rest as they are.
   *
   * A league whose provider mapping has NAME_PATTERN mappings (an open phase, #2011) places a
   * tournament no code places by its normalized name, once: its Season slot is created, or the
   * existing one linked, to the tournament's code, which matches it from then on. A name that
   * matches nothing, or more than one slot, places nothing and is reported in `unplacedNames`.
   */
  async importProviderSeason(input: {
    sportLeagueId: string;
    sportLeagueSeasonId: string;
    providerId: string;
    /** The league's selected provider mapping, whose slot provider mappings name the codes. */
    sportLeagueProviderMappingId: string;
    providerEvents: ReadonlyArray<ProviderEventDetail & { externalId: string }>;
  }): Promise<ProviderSeasonImport> {
    const { sportLeague } = await this.resolveSportLeague(input.sportLeagueId);
    const now = this.now();
    const [linkedEvents, seasonSlots, namePatterns] = await Promise.all([
      this.deps.sportEvents.findByProviderRefs(input.providerId, input.providerEvents.map((providerEvent) => providerEvent.externalId)),
      this.deps.seasons.findSyncSlots(input.sportLeagueSeasonId, input.sportLeagueProviderMappingId),
      this.deps.seasons.findSlotNamePatterns(input.sportLeagueProviderMappingId),
    ]);
    const named = await this.placeByName(input, seasonSlots, namePatterns);
    const slots = named.slots;
    // A provider event's games can reach several competitions, each with its own event (#2154).
    const linkedIdsByExternalId = new Map<string, string[]>();
    for (const event of linkedEvents) {
      for (const externalId of externalIdsAt(event, input.providerId)) linkedIdsByExternalId.set(externalId, [...(linkedIdsByExternalId.get(externalId) ?? []), event.id]);
    }
    const competitionsByEvent = new Map<string, Set<string>>();
    for (const slot of slots) {
      if (slot.sportEventId !== null) competitionsByEvent.set(slot.sportEventId, (competitionsByEvent.get(slot.sportEventId) ?? new Set()).add(slot.seasonCompetitionId));
    }
    // A window takes dates only from games between teams on its event's field (#2012): one read of
    // the linked events' fields, and none for a Season with no window.
    const fields = linkedEvents.length === 0 || !slots.some((slot) => slot.window !== null)
      ? new Map<string, ReadonlySet<string>>()
      : await this.deps.sportEvents.findFieldFeedIds(input.providerId, input.sportLeagueId, linkedEvents.map((event) => event.id));

    const editions: NewEdition[] = [];
    /** Each edition's competition name, in step with `editions`; null where the provider's name stands. */
    const editionNames: Array<string | null> = [];
    const skipped: ProviderSeasonImport['skipped'] = [];
    const unmatched = new Map<string, ProviderSeasonImport['unmatched'][number]>();
    const eventSlots: SyncedSlotsRecord['eventSlots'][number][] = [];
    const slotDates: SyncedSlotsRecord['slotDates'][number][] = [];
    const confirmedWindows = new Set<string>();
    const placed: ProviderSeasonImport['placed'] = [];
    const unplaced: ProviderSeasonImport['unplaced'] = [];
    /** Slots an event of this slate takes, so a second provider event cannot take one too. */
    const taken = new Set(slots.flatMap((slot) => (slot.sportEventId === null ? [] : [slot.seasonSlotId])));
    for (const providerEvent of input.providerEvents) {
      const { externalId, name } = providerEvent;
      const linkedIds = linkedIdsByExternalId.get(externalId) ?? [];
      /**
       * The linked event of a competition: its games' event there, and the field its window slots
       * read. A linked event holding no slot yet is the first competition's to reach it, and no other's.
       */
      const linkedIn = (seasonCompetitionId: string) => linkedIds.find((id) => competitionsByEvent.get(id)?.has(seasonCompetitionId) === true)
        ?? linkedIds.find((id) => !competitionsByEvent.has(id));
      const fieldOf = (slot: SyncSeasonSlot) => {
        const linkedId = linkedIn(slot.seasonCompetitionId);
        return (linkedId === undefined ? undefined : fields.get(linkedId)) ?? new Set<string>();
      };
      const { matched, unmatched: missed, unplaced: unplacedGames } = matchProviderSlots(providerEvent.providerSlots, slots, fieldOf);
      for (const play of missed) {
        // A tournament name matching handled is reported by its name, not again by its code.
        if (!unmatched.has(play.code) && !named.handledCodes.has(play.code)) unmatched.set(play.code, { code: play.code, eventName: name });
      }
      unplaced.push(...unplacedGames.map((game) => ({ ...game, eventName: name })));
      for (const { slot, play, fromGames } of matched) {
        placed.push({ ...play, eventName: name });
        // A window holding no game of the event's own teams is no evidence of its dates (#2012).
        if (!fromGames) continue;
        const change = slotDatesChange(slot, play);
        if (change !== null) slotDates.push({ seasonSlotId: slot.seasonSlotId, ...change });
        // The feed placed the event's own game in a best-guess window: the window is now the feed's.
        if (slot.window?.status === SlotWindowStatus.TENTATIVE) confirmedWindows.add(slot.seasonSlotId);
      }
      const free = matched.filter(({ slot }) => !taken.has(slot.seasonSlotId));
      // One event per competition its games reach (#2154): a season's slate of college football games
      // reaches its bowls, its conference title games and its CFP, and no event crosses competitions.
      // A competition with a linked event gives it its free slots; any other makes one when playable.
      const judged = (matched.length === 0 ? [null] : competitionsOf(matched)).flatMap((competitionId) => {
        const linkedId = competitionId === null ? undefined : linkedIn(competitionId);
        const freeInCompetition = free.filter(({ slot }) => slot.seasonCompetitionId === competitionId);
        if (linkedId !== undefined && competitionId !== null) {
          competitionsByEvent.set(linkedId, (competitionsByEvent.get(linkedId) ?? new Set()).add(competitionId));
          for (const { slot } of freeInCompetition) {
            taken.add(slot.seasonSlotId);
            eventSlots.push({ sportEventId: linkedId, sportLeagueSeasonId: input.sportLeagueSeasonId, seasonSlotId: slot.seasonSlotId });
          }
          return [];
        }
        const inCompetition = matched.filter(({ slot }) => slot.seasonCompetitionId === competitionId);
        return [{ plays: freeInCompetition, reason: unplayableReason(providerEvent, inCompetition, freeInCompetition.map(({ slot }) => slot), now) }];
      });
      const playable = judged.flatMap(({ plays, reason }) => (reason === null ? [plays] : []));
      if (playable.length === 0) {
        // Nothing new: already linked, or the first competition's own reason (NO_SLOT or ALREADY_STARTED when nothing matched).
        const [first] = judged;
        skipped.push({ externalId, name, reason: linkedIds.length > 0 || judged.length === 0 ? 'ALREADY_LINKED' : first.reason ?? 'SLOT_TAKEN' });
        continue;
      }
      for (const plays of playable) {
        for (const { slot } of plays) taken.add(slot.seasonSlotId);
        // A named competition names its event; the provider's name is the slate's (#2154).
        const competitionName = plays.find(({ slot }) => slot.competitionName !== null)?.slot.competitionName ?? null;
        editionNames.push(competitionName);
        editions.push(providerEdition({
          ...providerEvent,
          name: competitionName ?? name,
          sportLeagueId: sportLeague.id,
          sportLeagueSeasonId: input.sportLeagueSeasonId,
          providerId: input.providerId,
          plays: plays.map(({ slot, play }) => ({ seasonSlotId: slot.seasonSlotId, startsAt: play.startsAt, endsAt: play.endsAt })),
        }));
      }
    }
    const written = await this.createEditions(sportLeague, editions);
    await this.deps.seasons.recordSyncedSlots({ eventSlots, slotDates, confirmedWindows: [...confirmedWindows] });
    // The new events' slots as they now stand, with the dates just written: one read for them all.
    const slotsByEvent = written.length === 0 ? new Map<string, SportLeagueSeasonSlot[]>() : await this.deps.sportEvents.findSlots(written.map(({ event }) => event.id));
    const created = written.map((summary) => ({ ...summary, slots: slotsByEvent.get(summary.event.id) ?? [] }));
    // A window this import confirmed no longer needs its dates.
    const slotsNeedingDates = !slots.some((slot) => slot.placedByWindow) ? null : slots
      .filter((slot) => slotNeedsDates(confirmedWindows.has(slot.seasonSlotId) && slot.window !== null ? { ...slot, window: { ...slot.window, status: SlotWindowStatus.CONFIRMED } } : slot))
      .map((slot) => slot.key);

    this.deps.logger?.info(
      {
        sportLeagueId: input.sportLeagueId,
        sportLeagueSeasonId: input.sportLeagueSeasonId,
        providerId: input.providerId,
        createdCount: created.length,
        skippedCount: skipped.length,
        alreadyStartedCount: skipped.filter((row) => row.reason === 'ALREADY_STARTED').length,
        slotsLinkedCount: eventSlots.length,
        slotDatesChangedCount: slotDates.length,
        unmatchedCodes: [...unmatched.keys()],
        // Provider events whose games carry no place at all, which no slot mapping can place.
        noCodeCount: input.providerEvents.filter((providerEvent) => providerEvent.providerSlots.length === 0).length,
        unplacedGameCount: unplaced.length,
        windowsConfirmedCount: confirmedWindows.size,
        slotsNeedingDates,
      },
      'Imported provider Season',
    );
    const competitionNames = new Map([
      ...slots.flatMap((slot) => (slot.sportEventId === null || slot.competitionName === null ? [] : [[slot.sportEventId, slot.competitionName] as const])),
      ...written.flatMap(({ event }, index) => (editionNames[index] === null ? [] : [[event.id, editionNames[index]] as const])),
    ]);
    return { created, skipped, unmatched: [...unmatched.values()], placed, unplaced, slotsNeedingDates, unplacedNames: named.unplaced, competitionNames };
  }

  /**
   * The name step of a Season import (#2011): each provider event of one play that no code places
   * is placed by its normalized name (`placeSlotsByName`), the slots it places are written, and
   * the Season's slots read again so the import matches them by code. Nothing is read or written
   * for a league with no NAME_PATTERN mapping.
   */
  private async placeByName(
    input: { sportLeagueId: string; sportLeagueSeasonId: string; sportLeagueProviderMappingId: string; providerEvents: ReadonlyArray<ProviderEventDetail & { externalId: string }> },
    seasonSlots: SyncSeasonSlot[],
    namePatterns: readonly SlotNamePattern[],
  ): Promise<{ slots: SyncSeasonSlot[]; handledCodes: Set<string>; unplaced: ProviderSeasonImport['unplacedNames'] }> {
    const unplacedEvents = namePatterns.length === 0 ? [] : input.providerEvents.flatMap((providerEvent) => {
      const [play] = providerEvent.providerSlots;
      if (providerEvent.providerSlots.length !== 1 || play.code === null) return [];
      const { code } = play;
      return matchProviderSlots([play], seasonSlots).matched.length === 0
        ? [{ name: providerEvent.name, play: { ...play, code } }]
        : [];
    });
    if (unplacedEvents.length === 0) return { slots: seasonSlots, handledCodes: new Set(), unplaced: [] };
    const placements = placeSlotsByName(unplacedEvents, seasonSlots, namePatterns);
    const links = placements.flatMap((placement) => (placement.outcome === 'LINK' ? [{ seasonSlotId: placement.seasonSlotId, code: placement.play.code }] : []));
    const creates = placements.flatMap((placement) => (placement.outcome === 'CREATE' ? [{ slotDefinitionId: placement.slotDefinitionId, code: placement.play.code }] : []));
    const unplaced = new Map<string, ProviderSeasonImport['unplacedNames'][number]>();
    for (const placement of placements) {
      if ((placement.outcome === 'UNMATCHED' || placement.outcome === 'AMBIGUOUS') && !unplaced.has(placement.normalizedName)) {
        unplaced.set(placement.normalizedName, { normalizedName: placement.normalizedName, name: placement.name, reason: placement.outcome });
      }
    }
    const { competitionMissing } = await this.deps.seasons.linkNameMatchedSlots({
      sportLeagueId: input.sportLeagueId,
      sportLeagueSeasonId: input.sportLeagueSeasonId,
      sportLeagueProviderMappingId: input.sportLeagueProviderMappingId,
      links,
      creates,
    });
    // A matched slot whose competition the Season lacks got no Season slot: said, never dropped silently.
    const missing = new Set(competitionMissing);
    for (const placement of placements) {
      if (placement.outcome === 'CREATE' && missing.has(placement.slotDefinitionId)) {
        unplaced.set(placement.normalizedName, { normalizedName: placement.normalizedName, name: placement.name, reason: 'SEASON_COMPETITION_MISSING' });
      }
    }
    this.deps.logger?.info(
      { sportLeagueId: input.sportLeagueId, sportLeagueSeasonId: input.sportLeagueSeasonId, linkedCount: links.length, createdCount: creates.length, unplacedNames: [...unplaced.keys()] },
      'Placed provider tournaments on Season slots by name',
    );
    const slots = links.length + creates.length === missing.size
      ? seasonSlots
      : await this.deps.seasons.findSyncSlots(input.sportLeagueSeasonId, input.sportLeagueProviderMappingId);
    return { slots, handledCodes: new Set(unplacedEvents.map(({ play }) => play.code)), unplaced: [...unplaced.values()] };
  }

  /**
   * #1727 (ADR 0011) — a synced sport league's events keep their provider's name, venue and dates.
   * For each provider event already linked to one of the league's events, the details its status
   * still lets change (`PROVIDER_DETAILS_BY_STATUS`) are written where they differ, through
   * `updateEvent`: the admin's own path, so a moved start shifts the rounds and tells the
   * leagues as an admin's move would, and the lifecycle scheduler then moves the status on the new
   * dates. The provider wins over an admin's edit (`rules/architecture-rules.md` §4). An event that
   * plays Season slots takes its dates from those slots (`eventDatesFromSlots`), read after the
   * import wrote them, never from the provider event (#2005). A venue or end the provider does not
   * send is left as it is, not cleared. One read for the events, then one
   * update per event that changed; an update that fails is logged and the rest still go.
   */
  async keepProviderEventsCurrent(input: {
    sportLeagueId: string;
    providerId: string;
    providerEvents: ReadonlyArray<ProviderEventDetail & { externalId: string }>;
    /** The events that take their competition's name, not the provider's (#2154): the import's. */
    competitionNames?: ReadonlyMap<string, string>;
  }): Promise<ProviderEventDetailsChange[]> {
    const linked = await this.deps.sportEvents.findByProviderRefs(
      input.providerId,
      input.providerEvents.map((providerEvent) => providerEvent.externalId),
    );
    const providerEventById = new Map(input.providerEvents.map((providerEvent) => [providerEvent.externalId, providerEvent]));
    // An event that plays Season slots takes its dates from them, the one computation (#2005).
    const slotsByEvent = linked.length === 0 ? new Map<string, SportLeagueSeasonSlot[]>() : await this.deps.sportEvents.findSlots(linked.map((event) => event.id));
    const changes: ProviderEventDetailsChange[] = [];
    for (const event of linked) {
      const externalId = externalIdsAt(event, input.providerId).at(0);
      const providerEvent = externalId === undefined ? undefined : providerEventById.get(externalId);
      if (externalId === undefined || !providerEvent || event.sportLeagueId !== input.sportLeagueId) continue;
      const slotDates = eventDatesFromSlots(slotsByEvent.get(event.id) ?? []);
      const named = { ...providerEvent, name: input.competitionNames?.get(event.id) ?? providerEvent.name };
      const updates = providerDetailUpdates(event, slotDates === null ? named : { ...named, ...slotDates });
      const changed = PROVIDER_DETAILS_BY_STATUS[event.status].filter((field) => updates[field] !== undefined);
      if (changed.length === 0) continue;
      try {
        await this.applyEventUpdate(event.id, Object.fromEntries(changed.map((field) => [field, updates[field]])), { tellMembers: true });
        changes.push({ sportEventId: event.id, externalId, changed });
      } catch (error) {
        // One event's refused update must not hold back the rest; the next sweep tries it again.
        this.deps.logger?.error(
          { sportLeagueId: input.sportLeagueId, sportEventId: event.id, externalId, changed, error: error instanceof Error ? error.message : String(error) },
          'Could not keep a synced event current with its provider',
        );
      }
    }
    if (changes.length > 0) {
      this.deps.logger?.info(
        { sportLeagueId: input.sportLeagueId, providerId: input.providerId, changes },
        'Kept synced events current with their provider',
      );
    }
    return changes;
  }

  /**
   * Edits an event. Every event is admin-owned, linked to a provider or not. The round
   * schedule follows the edit: a new start date moves every round by the same amount, and a
   * higher round count schedules the added rounds, so automatic lifecycle and live scores
   * read the schedule the admin now sees. A released event's moved start is told to its leagues
   * unless the edit is a data correction (`tellMembers: false`, #1042): filling in the real
   * start time of an event loaded with only its date. 400 SPORT_EVENT_START_NOT_PLACEHOLDER
   * when such an edit moves a start that is not the date-only placeholder, so a real start
   * never moves without telling the leagues.
   */
  async updateEvent(
    sportEventId: string,
    updates: SportEventUpdate,
    options: { tellMembers: boolean },
  ): Promise<SportEventAdminSummary> {
    if ((updates.startDate !== undefined || updates.endDate !== undefined)
      && ((await this.deps.sportEvents.findSlots([sportEventId])).get(sportEventId) ?? []).length > 0) {
      throw new SportEventError('This event\'s dates come from its Season slots.', 'EVENT_DATES_FROM_SLOTS', 422);
    }
    return this.applyEventUpdate(sportEventId, updates, options);
  }

  /**
   * An event edit, the admin's and the sync's one path. On an event that plays Season slots the
   * sync writes only the dates its slots give (#2005), so it may move them where an admin may not.
   */
  private async applyEventUpdate(
    sportEventId: string,
    updates: SportEventUpdate,
    options: { tellMembers: boolean },
  ): Promise<SportEventAdminSummary> {
    const { startDate: startedAt, rounds: roundCount, status } = await this.requireEvent(sportEventId);
    const movesStart = updates.startDate !== undefined && updates.startDate.getTime() !== startedAt.getTime();
    if (movesStart && !options.tellMembers && !isDateOnlyPlaceholder(startedAt)) {
      this.deps.logger?.warn(
        { sportEventId, startDate: startedAt.toISOString() },
        'Refused to move a sport event start quietly: it is not the date-only placeholder',
      );
      throw new SportEventError(
        `Sport event ${sportEventId} already has a real start time, so moving it must tell its leagues.`,
        'SPORT_EVENT_START_NOT_PLACEHOLDER',
        400,
      );
    }
    const startDate = updates.startDate ?? startedAt;
    const shiftMs = startDate.getTime() - startedAt.getTime();
    // A moved start's follow-ups are written with the new start (#1464, #1946), so an edit that
    // fails tells nobody and one that lands always tells those its handlers tell.
    const told = shiftMs !== 0 && options.tellMembers
      ? await this.deps.lifecycle.sportEventRescheduledJobs({ id: sportEventId, startDate, status }, startedAt)
      : NO_JOBS_FOR_WRITE;
    // The edit can change what the event's contests' boards show, so its rebuild rides with it (#1466).
    const written = combineJobsForWrite(told, await this.deps.domainEvents.collect({ type: DomainEventType.SPORT_EVENT_RESULTS_CHANGED, sportEventId }));
    // The event and its jobs are one write; the rounds and reminders follow it, not in its
    // transaction: a failure after it leaves the rounds behind the event's new dates. The round
    // writes only reject a round the event lacks, and they read the event's rounds first, so in
    // practice they don't fail here.
    await this.deps.sportEvents.update(sportEventId, updates, written.jobs.length > 0 ? { jobs: written.jobs } : undefined);
    written.queued();
    if (shiftMs !== 0) {
      await this.deps.rounds.shiftSchedule(sportEventId, shiftMs);
      await this.deps.contests.recheckReminders({ sportEventId }, this.now());
    }
    if (updates.rounds && updates.rounds > (roundCount ?? 0)) {
      await this.deps.rounds.extendTo({ sportEventId, rounds: updates.rounds, startDate });
    }
    return this.requireAdminSummary(sportEventId);
  }

  /**
   * "Release for contests" (#431): DRAFT → SCHEDULED, after which commissioners can build
   * contests on the event and its tiers and prices are locked for good. 409
   * SPORT_EVENT_NOT_DRAFT once released; 409 SPORT_EVENT_ALREADY_STARTED once its start time
   * has passed; 422 SPORT_EVENT_NOT_READY while its field is empty, any active participant
   * has no tier, any tier has no active participant (no entry could pick from it), its
   * prices are not assigned or miss an active participant (#93), or, for a sport that plays a
   * bracket, its bracket is incomplete (#698). These are the ready checks `blocksManualRelease`
   * names (#1823); the rounds, provider-link and contest-setup checks hold only the automatic
   * release.
   */
  async releaseEvent(sportEventId: string): Promise<SportEventAdminSummary> {
    const summary = await this.requireAdminSummary(sportEventId);
    const { event } = summary;
    if (event.status !== SportEventStatus.DRAFT) {
      this.deps.logger?.warn({ sportEventId, status: event.status }, 'Refused to release a sport event that is not a draft');
      throw new SportEventError(
        `Sport event ${sportEventId} has already been released.`,
        'SPORT_EVENT_NOT_DRAFT',
        409,
      );
    }
    // The checks only the automatic release waits for leave the root admin's judgement alone.
    const failed = failedReleaseChecks(await this.releaseChecksFor(summary)).filter((check) => blocksManualRelease(check.key));
    if (failed.some((check) => check.key === ReleaseCheckKey.NOT_STARTED)) {
      this.deps.logger?.warn(
        { sportEventId, startDate: event.startDate.toISOString() },
        'Refused to release a sport event whose start time has passed',
      );
      throw new SportEventError(
        `Sport event ${sportEventId} has already started, so it can no longer be released.`,
        'SPORT_EVENT_ALREADY_STARTED',
        409,
      );
    }
    if (failed.length > 0) {
      this.deps.logger?.warn(
        { sportEventId, failedChecks: failed.map((check) => ({ key: check.key, value: check.value })) },
        'Refused to release a sport event that is not ready',
      );
      throw new SportEventError(
        `Sport event ${sportEventId} is not ready to release: ${this.describeFailed(event, failed).join('; ')}.`,
        'SPORT_EVENT_NOT_READY',
        422,
      );
    }
    const released = await this.release(sportEventId);
    // The admin's judgement replaces the automatic one: no stored hold outlives the release.
    await this.deps.sportEvents.recordAutoReleaseCheck(sportEventId, null);
    // A release moves only the status (its follow-ups are jobs), so the counts and slots read for
    // its checks still hold: the answer is the released event with them, not a second read.
    return { ...summary, event: { ...released, autoReleaseCheck: undefined } };
  }

  /**
   * One automatic release attempt (#1823), the RELEASE_SPORT_EVENT job's handler: the event is
   * judged again as it stands now. Every ready check passing releases it through the same path as
   * the manual button; any failing holds it as a draft for the next sweep. Either way the result
   * carries every check and its value, and the event keeps the outcome and the failed checks as
   * its latest check (#1847), in place of the one before. An event that has since been released,
   * stopped being synced, or left its league's window is skipped, and its stored check is left as
   * it was.
   */
  async autoReleaseEvent(sportEventId: string): Promise<ReleaseAttemptResult> {
    const skipReason = await this.autoReleaseSkipReason(await this.requireEvent(sportEventId));
    if (skipReason !== null) {
      this.deps.logger?.info({ action: 'events.autoRelease.skipped', data: { sportEventId, reason: skipReason } }, 'Skipped an automatic event release');
      return { outcome: ReleaseAttemptOutcome.SKIPPED, reason: skipReason };
    }
    const [checks, before] = await Promise.all([
      this.requireAdminSummary(sportEventId).then((summary) => this.releaseChecksFor(summary)),
      this.deps.sportEvents.findAutoReleaseCheck(sportEventId),
    ]);
    const failed = failedReleaseChecks(checks);
    const checkedAt = this.now();
    if (failed.length > 0) {
      const failedChecks = failed.map((check) => check.key);
      await this.deps.sportEvents.recordAutoReleaseCheck(sportEventId, { checkedAt, outcome: AutoReleaseCheckOutcome.HELD, failedChecks });
      const sameHoldAsBefore = before?.outcome === AutoReleaseCheckOutcome.HELD && sameCheckKeys(before.failedChecks, failedChecks);
      this.deps.logger?.info(
        { action: 'events.autoRelease.held', data: { sportEventId, failedChecks, sameHoldAsBefore } },
        'Held an automatic event release: a ready check failed',
      );
      return { outcome: ReleaseAttemptOutcome.HELD, checks, sameHoldAsBefore };
    }
    await this.release(sportEventId);
    await this.deps.sportEvents.recordAutoReleaseCheck(sportEventId, { checkedAt, outcome: AutoReleaseCheckOutcome.RELEASED, failedChecks: [] });
    this.deps.logger?.info({ action: 'events.autoRelease.released', data: { sportEventId } }, 'Released a sport event automatically');
    return { outcome: ReleaseAttemptOutcome.RELEASED, checks };
  }

  /** Why the event is no longer one to release on its own, or null when it still is. */
  private async autoReleaseSkipReason(event: SportEvent): Promise<ReleaseAttemptSkipReason | null> {
    if (event.status !== SportEventStatus.DRAFT) return ReleaseAttemptSkipReason.NOT_DRAFT;
    if (!isProviderSyncedEvent(event)) return ReleaseAttemptSkipReason.NOT_SYNCED;
    const sportLeague = await this.deps.sportLeagues.findById(event.sportLeagueId);
    const days = sportLeague?.isActive ? sportLeague.autoReleaseDaysBeforeStart : null;
    if (days === null) return ReleaseAttemptSkipReason.AUTO_RELEASE_OFF;
    if (!isWithinAutoReleaseWindow(event.startDate, days, this.now())) return ReleaseAttemptSkipReason.OUTSIDE_WINDOW;
    return null;
  }

  /** DRAFT → SCHEDULED through the one status path, whether a root admin or the sweep released it. */
  /** Releases the draft; answers the event as the release left it. */
  private async release(sportEventId: string): Promise<SportEvent> {
    const { sportEvent } = await this.deps.lifecycle.applySportEventStatusTransition({
      sportEventId,
      toStatus: SportEventStatus.SCHEDULED,
      actor: { type: 'ROOT_ADMIN' },
      release: true,
    });
    this.deps.logger?.info({ sportEventId }, 'Released sport event for contests');
    return sportEvent;
  }

  /**
   * Deletes an event with its rounds, tiers and field. 409 EVENT_HAS_CONTESTS while any contest runs
   * on it.
   */
  async deleteEvent(sportEventId: string): Promise<void> {
    await this.requireEvent(sportEventId);
    const contests = (await this.deps.sportEvents.countContests([sportEventId])).get(sportEventId) ?? 0;
    if (contests > 0) {
      throw new SportEventError(
        `Sport event ${sportEventId} has ${contests} contest(s) and cannot be deleted.`,
        'EVENT_HAS_CONTESTS',
        409,
      );
    }
    await this.deps.sportEvents.delete(sportEventId);
    this.deps.logger?.info({ sportEventId }, 'Deleted sport event');
  }

  /**
   * What a draft event still needs before it can be released, in the words the release refusal
   * uses ("its field is not loaded"); empty when it is ready. The "event still in draft" email
   * lists them.
   */
  async releaseBlockersOf(sportEventId: string): Promise<string[]> {
    const summary = await this.requireAdminSummary(sportEventId);
    const checks = await this.releaseChecksFor(summary);
    // The email is about what to do before the start, so the start itself is not one of them.
    const failed = failedReleaseChecks(checks).filter((check) => check.key !== ReleaseCheckKey.NOT_STARTED);
    return this.describeFailed(summary.event, failed);
  }

  /** The event's ready checks as it stands now (#1823): its admin counts, its release facts and its bracket. */
  private async releaseChecksFor(summary: SportEventAdminSummary): Promise<ReleaseCheck[]> {
    const { event } = summary;
    const [facts, bracketBlockers] = await Promise.all([
      this.deps.sportEvents.findReleaseFacts({
        id: event.id,
        sportLeagueId: event.sportLeagueId,
      }),
      eventPlaysMatches(event) ? this.deps.bracket.releaseBlockers(event) : Promise.resolve(null),
    ]);
    return evaluateReleaseChecks({
      startDate: event.startDate,
      now: this.now(),
      scheduledRoundCount: facts.scheduledRoundCount,
      participantCount: summary.participantCount,
      untieredParticipantCount: summary.adminCounts.untieredParticipantCount,
      emptyTierNumbers: summary.adminCounts.emptyTierNumbers,
      isPriced: event.pricingConfig !== undefined,
      unpricedParticipantCount: summary.adminCounts.unpricedParticipantCount,
      bracketBlockers,
      contestSetupCount: facts.contestSetupCount,
    });
  }

  private describeFailed(event: SportEvent, failed: readonly ReleaseCheck[]): string[] {
    const { participant } = sportVocabulary(eventSportDefinition(event));
    return failed.flatMap((check) => describeFailedReleaseCheck(check, participant));
  }

  /** A root admin's summary, with a DRAFT event's ready checks. */
  private async withReleaseChecks(summary: SportEventAdminSummary): Promise<SportEventAdminSummary> {
    if (summary.event.status !== SportEventStatus.DRAFT) return summary;
    return { ...summary, releaseChecks: await this.releaseChecksFor(summary) };
  }

  /**
   * The event with the counts a reader of it needs. `releasedOnly` hides a DRAFT as if it did not
   * exist: only a root admin sees drafts (#431).
   */
  async requireSummary(
    sportEventId: string,
    options: SportEventReadOptions & { releasedOnly?: boolean },
  ): Promise<SportEventSummary> {
    const event = await this.requireEvent(sportEventId, options);
    if (!options.adminCounts) return (await this.summarize([event]))[0];
    const [summary] = await this.summarizeForAdmin([event]);
    return this.withReleaseChecks(summary);
  }

  /** The event with a root admin's counts: what every admin action answers with. */
  async requireAdminSummary(sportEventId: string): Promise<SportEventAdminSummary> {
    const [summary] = await this.summarizeForAdmin([await this.requireEvent(sportEventId)]);
    return summary;
  }

  /**
   * The event, one read and no counts: the guard for a read or action that needs only to know the
   * event exists (#1198). `releasedOnly` hides a DRAFT as if it did not exist (#431).
   */
  async requireEvent(sportEventId: string, options: { releasedOnly?: boolean } = {}): Promise<SportEvent> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event || (options.releasedOnly && event.status === SportEventStatus.DRAFT)) {
      throw new SportEventError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    return event;
  }

  /**
   * The event, when it is a test event (#2074, ADR 0013): one that covers a test slot. Results,
   * pairings and scores come only from the feed, so the admin result routes write them only on a
   * test event, which the test-data loader and the journeys score through them. One read: 404
   * EVENT_NOT_FOUND for no event, 409 SPORT_EVENT_NOT_TEST_DATA on any other event.
   */
  async requireTestEvent(sportEventId: string): Promise<void> {
    const isTest = await this.deps.sportEvents.isTestEvent(sportEventId);
    if (isTest === null) {
      throw new SportEventError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    if (!isTest) {
      throw new SportEventError(
        `Sport event ${sportEventId} covers no test slot: its results come only from the feed.`,
        'SPORT_EVENT_NOT_TEST_DATA',
        409,
      );
    }
  }

  /**
   * Creates new editions in a fixed number of queries, however many (#1253): the events in one
   * insert, then every event's rounds and default tiers in one insert each. A new event has no
   * field, no contests and every tier empty, so its summary is built from what was written
   * rather than read back.
   */
  private async createEditions(
    sportLeague: SportLeague,
    editions: readonly NewEdition[],
    /** The Season slots the editions cover (a test event's one), for their summaries. */
    slots: readonly SportLeagueSeasonSlot[] = [],
  ): Promise<SportEventAdminSummary[]> {
    if (editions.length === 0) return [];
    let events: SportEvent[];
    try {
      events = await this.deps.sportEvents.createMany(editions.map((edition) => edition.event));
    } catch (error) {
      if (isSlotConflict(error)) throw new SportEventError('That slot already has an event.', 'SEASON_SLOT_TAKEN', 409);
      throw error;
    }
    // Each event's rounds are played in its slots, read back in play order (#2006): one read for them all.
    const slotsByEvent = await this.deps.sportEvents.findSlots(events.map((event) => event.id));
    await this.deps.rounds.createSchedules(events.map((event, index) => ({
      sportEventId: event.id,
      rounds: roundsInSlots(editions[index]?.rounds ?? [], slotsByEvent.get(event.id) ?? []),
    })));
    const tiersByEvent = await this.deps.tiers.createDefaultTiers(sportLeague, events.map((event) => event.id));
    return events.map((event, index): SportEventAdminSummary => {
      const tiers = tiersByEvent.get(event.id) ?? [];
      return {
        event,
        participantCount: 0,
        tierCount: tiers.length,
        slots: slots.filter((slot) => editions[index]?.event.seasonSlotIds?.includes(slot.id)),
        adminCounts: {
          untieredParticipantCount: 0,
          unpricedParticipantCount: 0,
          emptyTierNumbers: tiers.map((tier) => tier.tierNumber),
          contestCount: 0,
        },
      };
    });
  }

  /** The sport league and the sport it belongs to. */
  private async resolveSportLeague(sportLeagueId: string): Promise<{ sportLeague: SportLeague; sport: Sport }> {
    const sportLeague = await this.deps.sportLeagues.findById(sportLeagueId);
    if (!sportLeague) {
      throw new SportEventError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    const sport = (await this.deps.sports.findById(sportLeague.sportId))?.sport;
    if (sport === undefined) {
      throw new SportEventError(`Sport league ${sportLeagueId} belongs to no known sport.`, 'SPORT_NOT_FOUND', 404);
    }
    return { sportLeague, sport };
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** The counts every reader of an event needs, and its slots: three grouped reads for the whole list. */
  private async summarize(events: SportEvent[]): Promise<SportEventSummary[]> {
    const ids = events.map((event) => event.id);
    const [participants, tiers, slots] = await Promise.all([
      this.deps.sportEvents.countParticipants(ids),
      this.deps.sportEvents.countTiers(ids),
      this.deps.sportEvents.findSlots(ids),
    ]);
    return events.map((event) => ({
      event,
      participantCount: participants.get(event.id) ?? 0,
      tierCount: tiers.get(event.id) ?? 0,
      slots: slots.get(event.id) ?? [],
      adminCounts: null,
    }));
  }

  /** Every reader's counts and a root admin's own. */
  private async summarizeForAdmin(events: SportEvent[]): Promise<SportEventAdminSummary[]> {
    const ids = events.map((event) => event.id);
    const [summaries, untiered, unpriced, emptyTiers, contests] = await Promise.all([
      this.summarize(events),
      this.deps.sportEvents.countUntieredActiveParticipants(ids),
      this.deps.sportEvents.countUnpricedActiveParticipants(ids),
      this.deps.sportEvents.findEmptyTierNumbers(ids),
      this.deps.sportEvents.countContests(ids),
    ]);
    return summaries.map((summary) => ({
      ...summary,
      adminCounts: {
        untieredParticipantCount: untiered.get(summary.event.id) ?? 0,
        unpricedParticipantCount: unpriced.get(summary.event.id) ?? 0,
        emptyTierNumbers: emptyTiers.get(summary.event.id) ?? [],
        contestCount: contests.get(summary.event.id) ?? 0,
      },
    }));
  }
}

/** One new edition to create: the event, and its round schedule. */
interface NewEdition {
  event: SportEventCreate;
  rounds: readonly SportEventRoundSchedule[];
}

/** The event's ids at one provider, as the adapter keys it: one at most, since an event has one id per provider. */
function externalIdsAt(event: SportEvent, providerId: string): string[] {
  return event.providerMappings.filter((mapping) => providerSourceIdOf(mapping.providerCode) === providerId).map((mapping) => mapping.externalId);
}

/** The one summary of a single-edition create. */
function onlyOne(summaries: readonly SportEventAdminSummary[]): SportEventAdminSummary {
  const summary = summaries.at(0);
  if (summary === undefined || summaries.length !== 1) throw new Error(`Expected one created event, got ${summaries.length}.`);
  return summary;
}

/**
 * A provider event as a new edition, with the provider's id for it (#2004), on the Season slots its
 * games matched (#2005): its dates are those slots', which are their games'. The rounds follow the
 * dates unless a round count is given, which falls back to sequential days, so `rounds` always
 * matches the rounds created.
 */
function providerEdition(
  input: ProviderEventDetail & {
    externalId: string;
    sportLeagueId: string;
    sportLeagueSeasonId: string;
    providerId: string;
    rounds?: number;
    /** The free slots its games matched, at least one, each with its games' span. */
    plays: ReadonlyArray<{ seasonSlotId: string; startsAt: Date; endsAt: Date }>;
  },
): NewEdition {
  const dates = eventDatesFromSlots(input.plays);
  if (dates === null) throw new Error(`Provider event ${input.externalId} matched no slot.`);
  const schedule = input.rounds === undefined
    ? providerEventRoundSchedule(dates.startDate, dates.endDate)
    : dailyRoundSchedule(input.rounds, dates.startDate);
  return {
    event: {
      providerRef: { providerId: input.providerId, externalId: input.externalId },
      name: input.name,
      venue: input.venue ?? undefined,
      startDate: dates.startDate,
      endDate: dates.endDate ?? undefined,
      status: SportEventStatus.DRAFT,
      // A round per slot when it covers several (#2006).
      rounds: input.plays.length > 1 ? input.plays.length : schedule.length,
      sportLeagueId: input.sportLeagueId,
      sportLeagueSeasonId: input.sportLeagueSeasonId,
      autoLifecycleEnabled: true,
      seasonSlotIds: input.plays.map((play) => play.seasonSlotId),
    },
    rounds: schedule,
  };
}

/** The Season competitions matched slots are in, each once, in the order first matched. */
function competitionsOf(matched: ReadonlyArray<{ slot: SyncSeasonSlot }>): string[] {
  return [...new Set(matched.map(({ slot }) => slot.seasonCompetitionId))];
}

/**
 * Why a provider event not yet linked makes no event (#1821, #2005), or null when it makes one:
 * its start has passed; its games matched no slot; no template lists a slot they matched; or every
 * listed slot they matched already has an event. An event starts at its slots' first game, so
 * once its games match a slot its start is theirs, not the provider event's: a slate whose games
 * are placed by date window starts long before its first windowed game (#2012).
 */
function unplayableReason(
  providerEvent: Pick<ProviderEventDetail, 'startDate'>,
  matched: ReadonlyArray<{ slot: SyncSeasonSlot; play: Pick<ProviderSlotPlay, 'startsAt'> }>,
  free: readonly SyncSeasonSlot[],
  now: Date,
): ProviderSeasonImport['skipped'][number]['reason'] | null {
  const startDate = matched.length === 0
    ? providerEvent.startDate
    : new Date(Math.min(...matched.map(({ play }) => play.startsAt.getTime())));
  if (providerEventStarted({ startDate }, now)) return 'ALREADY_STARTED';
  if (matched.length === 0) return 'NO_SLOT';
  if (!matched.some(({ slot }) => slot.coveredByTemplate)) return 'NO_TEMPLATE';
  if (!free.some((slot) => slot.coveredByTemplate)) return 'SLOT_TAKEN';
  return null;
}

/** The provider's details that differ from the event's; a venue or end it does not send is no change. */
function providerDetailUpdates(
  event: SportEvent,
  providerEvent: ProviderEventDetail,
): Pick<SportEventUpdate, 'name' | 'venue' | 'startDate' | 'endDate'> {
  return {
    // poolmaster-allow-name-match: the sync compares the feed's name with the stored one to update it, not to find a row
    ...(providerEvent.name !== event.name && { name: providerEvent.name }),
    ...(providerEvent.venue !== null && providerEvent.venue !== (event.venue ?? null) && { venue: providerEvent.venue }),
    ...(providerEvent.startDate.getTime() !== event.startDate.getTime() && { startDate: providerEvent.startDate }),
    ...(providerEvent.endDate !== null && providerEvent.endDate.getTime() !== event.endDate?.getTime() && { endDate: providerEvent.endDate }),
  };
}

/**
 * Whether a provider event's start has passed (#1821), the one test every path that creates an
 * event from a provider applies: such an event is never created. A start of exactly now counts
 * as started, as `hasSportEventStarted` counts it.
 */
function providerEventStarted(providerEvent: Pick<ProviderEventDetail, 'startDate'>, now: Date): boolean {
  return providerEvent.startDate.getTime() <= now.getTime();
}

/** Whether two sets of failed check keys are the same, whatever their order. */
function sameCheckKeys(left: readonly ReleaseCheckKey[], right: readonly ReleaseCheckKey[]): boolean {
  return left.length === right.length && left.every((key) => right.includes(key));
}
