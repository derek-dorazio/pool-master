/**
 * SeasonService — cross-sport Season CRUD (plans/124 §3.2/§4.2/§4.3). A
 * Season is purely a tournament-calendar grouping now, not a roster
 * boundary — the roster lives on SportLeague (sport-league-service.ts).
 *
 * cloneSeasonTournaments (plans/124 §4.2a) copies a season's tournament
 * *calendar* one year forward. It is caller-injected with the same internal
 * creation function adminCreateGolfTournament uses, so every default that
 * path already produces (empty field, fresh round schedule, 6 default
 * tiers, syncScope=NONE) comes along for free — nothing about last year's
 * field / tiers / prices / scores / provider link is ever copied.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  SeasonRepository,
  SportEventRepository,
  SportLeagueRepository,
  SportRepository,
} from '@poolmaster/shared/db';
import type { Season, Sport } from '@poolmaster/shared/domain';
import { SportCatalogError } from './errors';

export interface SeasonSummary extends Season {
  tournamentCount: number;
}

export interface SeasonDetail extends SeasonSummary {
  isCurrent: boolean;
}

/** The subset of a golf tournament-creation input that a clone re-supplies (plans/124 §4.2a). */
export interface CloneTournamentInput {
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
  sports: SportRepository;
  sportLeagues: SportLeagueRepository;
  seasons: SeasonRepository;
  sportEvents: SportEventRepository;
  logger?: FastifyBaseLogger;
}

export class SeasonService {
  constructor(private readonly deps: SeasonServiceDeps) {}

  async listSeasons(
    sport: Sport,
    options: { isActive?: boolean; sportLeagueId?: string } = {},
  ): Promise<SeasonSummary[]> {
    const sportRow = await this.deps.sports.findByName(sport);
    if (!sportRow) {
      return [];
    }
    const seasons = await this.deps.seasons.findAll({
      sportId: sportRow.id,
      sportLeagueId: options.sportLeagueId,
      isActive: options.isActive,
    });
    const counts = await this.deps.sportEvents.countBySeasons(seasons.map((season) => season.id));
    return seasons.map((season) => ({ ...season, tournamentCount: counts.get(season.id) ?? 0 }));
  }

  async createSeason(input: Pick<Season, 'sportLeagueId' | 'name' | 'year' | 'startDate' | 'endDate'>): Promise<Season> {
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
      tournamentCount: counts.get(season.id) ?? 0,
      // Derived from the parent's pointer, never stored on the season.
      isCurrent: sportLeague?.currentSeasonId === season.id,
    };
  }

  updateSeason(
    seasonId: string,
    updates: { name?: string; startDate?: Date; endDate?: Date; isActive?: boolean },
  ): Promise<Season> {
    return this.deps.seasons.update(seasonId, updates);
  }

  /**
   * A single write on the parent SportLeague row — no separate "unset the old
   * one" step, so a sport league never has zero or two current seasons
   * (plans/124 §5.2).
   */
  async setCurrentSeason(seasonId: string): Promise<{ sportLeagueId: string; currentSeasonId: string }> {
    const season = await this.requireSeason(seasonId);
    await this.deps.sportLeagues.update(season.sportLeagueId, { currentSeasonId: seasonId });
    return { sportLeagueId: season.sportLeagueId, currentSeasonId: seasonId };
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
  async cloneSeasonTournaments(
    sourceSeasonId: string,
    targetYear: number | undefined,
    createTournament: (input: CloneTournamentInput) => Promise<unknown>,
  ): Promise<{ season: SeasonDetail; tournamentsCloned: number }> {
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
      await createTournament({
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
      { sourceSeasonId, targetSeasonId: newSeason.id, year, tournamentsCloned: sourceEvents.length },
      'Cloned season tournament calendar',
    );
    return { season: detail, tournamentsCloned: sourceEvents.length };
  }

  /**
   * Foreign-key-target validation for a caller-supplied seasonId — rejects a
   * season whose sport league belongs to a different sport (plans/124 §4.3).
   * Tournament create and update call it.
   */
  async assertSeasonBelongsToSport(seasonId: string, sport: Sport): Promise<Season> {
    const season = await this.requireSeason(seasonId);
    const sportLeague = await this.deps.sportLeagues.findById(season.sportLeagueId);
    const sportRow = sportLeague ? await this.deps.sports.findById(sportLeague.sportId) : null;
    if (sportRow?.name !== sport) {
      throw new SportCatalogError(
        `Season ${seasonId} belongs to ${sportRow?.name ?? 'an unknown sport'}, not ${sport}.`,
        'SEASON_SPORT_MISMATCH',
        422,
      );
    }
    return season;
  }

  private async requireSeason(seasonId: string): Promise<Season> {
    const season = await this.deps.seasons.findById(seasonId);
    if (!season) {
      throw new SportCatalogError(`Season ${seasonId} was not found.`, 'SEASON_NOT_FOUND', 404);
    }
    return season;
  }
}
