/**
 * SeasonService — cross-sport Season CRUD (plans/124 §3.2/§4.2/§4.3). A season is a
 * sport league's calendar year: a grouping of events, not a roster boundary — who
 * competes lives on the sport league's affiliations (sport-league-service.ts).
 *
 * `cloneSeason` (plans/124 §4.2a) copies a season's event *calendar* one year forward.
 * It is handed the same creation function `createEvent` uses, so every default that
 * path produces (empty field, fresh rounds, default tiers, no provider link) comes along,
 * and nothing about last year's field, tiers, prices, scores or provider link is copied.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  SeasonRepository,
  SportEventRepository,
  SportLeagueRepository,
} from '@poolmaster/shared/db';
import type { Season, SportLeague } from '@poolmaster/shared/domain';
import { SportCatalogError } from './errors';

/** A season with what its readers derive from elsewhere: its event count, and whether it is current. */
export interface SeasonDetail extends Season {
  sportEventCount: number;
  /** Derived from the sport league's pointer, never stored on the season. */
  isCurrent: boolean;
}

/** The event-creation input a clone re-supplies (plans/124 §4.2a). */
export interface CloneEventInput {
  name: string;
  venue?: string;
  location?: string;
  startDate: Date;
  endDate?: Date;
  rounds?: number;
  releaseAt: Date;
  fieldLocksAt: Date;
  seasonId: string;
  autoLifecycleEnabled?: boolean;
}

/** Shift a date to the same month/day in `date.year + years` (leap-year safe). */
export function shiftYears(date: Date, years: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setUTCFullYear(shifted.getUTCFullYear() + years);
  return shifted;
}

export interface SeasonServiceDeps {
  sportLeagues: SportLeagueRepository;
  seasons: SeasonRepository;
  sportEvents: SportEventRepository;
  logger?: FastifyBaseLogger;
}

export class SeasonService {
  constructor(private readonly deps: SeasonServiceDeps) {}

  /** A sport league's seasons, newest year first. */
  async listSeasons(sportLeagueId: string, options: { isActive?: boolean } = {}): Promise<SeasonDetail[]> {
    const sportLeague = await this.requireSportLeague(sportLeagueId);
    const seasons = await this.deps.seasons.findAll({ sportLeagueId, isActive: options.isActive });
    const counts = await this.deps.sportEvents.countBySeasons(seasons.map((season) => season.id));
    return seasons.map((season) => ({
      ...season,
      sportEventCount: counts.get(season.id) ?? 0,
      isCurrent: sportLeague.currentSeasonId === season.id,
    }));
  }

  async createSeason(input: Pick<Season, 'sportLeagueId' | 'name' | 'year' | 'startDate' | 'endDate'>): Promise<Season> {
    await this.requireSportLeague(input.sportLeagueId);
    if (await this.deps.seasons.findBySportLeagueAndYear(input.sportLeagueId, input.year)) {
      throw new SportCatalogError(
        `This sport league already has a season for ${input.year}.`,
        'SEASON_YEAR_ALREADY_EXISTS',
        409,
      );
    }
    const season = await this.deps.seasons.create(input);
    this.deps.logger?.info({ seasonId: season.id, sportLeagueId: input.sportLeagueId, year: input.year }, 'Created season');
    return season;
  }

  async getSeason(seasonId: string): Promise<SeasonDetail | null> {
    const season = await this.deps.seasons.findById(seasonId);
    if (!season) {
      return null;
    }
    const [sportLeague, counts] = await Promise.all([
      this.deps.sportLeagues.findById(season.sportLeagueId),
      this.deps.sportEvents.countBySeasons([season.id]),
    ]);
    return {
      ...season,
      sportEventCount: counts.get(season.id) ?? 0,
      isCurrent: sportLeague?.currentSeasonId === season.id,
    };
  }

  /**
   * A single write on the parent SportLeague row — no separate "unset the old one" step,
   * so a sport league never has zero or two current seasons (plans/124 §5.2). Returns the
   * sport league it changed. 404 SEASON_NOT_FOUND for an unknown season.
   */
  async setCurrentSeason(seasonId: string): Promise<SportLeague> {
    const season = await this.requireSeason(seasonId);
    return this.deps.sportLeagues.update(season.sportLeagueId, { currentSeasonId: seasonId });
  }

  /** 404 SEASON_NOT_FOUND for an unknown season. */
  async updateSeason(
    seasonId: string,
    updates: { name?: string; startDate?: Date; endDate?: Date; isActive?: boolean },
  ): Promise<SeasonDetail> {
    await this.requireSeason(seasonId);
    await this.deps.seasons.update(seasonId, updates);
    return this.getSeason(seasonId) as Promise<SeasonDetail>;
  }

  /**
   * plans/124 §4.2a — clone a season's tournament calendar forward one year.
   * Creates the target `Season` (dates shifted to the same month/day, year +
   * shift — via `setUTCFullYear`, so it lands correctly across a leap year),
   * then re-runs `createTournament` once per source-season tournament with
   * `name`/`venue`/`location`/`rounds`/`autoLifecycleEnabled` copied and every
   * date shifted the same way. Never a raw `SportEvent` row copy — field,
   * tiers, prices, scores, and the provider link are specific to *that*
   * instance and do not carry forward, by construction. `currentSeasonId` is
   * left on the source season; the admin runs "Set as current" separately.
   */
  async cloneSeason(
    sourceSeasonId: string,
    targetYear: number | undefined,
    createEvent: (input: CloneEventInput) => Promise<unknown>,
  ): Promise<{ season: SeasonDetail; clonedEventCount: number }> {
    const source = await this.requireSeason(sourceSeasonId);

    const year = targetYear ?? source.year + 1;
    const shift = year - source.year;

    const targetName = source.name.includes(String(source.year))
      ? source.name.replace(String(source.year), String(year))
      : `${source.name} (${year})`;

    // Reuses createSeason's (sportLeagueId, year) guard: a target year that
    // already exists for this sport league throws 409 SEASON_YEAR_ALREADY_EXISTS.
    const newSeason = await this.createSeason({
      sportLeagueId: source.sportLeagueId,
      name: targetName,
      year,
      startDate: shiftYears(source.startDate, shift),
      endDate: shiftYears(source.endDate, shift),
    });

    const sourceEvents = await this.deps.sportEvents.findAll({ seasonId: sourceSeasonId });
    for (const event of sourceEvents) {
      await createEvent({
        name: event.name,
        venue: event.venue,
        location: event.location,
        startDate: shiftYears(event.startDate, shift),
        endDate: event.endDate ? shiftYears(event.endDate, shift) : undefined,
        rounds: event.rounds,
        releaseAt: shiftYears(event.releaseAt, shift),
        fieldLocksAt: shiftYears(event.fieldLocksAt, shift),
        seasonId: newSeason.id,
        autoLifecycleEnabled: event.autoLifecycleEnabled,
      });
    }

    const detail = await this.getSeason(newSeason.id);
    if (!detail) {
      // Unreachable — we just created it — but keeps the return type honest.
      throw new SportCatalogError('Cloned season disappeared after creation.', 'SEASON_NOT_FOUND', 500);
    }
    this.deps.logger?.info(
      { sourceSeasonId, targetSeasonId: newSeason.id, year, clonedEventCount: sourceEvents.length },
      'Cloned season event calendar',
    );
    return { season: detail, clonedEventCount: sourceEvents.length };
  }

  private async requireSportLeague(sportLeagueId: string): Promise<SportLeague> {
    const sportLeague = await this.deps.sportLeagues.findById(sportLeagueId);
    if (!sportLeague) {
      throw new SportCatalogError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    return sportLeague;
  }

  private async requireSeason(seasonId: string): Promise<Season> {
    const season = await this.deps.seasons.findById(seasonId);
    if (!season) {
      throw new SportCatalogError(`Season ${seasonId} was not found.`, 'SEASON_NOT_FOUND', 404);
    }
    return season;
  }
}
