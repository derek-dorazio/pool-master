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
  SportEventFilters,
  SportEventRepository,
  SportEventUpdate,
  SportLeagueRepository,
  SportRepository,
} from '@poolmaster/shared/db';
import {
  MANUAL_ADMIN_PROVIDER_ID,
  Sport,
  SportEventStatus,
  SportEventSyncScope,
  type SportEvent,
  type SportLeague,
} from '@poolmaster/shared/domain';
import { deriveGolfTournamentRounds } from '../golf/golf-seeding-algorithm';
import { SportEventError } from './errors';
import { hasSportEventStarted } from './operational-timing';
import type { EventLifecycleService } from './event-lifecycle-service';
import type { SportEventRoundService } from './sport-event-round-service';
import type { SportEventTierService } from './sport-event-tier-service';

const GOLF_DEFAULT_ROUNDS = 4;

/** An event with the counts its readers derive readiness and deletability from. */
export interface SportEventSummary {
  event: SportEvent;
  loadedParticipantCount: number;
  /** Active participants with no tier: a DRAFT event can't be released while any remain. */
  untieredParticipantCount: number;
  tierCount: number;
  contestCount: number;
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
  created: SportEventSummary[];
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
  lifecycle: Pick<EventLifecycleService, 'applySportEventStatusTransition'>;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

export class SportEventService {
  constructor(private readonly deps: SportEventServiceDeps) {}

  /** The whole catalog for the filters — narrowed, never paged (§16). */
  async listEvents(filters: SportEventFilters): Promise<SportEventSummary[]> {
    this.deps.logger?.debug({ action: 'events.list.start', data: { ...filters } }, 'Listing sport events');
    const events = await this.deps.sportEvents.findAll(filters);
    const summaries = await this.summarize(events);
    this.deps.logger?.info({ action: 'events.list.success', data: { ...filters, count: events.length } }, 'Listed sport events');
    return summaries;
  }

  async getEvent(sportEventId: string): Promise<SportEventSummary | null> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event) return null;
    const [summary] = await this.summarize([event]);
    return summary;
  }

  /** An admin-authored event: the reserved manual identity, DRAFT, accepting no provider data. */
  async createEvent(input: CreateSportEventInput): Promise<SportEventSummary> {
    const { sportLeague, sport } = await this.resolveSportLeague(input.sportLeagueId);
    const rounds = input.rounds ?? GOLF_DEFAULT_ROUNDS;
    const eventSeries = await this.deps.eventSeries.findOrCreate(sportLeague.id, input.name);

    const event = await this.createEdition({
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
      eventSeriesId: eventSeries.id,
      eventYear: input.eventYear,
      syncScope: SportEventSyncScope.NONE,
      autoLifecycleEnabled: input.autoLifecycleEnabled ?? true,
    });
    await this.deps.rounds.ensureRounds({ sportEventId: event.id, rounds, startDate: input.startDate });
    await this.deps.tiers.ensureDefaultTiers(event.id);

    this.deps.logger?.info(
      { sportEventId: event.id, sportLeagueId: sportLeague.id, eventSeriesId: eventSeries.id, eventYear: input.eventYear, rounds },
      'Created sport event',
    );
    return this.requireSummary(event.id);
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
  }): Promise<SportEventSummary> {
    const { sportLeague, sport } = await this.resolveSportLeague(input.sportLeagueId);
    if (await this.deps.sportEvents.findByProviderRef(input.providerId, input.externalId)) {
      throw new SportEventError(
        `Another sport event is already linked to ${input.providerId}/${input.externalId}.`,
        'EXTERNAL_EVENT_ALREADY_LINKED',
        409,
      );
    }
    const { providerEvent } = input;
    const eventSeries = await this.deps.eventSeries.findOrCreate(sportLeague.id, providerEvent.name);
    // The derived schedule applies only when no round count was given; an explicit count
    // falls back to sequential days, so `rounds` always matches the rounds created.
    const derived = deriveGolfTournamentRounds(providerEvent.startDate, providerEvent.endDate);
    const rounds = input.rounds ?? derived.length;

    const event = await this.createEdition({
      externalId: input.externalId,
      providerId: input.providerId,
      sport,
      name: providerEvent.name,
      venue: providerEvent.venue ?? undefined,
      startDate: providerEvent.startDate,
      endDate: providerEvent.endDate ?? undefined,
      status: SportEventStatus.DRAFT,
      rounds,
      eventSeriesId: eventSeries.id,
      eventYear: input.eventYear,
      syncScope: SportEventSyncScope.SCORES_ONLY,
      autoLifecycleEnabled: true,
    });
    if (input.rounds === undefined) {
      await this.deps.rounds.createFromSchedule(event.id, derived);
    } else {
      await this.deps.rounds.ensureRounds({ sportEventId: event.id, rounds, startDate: providerEvent.startDate });
    }
    await this.deps.tiers.ensureDefaultTiers(event.id);

    this.deps.logger?.info(
      { sportEventId: event.id, sportLeagueId: sportLeague.id, eventYear: input.eventYear, providerId: input.providerId, externalId: input.externalId, rounds },
      'Created sport event from provider event',
    );
    return this.requireSummary(event.id);
  }

  /**
   * #385 — a tour's provider slate for one year, created in one action. Each event goes
   * through `createEventFromProviderEvent`, so it is created and linked exactly as a single
   * browse-and-create would be. Events PoolMaster already has are skipped rather than
   * refused, so the import can be run again: one already linked to the provider event, or
   * a series that already has an edition that year (an admin-authored one, say).
   */
  async importProviderEventYear(input: {
    sportLeagueId: string;
    eventYear: number;
    providerId: string;
    providerEvents: ReadonlyArray<ProviderEventDetail & { externalId: string }>;
  }): Promise<ProviderEventYearImport> {
    const created: SportEventSummary[] = [];
    const skipped: ProviderEventYearImport['skipped'] = [];
    for (const providerEvent of input.providerEvents) {
      const { externalId, name } = providerEvent;
      if (await this.deps.sportEvents.findByProviderRef(input.providerId, externalId)) {
        skipped.push({ externalId, name, reason: 'ALREADY_LINKED' });
        continue;
      }
      try {
        created.push(await this.createEventFromProviderEvent({
          sportLeagueId: input.sportLeagueId,
          eventYear: input.eventYear,
          providerId: input.providerId,
          externalId,
          providerEvent,
        }));
      } catch (error) {
        if (error instanceof SportEventError && error.code === 'EVENT_EDITION_ALREADY_EXISTS') {
          skipped.push({ externalId, name, reason: 'EDITION_EXISTS' });
          continue;
        }
        throw error;
      }
    }

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
  }): Promise<SportEventSummary[]> {
    const { sportLeague } = await this.resolveSportLeague(input.sportLeagueId);
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

    const cloned: SportEventSummary[] = [];
    for (const event of sourceEvents) {
      cloned.push(await this.createEvent({
        sportLeagueId: sportLeague.id,
        eventYear: targetYear,
        name: event.name,
        venue: event.venue,
        location: event.location,
        startDate: shiftYears(event.startDate, shift),
        endDate: event.endDate ? shiftYears(event.endDate, shift) : undefined,
        rounds: event.rounds,
        roundsPar: event.roundsPar,
        autoLifecycleEnabled: event.autoLifecycleEnabled,
      }));
    }
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
   * read the schedule the admin now sees.
   */
  async updateEvent(sportEventId: string, updates: SportEventUpdate): Promise<SportEventSummary> {
    const { startDate: startedAt, rounds: roundCount } = await this.requireEvent(sportEventId);
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
    return this.requireSummary(sportEventId);
  }

  /**
   * "Release for contests" (#431): DRAFT → SCHEDULED, after which commissioners can build
   * contests on the event and its tiers and prices are locked for good. 409
   * SPORT_EVENT_NOT_DRAFT once released; 409 SPORT_EVENT_ALREADY_STARTED once its start time
   * has passed; 422 SPORT_EVENT_NOT_READY while its field is empty or any active participant
   * has no tier.
   */
  async releaseEvent(sportEventId: string): Promise<SportEventSummary> {
    const summary = await this.requireSummary(sportEventId);
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
    const missing = describeReleaseBlockers(summary);
    if (missing.length > 0) {
      this.deps.logger?.warn(
        { sportEventId, loadedParticipantCount: summary.loadedParticipantCount, untieredParticipantCount: summary.untieredParticipantCount },
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
    return this.requireSummary(sportEventId);
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

  /** `releasedOnly` hides a DRAFT as if it did not exist: only a root admin sees drafts (#431). */
  async requireSummary(sportEventId: string, options: { releasedOnly?: boolean } = {}): Promise<SportEventSummary> {
    const summary = await this.getEvent(sportEventId);
    if (!summary || (options.releasedOnly && summary.event.status === SportEventStatus.DRAFT)) {
      throw new SportEventError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    return summary;
  }

  private async requireEvent(sportEventId: string): Promise<SportEvent> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event) {
      throw new SportEventError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    return event;
  }

  /** One edition of its series per year: the database decides, and a conflict is a 409. */
  private async createEdition(input: SportEventCreate): Promise<SportEvent> {
    try {
      return await this.deps.sportEvents.create(input);
    } catch (error) {
      if (isEditionConflict(error)) {
        throw new SportEventError(
          `"${input.name}" already has an edition in ${input.eventYear}.`,
          'EVENT_EDITION_ALREADY_EXISTS',
          409,
        );
      }
      throw error;
    }
  }

  /** The sport league and the sport it belongs to. Only golf creates events so far. */
  private async resolveSportLeague(sportLeagueId: string): Promise<{ sportLeague: SportLeague; sport: Sport }> {
    const sportLeague = await this.deps.sportLeagues.findById(sportLeagueId);
    if (!sportLeague) {
      throw new SportEventError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    const sport = (await this.deps.sports.findById(sportLeague.sportId))?.name;
    if (sport !== Sport.GOLF) {
      throw new SportEventError(
        `Creating events is implemented for golf only; sport league ${sportLeagueId} belongs to ${sport ?? 'an unknown sport'}.`,
        'SPORT_NOT_SUPPORTED',
        422,
      );
    }
    return { sportLeague, sport };
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private async summarize(events: SportEvent[]): Promise<SportEventSummary[]> {
    const ids = events.map((event) => event.id);
    const [participants, untiered, tiers, contests] = await Promise.all([
      this.deps.sportEvents.countParticipants(ids),
      this.deps.sportEvents.countUntieredActiveParticipants(ids),
      this.deps.sportEvents.countTiers(ids),
      this.deps.sportEvents.countContests(ids),
    ]);
    return events.map((event) => ({
      event,
      loadedParticipantCount: participants.get(event.id) ?? 0,
      untieredParticipantCount: untiered.get(event.id) ?? 0,
      tierCount: tiers.get(event.id) ?? 0,
      contestCount: contests.get(event.id) ?? 0,
    }));
  }
}

/** What still stops a DRAFT event being released, in words an admin can act on. */
function describeReleaseBlockers(summary: SportEventSummary): string[] {
  const blockers: string[] = [];
  if (summary.loadedParticipantCount === 0) {
    blockers.push('its field is not loaded');
  }
  if (summary.untieredParticipantCount > 0) {
    blockers.push(`${summary.untieredParticipantCount} active participant(s) have no tier`);
  }
  return blockers;
}
