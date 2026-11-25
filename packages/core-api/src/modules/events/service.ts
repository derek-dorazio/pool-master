/**
 * SportEventService — the SportEvent operation set (#236): list, read, create, update and
 * delete one event. Before #236 this was split between `listEvents` here and eleven
 * golf-named operations over the same rows in `GolfTournamentService`.
 *
 * An event is one edition of an EventSeries, in one event year (plans/147). Its sport
 * comes from the series' sport league (series → sport league → sport), never from the
 * caller. Creation is where the sport matters: golf seeds four rounds (or the rounds its
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
  EventSeriesRepository,
  SportEventCreate,
  SportEventRoundSchedule,
  SportEventFilters,
  SportEventRepository,
  SportEventUpdate,
  SportLeagueRepository,
  SportLeagueSeasonRepository,
  SportRepository,
} from '@poolmaster/shared/db';
import {
  AutoReleaseCheckOutcome,
  blocksManualRelease,
  eventDatesFromSlots,
  eventPlaysMatches,
  eventSportDefinition,
  isProviderSyncedEvent,
  isWithinAutoReleaseWindow,
  providerSourceIdOf,
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
  sportLeagueDefinitionOf,
  sportVocabulary,
} from '@poolmaster/shared/domain';
import { SportEventError } from './errors';
import { describeFailedReleaseCheck, evaluateReleaseChecks, failedReleaseChecks } from './release-checks';
import type { EventLifecycleService } from './event-lifecycle-service';
import type { SportEventBracketService } from './sport-event-bracket-service';
import { dailyRoundSchedule, providerEventRoundSchedule, type SportEventRoundService } from './sport-event-round-service';
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
  emptyTierLabels: string[];
  contestCount: number;
}

/** An event with the counts every reader needs, and a root admin's own counts when asked for. */
export interface SportEventSummary {
  event: SportEvent;
  loadedParticipantCount: number;
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
  /** The test slot it covers; its Season and league are the event's, and its dates the event's. */
  seasonSlotId: string;
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
}

/** What a provider Season import (#385, #2003) created, and what it left alone and why. */
export interface ProviderSeasonImport {
  created: SportEventAdminSummary[];
  skipped: Array<{ externalId: string; name: string; reason: 'ALREADY_LINKED' | 'ALREADY_STARTED' | 'EDITION_EXISTS' }>;
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

/**
 * The database refusing a second edition of a series in one Season — the
 * (eventSeriesId, sportLeagueSeasonId) unique constraint, recognised by Prisma's P2002 and the
 * column it names. Duck-typed so the service does not depend on the Prisma client.
 */
function uniqueViolationTarget(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } };
  return code === 'P2002' ? JSON.stringify(meta?.target ?? '') : null;
}

function isEditionConflict(error: unknown): boolean {
  const target = uniqueViolationTarget(error);
  return target !== null && (target.includes('sport_league_season_id') || target.includes('sportLeagueSeasonId'));
}

/** The database refusing a second event on one Season slot (#2004): the slot's unique key. */
function isSlotConflict(error: unknown): boolean {
  const target = uniqueViolationTarget(error);
  return target !== null && (target.includes('sport_league_season_phase_slot_id') || target.includes('sportLeagueSeasonPhaseSlotId') || target.includes('sport_event_slots_season_slot_key'));
}

export interface SportEventServiceDeps {
  sportEvents: SportEventRepository;
  eventSeries: EventSeriesRepository;
  sportLeagues: SportLeagueRepository;
  sports: SportRepository;
  /** The Season slot a test event is made on (#2004). */
  seasons: Pick<SportLeagueSeasonRepository, 'findSlot'>;
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
   * An admin-authored event: DRAFT, with no provider id, so no provider syncs it (#2004), in its
   * league's current Season (#2003).
   */
  /**
   * A test event on a test slot (#2004, plan §2): only a test slot takes an event made by hand,
   * since the sync makes every other. The slot must be free and in its league's current Season;
   * the event's dates are the slot's, and it gets its league's default round count. 404
   * SEASON_SLOT_NOT_FOUND; 422 SEASON_SLOT_NOT_TEST, SEASON_SLOT_NOT_CURRENT; 409
   * SEASON_SLOT_TAKEN, EVENT_EDITION_ALREADY_EXISTS.
   */
  async createEvent(input: CreateSportEventInput): Promise<SportEventAdminSummary> {
    const found = await this.deps.seasons.findSlot(input.seasonSlotId);
    if (found === null) throw new SportEventError(`Season slot ${input.seasonSlotId} was not found.`, 'SEASON_SLOT_NOT_FOUND', 404);
    const { slot } = found;
    if (!slot.isTestData) throw new SportEventError('Only a test slot takes an event made by hand; the sync makes every other.', 'SEASON_SLOT_NOT_TEST', 422);
    const { sportLeague, sport } = await this.resolveSportLeague(found.sportLeagueId);
    if (found.sportLeagueSeasonId !== sportLeague.currentSeasonId) {
      throw new SportEventError(`Season slot ${slot.id} is not in ${sportLeague.name}'s current Season.`, 'SEASON_SLOT_NOT_CURRENT', 422);
    }
    if (found.sportEventId !== null) throw new SportEventError(`Season slot ${slot.id} already has an event.`, 'SEASON_SLOT_TAKEN', 409);
    // A test slot is always made with a start (createTestSlot), so its dates are never null.
    const dates = eventDatesFromSlots([slot]);
    if (dates === null) throw new Error(`Season slot ${slot.id} has no start.`);
    const rounds = sportLeagueDefinitionOf(sport, sportLeague).defaultRounds;
    const seriesIdByName = await this.resolveSeries(sportLeague, [input.name]);

    const summary = onlyOne(await this.createEditions(sportLeague, [{
      event: {
        name: input.name,
        venue: input.venue,
        location: input.location,
        startDate: dates.startDate,
        endDate: dates.endDate ?? undefined,
        status: SportEventStatus.DRAFT,
        rounds,
        eventSeriesId: seriesIdOf(seriesIdByName, input.name),
        sportLeagueSeasonId: found.sportLeagueSeasonId,
        autoLifecycleEnabled: input.autoLifecycleEnabled ?? true,
        seasonSlotIds: [slot.id],
      },
      rounds: dailyRoundSchedule(rounds, dates.startDate),
    }], [slot]));

    this.deps.logger?.info(
      { sportEventId: summary.event.id, sportLeagueId: sportLeague.id, sportLeagueSeasonId: found.sportLeagueSeasonId, seasonSlotId: slot.id, rounds },
      'Created test sport event',
    );
    return summary;
  }

  /**
   * #385, #2003 — one Season's provider slate, created in that Season in one action, in a fixed number of
   * queries however long the slate (#1253), each with the provider's id for it (#2004). Events PoolMaster already has are skipped rather than refused,
   * so the import can be run again: one already linked to the provider event, or a series that
   * already has an edition that Season (an admin-authored one, say, or an earlier event of the
   * same name in this slate). A provider event whose start has passed is skipped too (#1821):
   * created now it would be a draft nobody can release or play. One already linked is still
   * reported as linked, and keeps updating through `keepProviderEventsCurrent`. An edition another admin creates while the import runs is not
   * skipped: it refuses the whole import with 409, and running it again skips that event.
   */
  async importProviderSeason(input: {
    sportLeagueId: string;
    sportLeagueSeasonId: string;
    providerId: string;
    providerEvents: ReadonlyArray<ProviderEventDetail & { externalId: string }>;
  }): Promise<ProviderSeasonImport> {
    const { sportLeague } = await this.resolveSportLeague(input.sportLeagueId);
    const now = this.now();
    const linked = new Set((await this.deps.sportEvents.findByProviderRefs(
      input.providerId,
      input.providerEvents.map((providerEvent) => providerEvent.externalId),
    )).flatMap((event) => externalIdsAt(event, input.providerId)));
    const unlinked = input.providerEvents.filter((providerEvent) => !linked.has(providerEvent.externalId) && !providerEventStarted(providerEvent, now));
    const seriesIdByName = await this.resolveSeries(sportLeague, unlinked.map((providerEvent) => providerEvent.name));
    const seriesWithEdition = new Set(unlinked.length === 0
      ? []
      : (await this.deps.sportEvents.findAll({ sportLeagueId: sportLeague.id, sportLeagueSeasonId: input.sportLeagueSeasonId })).map((event) => event.eventSeriesId));

    const editions: NewEdition[] = [];
    const skipped: ProviderSeasonImport['skipped'] = [];
    for (const providerEvent of input.providerEvents) {
      const { externalId, name } = providerEvent;
      if (linked.has(externalId)) {
        skipped.push({ externalId, name, reason: 'ALREADY_LINKED' });
        continue;
      }
      if (providerEventStarted(providerEvent, now)) {
        skipped.push({ externalId, name, reason: 'ALREADY_STARTED' });
        continue;
      }
      const eventSeriesId = seriesIdOf(seriesIdByName, name);
      if (seriesWithEdition.has(eventSeriesId)) {
        skipped.push({ externalId, name, reason: 'EDITION_EXISTS' });
        continue;
      }
      seriesWithEdition.add(eventSeriesId);
      editions.push(providerEdition(seriesIdByName, { ...providerEvent, sportLeagueSeasonId: input.sportLeagueSeasonId, providerId: input.providerId }));
    }
    const created = await this.createEditions(sportLeague, editions);

    this.deps.logger?.info(
      {
        sportLeagueId: input.sportLeagueId,
        sportLeagueSeasonId: input.sportLeagueSeasonId,
        providerId: input.providerId,
        createdCount: created.length,
        skippedCount: skipped.length,
        alreadyStartedCount: skipped.filter((row) => row.reason === 'ALREADY_STARTED').length,
      },
      'Imported provider Season',
    );
    return { created, skipped };
  }

  /**
   * #1727 (ADR 0011) — a synced sport league's events keep their provider's name, venue and dates.
   * For each provider event already linked to one of the league's events, the details its status
   * still lets change (`PROVIDER_DETAILS_BY_STATUS`) are written where they differ, through
   * `updateEvent`: the admin's own path, so a moved start shifts the rounds and tells the
   * leagues as an admin's move would, and the lifecycle scheduler then moves the status on the new
   * dates. The provider wins over an admin's edit (`rules/architecture-rules.md` §4). A venue or end
   * the provider does not send is left as it is, not cleared. One read for the events, then one
   * update per event that changed; an update that fails is logged and the rest still go.
   */
  async keepProviderEventsCurrent(input: {
    sportLeagueId: string;
    providerId: string;
    providerEvents: ReadonlyArray<ProviderEventDetail & { externalId: string }>;
  }): Promise<ProviderEventDetailsChange[]> {
    const linked = await this.deps.sportEvents.findByProviderRefs(
      input.providerId,
      input.providerEvents.map((providerEvent) => providerEvent.externalId),
    );
    const providerEventById = new Map(input.providerEvents.map((providerEvent) => [providerEvent.externalId, providerEvent]));
    const changes: ProviderEventDetailsChange[] = [];
    for (const event of linked) {
      const externalId = externalIdsAt(event, input.providerId).at(0);
      const providerEvent = externalId === undefined ? undefined : providerEventById.get(externalId);
      if (externalId === undefined || !providerEvent || event.sportLeagueId !== input.sportLeagueId) continue;
      const updates = providerDetailUpdates(event, providerEvent);
      const changed = PROVIDER_DETAILS_BY_STATUS[event.status].filter((field) => updates[field] !== undefined);
      if (changed.length === 0) continue;
      try {
        await this.updateEvent(event.id, Object.fromEntries(changed.map((field) => [field, updates[field]])), { tellMembers: true });
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
    const { startDate: startedAt, rounds: roundCount, status } = await this.requireEvent(sportEventId);
    if ((updates.startDate !== undefined || updates.endDate !== undefined)
      && ((await this.deps.sportEvents.findSlots([sportEventId])).get(sportEventId) ?? []).length > 0) {
      throw new SportEventError('This event\'s dates come from its Season slots.', 'EVENT_DATES_FROM_SLOTS', 422);
    }
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
    await this.release(sportEventId);
    // The admin's judgement replaces the automatic one: no stored hold outlives the release.
    await this.deps.sportEvents.recordAutoReleaseCheck(sportEventId, null);
    return this.requireAdminSummary(sportEventId);
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
  private async release(sportEventId: string): Promise<void> {
    await this.deps.lifecycle.applySportEventStatusTransition({
      sportEventId,
      toStatus: SportEventStatus.SCHEDULED,
      actor: { type: 'ROOT_ADMIN' },
      release: true,
    });
    this.deps.logger?.info({ sportEventId }, 'Released sport event for contests');
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
      loadedParticipantCount: summary.loadedParticipantCount,
      untieredParticipantCount: summary.adminCounts.untieredParticipantCount,
      emptyTierLabels: summary.adminCounts.emptyTierLabels,
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

  /** The sport league's series of these names, each created on first use, by name. */
  private async resolveSeries(sportLeague: SportLeague, names: readonly string[]): Promise<Map<string, string>> {
    const series = await this.deps.eventSeries.findOrCreateMany(sportLeague.id, [...new Set(names)]);
    return new Map(series.map((row) => [row.name, row.id]));
  }

  /**
   * Creates new editions in a fixed number of queries, however many (#1253): the events in one
   * insert, then every event's rounds and default tiers in one insert each. A new event has no
   * field, no contests and every tier empty, so its summary is built from what was written
   * rather than read back. 409 EVENT_EDITION_ALREADY_EXISTS when a series already has an
   * edition in the Season; then none of the events is created.
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
      if (isEditionConflict(error)) {
        // Every caller creates editions of one Season.
        const [first] = editions;
        throw new SportEventError(
          editions.length === 1
            ? `"${first.event.name}" already has an edition in this Season.`
            : 'One of these events already has an edition in this Season; none were created.',
          'EVENT_EDITION_ALREADY_EXISTS',
          409,
        );
      }
      throw error;
    }
    await this.deps.rounds.createSchedules(events.map((event, index) => ({ sportEventId: event.id, rounds: editions[index]?.rounds ?? [] })));
    const tiersByEvent = await this.deps.tiers.createDefaultTiers(sportLeague, events.map((event) => event.id));
    return events.map((event, index): SportEventAdminSummary => {
      const tiers = tiersByEvent.get(event.id) ?? [];
      return {
        event,
        loadedParticipantCount: 0,
        tierCount: tiers.length,
        slots: slots.filter((slot) => editions[index]?.event.seasonSlotIds?.includes(slot.id)),
        adminCounts: {
          untieredParticipantCount: 0,
          unpricedParticipantCount: 0,
          emptyTierLabels: tiers.map((tier) => tier.label),
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
      loadedParticipantCount: participants.get(event.id) ?? 0,
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
      this.deps.sportEvents.findEmptyTierLabels(ids),
      this.deps.sportEvents.countContests(ids),
    ]);
    return summaries.map((summary) => ({
      ...summary,
      adminCounts: {
        untieredParticipantCount: untiered.get(summary.event.id) ?? 0,
        unpricedParticipantCount: unpriced.get(summary.event.id) ?? 0,
        emptyTierLabels: emptyTiers.get(summary.event.id) ?? [],
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

/** The id of the series of this name, which `resolveSeries` found or created. */
function seriesIdOf(seriesIdByName: ReadonlyMap<string, string>, name: string): string {
  const id = seriesIdByName.get(name);
  if (id === undefined) throw new Error(`No event series "${name}" was found or created.`);
  return id;
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
 * A provider event as a new edition, with the provider's id for it (#2004). The rounds follow its
 * dates unless a round count is given, which falls back to sequential days, so
 * `rounds` always matches the rounds created.
 */
function providerEdition(
  seriesIdByName: ReadonlyMap<string, string>,
  input: ProviderEventDetail & { externalId: string; sportLeagueSeasonId: string; providerId: string; rounds?: number },
): NewEdition {
  const schedule = input.rounds === undefined
    ? providerEventRoundSchedule(input.startDate, input.endDate)
    : dailyRoundSchedule(input.rounds, input.startDate);
  return {
    event: {
      providerRef: { providerId: input.providerId, externalId: input.externalId },
      name: input.name,
      venue: input.venue ?? undefined,
      startDate: input.startDate,
      endDate: input.endDate ?? undefined,
      status: SportEventStatus.DRAFT,
      rounds: schedule.length,
      eventSeriesId: seriesIdOf(seriesIdByName, input.name),
      sportLeagueSeasonId: input.sportLeagueSeasonId,
      autoLifecycleEnabled: true,
    },
    rounds: schedule,
  };
}

/** The provider's details that differ from the event's; a venue or end it does not send is no change. */
function providerDetailUpdates(
  event: SportEvent,
  providerEvent: ProviderEventDetail,
): Pick<SportEventUpdate, 'name' | 'venue' | 'startDate' | 'endDate'> {
  return {
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
