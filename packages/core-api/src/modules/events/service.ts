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

import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  EventSeriesRepository,
  SportEventCreate,
  SportEventRoundSchedule,
  SportEventFilters,
  SportEventRepository,
  SportEventUpdate,
  SportLeagueRepository,
  SportRepository,
} from '@poolmaster/shared/db';
import {
  eventSportDefinition,
  sportLeagueDefinitionOf,
  MANUAL_ADMIN_PROVIDER_ID,
  type Sport,
  SportEventStatus,
  SportEventSyncScope,
  type SportEvent,
  type SportLeague,
} from '@poolmaster/shared/domain';
import { deriveGolfTournamentRounds } from '../golf/golf-seeding-algorithm';
import { SportEventError } from './errors';
import { hasSportEventStarted } from './operational-timing';
import type { EventLifecycleService } from './event-lifecycle-service';
import type { SportEventBracketService } from './sport-event-bracket-service';
import { dailyRoundSchedule, type SportEventRoundService } from './sport-event-round-service';
import type { SportEventTierService } from './sport-event-tier-service';

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
  /** Null unless the read asked for them: see `SportEventAdminCounts`. */
  adminCounts: SportEventAdminCounts | null;
}

/** An event summary with the root admin's counts filled in. */
export type SportEventAdminSummary = SportEventSummary & { adminCounts: SportEventAdminCounts };

/** Whether a read counts the root admin's numbers: only a root admin's read does (#1198). */
export interface SportEventReadOptions {
  adminCounts: boolean;
}

export interface CreateSportEventInput {
  /** The tour; the event's series is found or created in it by the event's name. */
  sportLeagueId: string;
  /** The year the edition is branded with. */
  eventYear: number;
  name: string;
  venue?: string;
  location?: string;
  startDate: Date;
  endDate?: Date;
  rounds?: number;
  roundsPar?: number;
  autoLifecycleEnabled?: boolean;
}

export interface ProviderEventDetail {
  name: string;
  venue: string | null;
  startDate: Date;
  endDate: Date | null;
}

/** What a provider event-year import (#385) created, and what it left alone and why. */
export interface ProviderEventYearImport {
  created: SportEventAdminSummary[];
  skipped: Array<{ externalId: string; name: string; reason: 'ALREADY_LINKED' | 'EDITION_EXISTS' }>;
}

/** Shift a date to the same month/day in `date.year + years` (leap-year safe). */
export function shiftYears(date: Date, years: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setUTCFullYear(shifted.getUTCFullYear() + years);
  return shifted;
}

/**
 * The database refusing a second edition of a series in one year — the
 * (eventSeriesId, eventYear) unique constraint, recognised by Prisma's P2002 and the
 * column it names. Duck-typed so the service does not depend on the Prisma client.
 */
function isEditionConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } };
  if (code !== 'P2002') return false;
  const target = JSON.stringify(meta?.target ?? '');
  return target.includes('event_year') || target.includes('eventYear');
}

export interface SportEventServiceDeps {
  sportEvents: SportEventRepository;
  eventSeries: EventSeriesRepository;
  sportLeagues: SportLeagueRepository;
  sports: SportRepository;
  rounds: SportEventRoundService;
  tiers: SportEventTierService;
  bracket: Pick<SportEventBracketService, 'releaseBlockers'>;
  lifecycle: Pick<EventLifecycleService, 'applySportEventStatusTransition' | 'sportEventRescheduled'>;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

/** The statuses whose start moving is told to the leagues on the event (#845 C6). */
const RESCHEDULE_TOLD: readonly SportEventStatus[] = [SportEventStatus.SCHEDULED, SportEventStatus.POSTPONED];

/** An event loaded with only its date starts at noon UTC until its real start time is filled in. */
function isDateOnlyPlaceholder(start: Date): boolean {
  return start.getUTCHours() === 12 && start.getUTCMinutes() === 0 && start.getUTCSeconds() === 0 && start.getUTCMilliseconds() === 0;
}

export class SportEventService {
  constructor(private readonly deps: SportEventServiceDeps) {}

  /**
   * The whole catalog for the filters — narrowed, never paged (§16). A sport, sport league or
   * event year is required (#1180), so the list never reads every event ever with its counts.
   */
  async listEvents(filters: SportEventFilters, options: SportEventReadOptions): Promise<SportEventSummary[]> {
    this.deps.logger?.debug({ action: 'events.list.start', data: { ...filters } }, 'Listing sport events');
    if (filters.sport === undefined && filters.sportLeagueId === undefined && filters.eventYear === undefined) {
      this.deps.logger?.warn({ action: 'events.list.filterRequired', data: { ...filters } }, 'Rejected a sport event list without a sport, sport league or year');
      throw new SportEventError('Choose a sport, a sport league or a year to list events.', 'SPORT_EVENT_FILTER_REQUIRED', 400);
    }
    const events = await this.deps.sportEvents.findAll(filters);
    const summaries = options.adminCounts ? await this.summarizeForAdmin(events) : await this.summarize(events);
    this.deps.logger?.info({ action: 'events.list.success', data: { ...filters, count: events.length } }, 'Listed sport events');
    return summaries;
  }

  /** The event years a sport league has events in, earliest first: what a year picker offers. */
  async listEventYears(sportLeagueId: string, options: { releasedOnly: boolean }): Promise<number[]> {
    return this.deps.sportEvents.findEventYears(sportLeagueId, options);
  }

  /** An admin-authored event: the reserved manual identity, DRAFT, accepting no provider data. */
  async createEvent(input: CreateSportEventInput): Promise<SportEventAdminSummary> {
    const { sportLeague, sport } = await this.resolveSportLeague(input.sportLeagueId);
    const rounds = input.rounds ?? sportLeagueDefinitionOf(sport, sportLeague).defaultRounds;
    const seriesIdByName = await this.resolveSeries(sportLeague, [input.name]);

    const summary = onlyOne(await this.createEditions(sportLeague, [{
      event: {
        externalId: `manual-${randomUUID()}`,
        providerId: MANUAL_ADMIN_PROVIDER_ID,
        sport,
        name: input.name,
        venue: input.venue,
        location: input.location,
        startDate: input.startDate,
        endDate: input.endDate,
        status: SportEventStatus.DRAFT,
        rounds,
        roundsPar: input.roundsPar,
        eventSeriesId: seriesIdOf(seriesIdByName, input.name),
        eventYear: input.eventYear,
        syncScope: SportEventSyncScope.NONE,
        autoLifecycleEnabled: input.autoLifecycleEnabled ?? true,
      },
      rounds: dailyRoundSchedule(rounds, input.startDate),
    }]));

    this.deps.logger?.info(
      { sportEventId: summary.event.id, sportLeagueId: sportLeague.id, eventSeriesId: summary.event.eventSeriesId, eventYear: input.eventYear, rounds },
      'Created sport event',
    );
    return summary;
  }

  /**
   * An event created straight from a browsed provider event (plans/124 §4.4a), pre-linked
   * to that provider for scores (SCORES_ONLY). The field is not touched; loading it is
   * its own action. 409 EXTERNAL_EVENT_ALREADY_LINKED when another event holds the identity.
   */
  async createEventFromProviderEvent(input: {
    sportLeagueId: string;
    eventYear: number;
    providerId: string;
    externalId: string;
    rounds?: number;
    providerEvent: ProviderEventDetail;
  }): Promise<SportEventAdminSummary> {
    const { sportLeague, sport } = await this.resolveSportLeague(input.sportLeagueId);
    if (await this.deps.sportEvents.findByProviderRef(input.providerId, input.externalId)) {
      throw new SportEventError(
        `Another sport event is already linked to ${input.providerId}/${input.externalId}.`,
        'EXTERNAL_EVENT_ALREADY_LINKED',
        409,
      );
    }
    const seriesIdByName = await this.resolveSeries(sportLeague, [input.providerEvent.name]);
    const edition = providerEdition(sport, seriesIdByName, { ...input, ...input.providerEvent, externalId: input.externalId });
    const summary = onlyOne(await this.createEditions(sportLeague, [edition]));

    this.deps.logger?.info(
      { sportEventId: summary.event.id, sportLeagueId: sportLeague.id, eventYear: input.eventYear, providerId: input.providerId, externalId: input.externalId, rounds: edition.rounds.length },
      'Created sport event from provider event',
    );
    return summary;
  }

  /**
   * #385 — a tour's provider slate for one year, created in one action, in a fixed number of
   * queries however long the slate (#1253). Each event is created and linked exactly as a single
   * browse-and-create would be. Events PoolMaster already has are skipped rather than refused,
   * so the import can be run again: one already linked to the provider event, or a series that
   * already has an edition that year (an admin-authored one, say, or an earlier event of the
   * same name in this slate). An edition another admin creates while the import runs is not
   * skipped: it refuses the whole import with 409, and running it again skips that event.
   */
  async importProviderEventYear(input: {
    sportLeagueId: string;
    eventYear: number;
    providerId: string;
    providerEvents: ReadonlyArray<ProviderEventDetail & { externalId: string }>;
  }): Promise<ProviderEventYearImport> {
    const { sportLeague, sport } = await this.resolveSportLeague(input.sportLeagueId);
    const linked = new Set((await this.deps.sportEvents.findByProviderRefs(
      input.providerId,
      input.providerEvents.map((providerEvent) => providerEvent.externalId),
    )).map((event) => event.externalId));
    const unlinked = input.providerEvents.filter((providerEvent) => !linked.has(providerEvent.externalId));
    const seriesIdByName = await this.resolveSeries(sportLeague, unlinked.map((providerEvent) => providerEvent.name));
    const seriesWithEdition = new Set(unlinked.length === 0
      ? []
      : (await this.deps.sportEvents.findAll({ sportLeagueId: sportLeague.id, eventYear: input.eventYear })).map((event) => event.eventSeriesId));

    const editions: NewEdition[] = [];
    const skipped: ProviderEventYearImport['skipped'] = [];
    for (const providerEvent of input.providerEvents) {
      const { externalId, name } = providerEvent;
      if (linked.has(externalId)) {
        skipped.push({ externalId, name, reason: 'ALREADY_LINKED' });
        continue;
      }
      const eventSeriesId = seriesIdOf(seriesIdByName, name);
      if (seriesWithEdition.has(eventSeriesId)) {
        skipped.push({ externalId, name, reason: 'EDITION_EXISTS' });
        continue;
      }
      seriesWithEdition.add(eventSeriesId);
      editions.push(providerEdition(sport, seriesIdByName, { ...providerEvent, eventYear: input.eventYear, providerId: input.providerId }));
    }
    const created = await this.createEditions(sportLeague, editions);

    this.deps.logger?.info(
      { sportLeagueId: input.sportLeagueId, eventYear: input.eventYear, providerId: input.providerId, createdCount: created.length, skippedCount: skipped.length },
      'Imported provider event year',
    );
    return { created, skipped };
  }

  /**
   * plans/124 §4.2a, reshaped by plans/147 — clone a sport league's calendar for one event
   * year forward to another. It used to clone a season object; it is still one operation, now
   * query-shaped rather than object-shaped. Each source event is re-created through
   * `createEvent` with name/venue/location/rounds/roundsPar/autoLifecycleEnabled copied and every date
   * shifted by the year difference, so it lands in the same series as next year's edition.
   * Never a row copy: field, tiers, prices, scores and provider link stay with the source.
   * The sport league's current event year does not change.
   *
   * 422 EVENT_YEAR_HAS_NO_EVENTS when the source year is empty; 409 EVENT_YEAR_NOT_EMPTY when
   * the target year already has events for this sport league — the analogue of the season
   * that already existed, and refused whole rather than half-cloned.
   */
  async cloneEventYear(input: {
    sportLeagueId: string;
    eventYear: number;
    targetYear?: number;
  }): Promise<SportEventAdminSummary[]> {
    const { sportLeague, sport } = await this.resolveSportLeague(input.sportLeagueId);
    const targetYear = input.targetYear ?? input.eventYear + 1;
    const shift = targetYear - input.eventYear;

    const sourceEvents = await this.deps.sportEvents.findAll({ sportLeagueId: sportLeague.id, eventYear: input.eventYear });
    if (sourceEvents.length === 0) {
      throw new SportEventError(
        `${sportLeague.name} has no events in ${input.eventYear} to clone.`,
        'EVENT_YEAR_HAS_NO_EVENTS',
        422,
      );
    }
    const targetCount = (await this.deps.sportEvents.countBySportLeagues([sportLeague.id], { eventYear: targetYear }))
      .get(sportLeague.id) ?? 0;
    if (targetCount > 0) {
      throw new SportEventError(
        `${sportLeague.name} already has ${targetCount} event(s) in ${targetYear}.`,
        'EVENT_YEAR_NOT_EMPTY',
        409,
      );
    }

    const seriesIdByName = await this.resolveSeries(sportLeague, sourceEvents.map((event) => event.name));
    const defaultRounds = sportLeagueDefinitionOf(sport, sportLeague).defaultRounds;
    const cloned = await this.createEditions(sportLeague, sourceEvents.map((event) => {
      const startDate = shiftYears(event.startDate, shift);
      const rounds = event.rounds ?? defaultRounds;
      return {
        event: {
          externalId: `manual-${randomUUID()}`,
          providerId: MANUAL_ADMIN_PROVIDER_ID,
          sport,
          name: event.name,
          venue: event.venue,
          location: event.location,
          startDate,
          endDate: event.endDate ? shiftYears(event.endDate, shift) : undefined,
          status: SportEventStatus.DRAFT,
          rounds,
          roundsPar: event.roundsPar,
          eventSeriesId: seriesIdOf(seriesIdByName, event.name),
          eventYear: targetYear,
          syncScope: SportEventSyncScope.NONE,
          autoLifecycleEnabled: event.autoLifecycleEnabled,
        },
        rounds: dailyRoundSchedule(rounds, startDate),
      };
    }));
    this.deps.logger?.info(
      { sportLeagueId: sportLeague.id, eventYear: input.eventYear, targetYear, clonedEventCount: cloned.length },
      'Cloned event year calendar',
    );
    return cloned;
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
    // Three writes, not one transaction: a failure after the first leaves the rounds behind the
    // event's new dates. The round writes only reject a round the event lacks, and they read the
    // event's rounds first, so in practice they don't fail here.
    await this.deps.sportEvents.update(sportEventId, updates);
    const startDate = updates.startDate ?? startedAt;
    const shiftMs = startDate.getTime() - startedAt.getTime();
    if (shiftMs !== 0) {
      await this.deps.rounds.shiftSchedule(sportEventId, shiftMs);
    }
    if (updates.rounds && updates.rounds > (roundCount ?? 0)) {
      await this.deps.rounds.extendTo({ sportEventId, rounds: updates.rounds, startDate });
    }
    // A draft's commissioners can't see it yet, and a started event's picks are closed.
    if (shiftMs !== 0 && RESCHEDULE_TOLD.includes(status) && options.tellMembers) {
      await this.deps.lifecycle.sportEventRescheduled(await this.requireEvent(sportEventId), startedAt);
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
   * bracket, its bracket is incomplete (#698).
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
    if (hasSportEventStarted(event, this.now())) {
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
    const missing = await this.releaseBlockersFor(summary);
    if (missing.length > 0) {
      this.deps.logger?.warn(
        {
          sportEventId,
          loadedParticipantCount: summary.loadedParticipantCount,
          untieredParticipantCount: summary.adminCounts.untieredParticipantCount,
          unpricedParticipantCount: summary.adminCounts.unpricedParticipantCount,
          emptyTierLabels: summary.adminCounts.emptyTierLabels,
          isPriced: summary.event.pricingConfig !== undefined,
        },
        'Refused to release a sport event that is not ready',
      );
      throw new SportEventError(
        `Sport event ${sportEventId} is not ready to release: ${missing.join('; ')}.`,
        'SPORT_EVENT_NOT_READY',
        422,
      );
    }

    await this.deps.lifecycle.applySportEventStatusTransition({
      sportEventId,
      toStatus: SportEventStatus.SCHEDULED,
      actor: { type: 'ROOT_ADMIN' },
      release: true,
    });
    this.deps.logger?.info({ sportEventId }, 'Released sport event for contests');
    return this.requireAdminSummary(sportEventId);
  }

  /** Deletes an event with its rounds, tiers and field. 409 EVENT_HAS_CONTESTS while any contest runs on it. */
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
    return this.releaseBlockersFor(await this.requireAdminSummary(sportEventId));
  }

  private async releaseBlockersFor(summary: SportEventAdminSummary): Promise<string[]> {
    return [...describeReleaseBlockers(summary), ...await this.deps.bracket.releaseBlockers(summary.event)];
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
    const [summary] = options.adminCounts ? await this.summarizeForAdmin([event]) : await this.summarize([event]);
    return summary;
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
   * edition in the year; then none of the events is created.
   */
  private async createEditions(sportLeague: SportLeague, editions: readonly NewEdition[]): Promise<SportEventAdminSummary[]> {
    if (editions.length === 0) return [];
    let events: SportEvent[];
    try {
      events = await this.deps.sportEvents.createMany(editions.map((edition) => edition.event));
    } catch (error) {
      if (isEditionConflict(error)) {
        // Every caller creates editions of one year.
        const [first] = editions;
        throw new SportEventError(
          editions.length === 1
            ? `"${first.event.name}" already has an edition in ${first.event.eventYear}.`
            : `One of these events already has an edition in ${first.event.eventYear}; none were created.`,
          'EVENT_EDITION_ALREADY_EXISTS',
          409,
        );
      }
      throw error;
    }
    await this.deps.rounds.createSchedules(events.map((event, index) => ({ sportEventId: event.id, rounds: editions[index]?.rounds ?? [] })));
    const tiersByEvent = await this.deps.tiers.createDefaultTiers(events.map((event) => ({
      sportEventId: event.id,
      definition: eventSportDefinition(event),
      leagueTierCount: sportLeague.tierCount,
    })));
    return events.map((event): SportEventAdminSummary => {
      const tiers = tiersByEvent.get(event.id) ?? [];
      return {
        event,
        loadedParticipantCount: 0,
        tierCount: tiers.length,
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

  /** The counts every reader of an event needs: two grouped counts for the whole list. */
  private async summarize(events: SportEvent[]): Promise<SportEventSummary[]> {
    const ids = events.map((event) => event.id);
    const [participants, tiers] = await Promise.all([
      this.deps.sportEvents.countParticipants(ids),
      this.deps.sportEvents.countTiers(ids),
    ]);
    return events.map((event) => ({
      event,
      loadedParticipantCount: participants.get(event.id) ?? 0,
      tierCount: tiers.get(event.id) ?? 0,
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

/** What still stops a DRAFT event being released, in words an admin can act on. */
function describeReleaseBlockers(summary: SportEventAdminSummary): string[] {
  const blockers: string[] = [];
  const { untieredParticipantCount, unpricedParticipantCount, emptyTierLabels } = summary.adminCounts;
  if (summary.loadedParticipantCount === 0) {
    blockers.push('its field is not loaded');
  }
  if (untieredParticipantCount > 0) {
    blockers.push(`${untieredParticipantCount} active participant(s) have no tier`);
  }
  const { participant } = eventSportDefinition(summary.event).vocabulary;
  for (const label of emptyTierLabels) {
    blockers.push(`${label} has no ${participant.many}`);
  }
  if (!summary.event.pricingConfig) {
    blockers.push('its prices have not been assigned');
  } else if (unpricedParticipantCount > 0) {
    blockers.push(`${unpricedParticipantCount} active participant(s) have no price`);
  }
  return blockers;
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

/** The one summary of a single-edition create. */
function onlyOne(summaries: readonly SportEventAdminSummary[]): SportEventAdminSummary {
  const summary = summaries.at(0);
  if (summary === undefined || summaries.length !== 1) throw new Error(`Expected one created event, got ${summaries.length}.`);
  return summary;
}

/**
 * A provider event as a new edition, pre-linked to its provider for scores (SCORES_ONLY). The
 * rounds follow its dates unless a round count is given, which falls back to sequential days, so
 * `rounds` always matches the rounds created.
 */
function providerEdition(
  sport: Sport,
  seriesIdByName: ReadonlyMap<string, string>,
  input: ProviderEventDetail & { externalId: string; eventYear: number; providerId: string; rounds?: number },
): NewEdition {
  const schedule = input.rounds === undefined
    ? deriveGolfTournamentRounds(input.startDate, input.endDate)
    : dailyRoundSchedule(input.rounds, input.startDate);
  return {
    event: {
      externalId: input.externalId,
      providerId: input.providerId,
      sport,
      name: input.name,
      venue: input.venue ?? undefined,
      startDate: input.startDate,
      endDate: input.endDate ?? undefined,
      status: SportEventStatus.DRAFT,
      rounds: schedule.length,
      eventSeriesId: seriesIdOf(seriesIdByName, input.name),
      eventYear: input.eventYear,
      syncScope: SportEventSyncScope.SCORES_ONLY,
      autoLifecycleEnabled: true,
    },
    rounds: schedule,
  };
}
