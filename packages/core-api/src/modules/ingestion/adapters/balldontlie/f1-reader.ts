/**
 * The BALLDONTLIE Formula 1 reads behind the adapter (#2045): a season's Grand Prix weekends with
 * their sessions, a weekend's grid, every driver, and a weekend's session results.
 *
 * Plan tiers, as the vendor's document states them: events and drivers are free; sessions,
 * session results and driver standings need a paid tier, so a free key is refused on every read
 * but the driver list and the events sync reports the league refused.
 */

import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import type { BalldontlieClient } from './balldontlie-client';
import {
  f1DriverListSchema,
  f1DriverStandingListSchema,
  f1EventListSchema,
  f1SessionListSchema,
  f1SessionResultListSchema,
  type F1DriverStanding,
  type F1Session,
} from './f1-contract';
import {
  F1_DRIVER_STANDINGS_PATH,
  F1_EVENTS_PATH,
  F1_SESSIONS_PATH,
  F1_SESSION_RESULTS_PATH,
  f1ScopeId,
  isSchedulableF1Event,
  toF1Driver,
  toF1Event,
  toRaceSessionUpdates,
} from './f1-mapping';

const F1_DRIVERS_PATH = '/f1/v1/drivers';

export class F1Reader {
  constructor(private readonly client: BalldontlieClient) {}

  /**
   * One season's Grand Prix weekends, the season the events sync asks for by its Season's id
   * (#2003): a Formula 1 season is its calendar year. None when no season is named: a season is
   * never guessed from a date range. Each weekend carries every session the vendor lists for it,
   * read in one paged request.
   */
  async upcomingEvents(_dateRange?: DateRange, season?: number): Promise<SportEvent[]> {
    if (season === undefined) return [];
    const events = (await this.client.getAllPages(F1_EVENTS_PATH, { season }, f1EventListSchema)).filter(isSchedulableF1Event);
    const sessions = await this.sessionsOf(events.map((event) => event.id));
    return events.map((event) => toF1Event(event, sessions.filter((session) => session.event.id === event.id)));
  }

  /**
   * The weekend with its grid: the season's championship standings, or the season before's while
   * the new one has no standings yet. Null when the vendor has no such weekend.
   */
  async eventDetails(eventId: number): Promise<SportEventDetail | null> {
    const page = await this.client.get(F1_EVENTS_PATH, { 'event_ids[]': [eventId] }, f1EventListSchema);
    const event = page.data.find((each) => each.id === eventId);
    if (event === undefined || !isSchedulableF1Event(event)) return null;
    const [sessions, standings] = await Promise.all([this.sessionsOf([eventId]), this.standingsFor(event.season)]);
    return {
      ...toF1Event(event, sessions),
      participants: standings.map((standing) => toF1Driver(standing.driver, standing.position ?? undefined)),
    };
  }

  /** Every driver the vendor lists. */
  async drivers(): Promise<ProviderParticipant[]> {
    const drivers = await this.client.getAllPages(F1_DRIVERS_PATH, {}, f1DriverListSchema);
    return drivers.map((driver) => toF1Driver(driver));
  }

  /** Every session of the weekend with each driver's result in it, read in one paged request. */
  async liveScores(eventId: number): Promise<LiveScoreResult> {
    const sessions = await this.sessionsOf([eventId]);
    const results = sessions.length === 0
      ? []
      : await this.client.getAllPages(F1_SESSION_RESULTS_PATH, { 'session_ids[]': sessions.map((session) => session.id) }, f1SessionResultListSchema);
    return { category: 'RACE', externalEventId: f1ScopeId(eventId), sessions: toRaceSessionUpdates(sessions, results) };
  }

  private async sessionsOf(eventIds: readonly number[]): Promise<F1Session[]> {
    if (eventIds.length === 0) return [];
    return this.client.getAllPages(F1_SESSIONS_PATH, { 'event_ids[]': [...eventIds] }, f1SessionListSchema);
  }

  private async standingsFor(season: number): Promise<F1DriverStanding[]> {
    const current = await this.client.getAllPages(F1_DRIVER_STANDINGS_PATH, { season }, f1DriverStandingListSchema);
    if (current.length > 0) return current;
    return this.client.getAllPages(F1_DRIVER_STANDINGS_PATH, { season: season - 1 }, f1DriverStandingListSchema);
  }
}
