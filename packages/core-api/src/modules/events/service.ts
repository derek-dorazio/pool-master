/**
 * SportEventService — the SportEvent operation set (#236): list, read, create, update and
 * delete one event. Before #236 this was split between `listEvents` here and eleven
 * golf-named operations over the same rows in `GolfTournamentService`.
 *
 * An event's sport comes from its season (season → sport league → sport), never from the
 * caller. Creation is where the sport matters: golf seeds four rounds (or the rounds its
 * provider schedule implies) and six default tiers. Any other sport is refused with 422
 * rather than created as if it were golf.
 *
 * Status changes are not here: they go through `EventLifecycleService`, the one path
 * that also activates and settles the event's contests.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  LeagueEventRepository,
  SeasonRepository,
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
  type Season,
  type SportEvent,
} from '@poolmaster/shared/domain';
import { deriveGolfTournamentRounds } from '../golf/golf-seeding-algorithm';
import { SportEventError } from './errors';
import type { SportEventRoundService } from './sport-event-round-service';
import type { SportEventTierService } from './sport-event-tier-service';

const GOLF_DEFAULT_ROUNDS = 4;

/** An event with the counts its readers derive readiness and deletability from. */
export interface SportEventSummary {
  event: SportEvent;
  loadedParticipantCount: number;
  tierCount: number;
  contestCount: number;
}

export interface CreateSportEventInput {
  seasonId: string;
  name: string;
  venue?: string;
  location?: string;
  startDate: Date;
  endDate?: Date;
  rounds?: number;
  releaseAt: Date;
  fieldLocksAt: Date;
  autoLifecycleEnabled?: boolean;
}

export interface ProviderEventDetail {
  name: string;
  venue: string | null;
  startDate: Date;
  endDate: Date | null;
}

/** Release and field-lock times for an event of this sport starting then — the contest timing policy. */
export type ResolveEventTiming = (sport: Sport, startDate: Date) => Promise<{ releaseAt: Date; fieldLocksAt: Date }>;

export interface SportEventServiceDeps {
  sportEvents: SportEventRepository;
  leagueEvents: LeagueEventRepository;
  seasons: SeasonRepository;
  sportLeagues: SportLeagueRepository;
  sports: SportRepository;
  rounds: SportEventRoundService;
  tiers: SportEventTierService;
  resolveTiming: ResolveEventTiming;
  logger?: FastifyBaseLogger;
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

  /** An admin-authored event: the reserved manual identity, SCHEDULED, accepting no provider data. */
  async createEvent(input: CreateSportEventInput): Promise<SportEventSummary> {
    const { season, sport } = await this.resolveSeason(input.seasonId);
    const rounds = input.rounds ?? GOLF_DEFAULT_ROUNDS;
    const leagueEvent = await this.deps.leagueEvents.findOrCreate(season.sportLeagueId, input.name);

    const event = await this.deps.sportEvents.create({
      externalId: `manual-${randomUUID()}`,
      providerId: MANUAL_ADMIN_PROVIDER_ID,
      sport,
      name: input.name,
      venue: input.venue,
      location: input.location,
      startDate: input.startDate,
      endDate: input.endDate,
      status: SportEventStatus.SCHEDULED,
      rounds,
      releaseAt: input.releaseAt,
      fieldLocksAt: input.fieldLocksAt,
      seasonId: season.id,
      leagueEventId: leagueEvent.id,
      syncScope: SportEventSyncScope.NONE,
      autoLifecycleEnabled: input.autoLifecycleEnabled ?? true,
    });
    await this.deps.rounds.ensureRounds({ sportEventId: event.id, rounds, startDate: input.startDate });
    await this.deps.tiers.ensureDefaultTiers(event.id);

    this.deps.logger?.info({ sportEventId: event.id, seasonId: season.id, leagueEventId: leagueEvent.id, rounds }, 'Created sport event');
    return this.requireSummary(event.id);
  }

  /**
   * An event created straight from a browsed provider event (plans/124 §4.4a), pre-linked
   * to that provider for scores (SCORES_ONLY). The field is not touched; loading it is
   * its own action. 409 EXTERNAL_EVENT_ALREADY_LINKED when another event holds the identity.
   */
  async createEventFromProviderEvent(input: {
    seasonId: string;
    providerId: string;
    externalId: string;
    rounds?: number;
    providerEvent: ProviderEventDetail;
  }): Promise<SportEventSummary> {
    const { season, sport } = await this.resolveSeason(input.seasonId);
    if (await this.deps.sportEvents.findByProviderRef(input.providerId, input.externalId)) {
      throw new SportEventError(
        `Another sport event is already linked to ${input.providerId}/${input.externalId}.`,
        'EXTERNAL_EVENT_ALREADY_LINKED',
        409,
      );
    }
    const { providerEvent } = input;
    const leagueEvent = await this.deps.leagueEvents.findOrCreate(season.sportLeagueId, providerEvent.name);
    const timing = await this.deps.resolveTiming(sport, providerEvent.startDate);
    // The derived schedule applies only when no round count was given; an explicit count
    // falls back to sequential days, so `rounds` always matches the rounds created.
    const derived = deriveGolfTournamentRounds(providerEvent.startDate, providerEvent.endDate);
    const rounds = input.rounds ?? derived.length;

    const event = await this.deps.sportEvents.create({
      externalId: input.externalId,
      providerId: input.providerId,
      sport,
      name: providerEvent.name,
      venue: providerEvent.venue ?? undefined,
      startDate: providerEvent.startDate,
      endDate: providerEvent.endDate ?? undefined,
      status: SportEventStatus.SCHEDULED,
      rounds,
      releaseAt: timing.releaseAt,
      fieldLocksAt: timing.fieldLocksAt,
      seasonId: season.id,
      leagueEventId: leagueEvent.id,
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
      { sportEventId: event.id, seasonId: season.id, providerId: input.providerId, externalId: input.externalId, rounds },
      'Created sport event from provider event',
    );
    return this.requireSummary(event.id);
  }

  /** Edits an admin-managed event. 409 EVENT_NOT_ADMIN_MANAGED for one a provider owns in full. */
  async updateEvent(sportEventId: string, updates: SportEventUpdate): Promise<SportEventSummary> {
    const existing = await this.requireEvent(sportEventId);
    if (existing.syncScope === SportEventSyncScope.FULL) {
      throw new SportEventError(
        `Sport event ${sportEventId} is provider-owned and cannot be edited here.`,
        'EVENT_NOT_ADMIN_MANAGED',
        409,
      );
    }
    await this.deps.sportEvents.update(sportEventId, updates);
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

  async requireSummary(sportEventId: string): Promise<SportEventSummary> {
    const summary = await this.getEvent(sportEventId);
    if (!summary) {
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

  /** The season and the sport it inherits through its sport league. Only golf creates events so far. */
  private async resolveSeason(seasonId: string): Promise<{ season: Season; sport: Sport }> {
    const season = await this.deps.seasons.findById(seasonId);
    if (!season) {
      throw new SportEventError(`Season ${seasonId} was not found.`, 'SEASON_NOT_FOUND', 404);
    }
    const sportLeague = await this.deps.sportLeagues.findById(season.sportLeagueId);
    const sport = sportLeague ? (await this.deps.sports.findById(sportLeague.sportId))?.name : undefined;
    if (sport !== Sport.GOLF) {
      throw new SportEventError(
        `Creating events is implemented for golf only; season ${seasonId} belongs to ${sport ?? 'an unknown sport'}.`,
        'SPORT_NOT_SUPPORTED',
        422,
      );
    }
    return { season, sport };
  }

  private async summarize(events: SportEvent[]): Promise<SportEventSummary[]> {
    const ids = events.map((event) => event.id);
    const [participants, tiers, contests] = await Promise.all([
      this.deps.sportEvents.countParticipants(ids),
      this.deps.sportEvents.countTiers(ids),
      this.deps.sportEvents.countContests(ids),
    ]);
    return events.map((event) => ({
      event,
      loadedParticipantCount: participants.get(event.id) ?? 0,
      tierCount: tiers.get(event.id) ?? 0,
      contestCount: contests.get(event.id) ?? 0,
    }));
  }
}
