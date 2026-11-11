/**
 * The BALLDONTLIE NCAA basketball tournament reads behind the adapter (#1496), for one league,
 * men's or women's: each season's tournament as an event, its teams with their seeds, every
 * Division I team, and the tournament's game scores. The bracket endpoints need the GOAT tier;
 * the teams lists name no paid tier.
 */

import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import type { BalldontlieClient } from './balldontlie-client';
import { ncaaBracketListSchema, ncaaTeamListSchema, type NcaaBracketGame } from './ncaa-tournament-contract';
import {
  bracketPathOf,
  ncaaTournamentScopeId,
  teamsPathOf,
  toNcaaFieldParticipants,
  toNcaaGameScoreUpdates,
  toNcaaTeamParticipant,
  toNcaaTournamentEvent,
  type NcaaTournamentLeague,
} from './ncaa-tournament-mapping';

/** A range spanning more seasons than this reads the last tournament and the next instead. */
const MAX_SEASONS_READ = 3;

/** The month (0-based) a new college basketball season is under way: November. */
const SEASON_START_MONTH = 10;

export class NcaaTournamentReader {
  constructor(
    private readonly client: BalldontlieClient,
    private readonly league: NcaaTournamentLeague,
    private readonly now: () => number,
  ) {}

  /**
   * The tournaments that start inside `dateRange`. A season's tournament is played in the spring
   * after it starts, so a range reads the seasons starting the year before each year it covers.
   * Without a range, or with one too wide to walk, it reads the last tournament and the next.
   */
  async upcomingEvents(dateRange?: DateRange): Promise<SportEvent[]> {
    const events: SportEvent[] = [];
    for (const season of this.seasonsFor(dateRange)) {
      const games = await this.bracketOf(season);
      if (games.length > 0) events.push(toNcaaTournamentEvent({ league: this.league, season }, games));
    }
    return events.filter((event) => !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /** The season's tournament with its teams; null when the vendor has no bracket for it yet. */
  async eventDetails(season: number): Promise<SportEventDetail | null> {
    const games = await this.bracketOf(season);
    if (games.length === 0) return null;
    const participants = toNcaaFieldParticipants(this.league, games);
    return { ...toNcaaTournamentEvent({ league: this.league, season }, games, participants.length), participants };
  }

  /** Every Division I team in the league. */
  async teams(): Promise<ProviderParticipant[]> {
    const page = await this.client.get(teamsPathOf(this.league), {}, ncaaTeamListSchema);
    return page.data.map((team) => toNcaaTeamParticipant(this.league, team));
  }

  /** Every bracket game with its teams decided, with its state and score. */
  async liveScores(season: number): Promise<LiveScoreResult> {
    const games = await this.bracketOf(season);
    return {
      category: 'GAME',
      externalEventId: ncaaTournamentScopeId({ league: this.league, season }),
      games: toNcaaGameScoreUpdates(this.league, games),
    };
  }

  private bracketOf(season: number): Promise<NcaaBracketGame[]> {
    return this.client.getAllPages(bracketPathOf(this.league), { season }, ncaaBracketListSchema);
  }

  private seasonsFor(dateRange?: DateRange): number[] {
    if (dateRange) {
      // Season s's tournament is played in calendar year s + 1, so the years from..to are
      // seasons from - 1 to to - 1.
      const first = dateRange.from.getUTCFullYear() - 1;
      const seasonCount = dateRange.to.getUTCFullYear() - first;
      if (seasonCount <= MAX_SEASONS_READ) return Array.from({ length: seasonCount }, (_, index) => first + index);
    }
    const today = new Date(this.now());
    const current = today.getUTCMonth() >= SEASON_START_MONTH ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    return [current - 1, current];
  }
}
