/**
 * The BALLDONTLIE NCAA basketball tournament reads behind the adapter (#1496), for one league,
 * men's or women's: each season's tournament as an event, its teams with their seeds, its games and the men's whole bracket (#1728), every Division I team, and the
 * tournament's game scores. The bracket endpoints need the GOAT tier;
 * the teams lists name no paid tier.
 */

import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import type { BalldontlieClient } from './balldontlie-client';
import { ncaabBracketListSchema, ncaaBracketListSchema, ncaaTeamListSchema, type NcaaBracketGame } from './ncaa-tournament-contract';
import {
  bracketPathOf,
  ncaaTournamentScopeId,
  teamsPathOf,
  toNcaaBracket,
  toNcaaFieldParticipants,
  toNcaaGameScoreUpdates,
  toNcaaScheduledGames,
  toNcaaTeamParticipant,
  toNcaaTournamentEvent,
  type NcaaTournamentLeague,
} from './ncaa-tournament-mapping';

/** A range spanning more seasons than this reads none. */
const MAX_SEASONS_READ = 3;

export class NcaaTournamentReader {
  constructor(
    private readonly client: BalldontlieClient,
    private readonly league: NcaaTournamentLeague,
  ) {}

  /**
   * One season's tournament, when `season` names it (the events sync asks for a Season by its id,
   * #2003); otherwise the tournaments that start inside `dateRange`. A season's tournament is
   * played in the spring after it starts, so a range reads the seasons starting the year before
   * each year it covers. With neither, or a range too wide to walk, it reads none.
   */
  async upcomingEvents(dateRange?: DateRange, season?: number): Promise<SportEvent[]> {
    const events: SportEvent[] = [];
    for (const each of season === undefined ? this.seasonsFor(dateRange) : [season]) {
      const games = await this.bracketOf(each);
      if (games.length > 0) events.push(toNcaaTournamentEvent({ league: this.league, season: each }, games));
    }
    return events.filter((event) => season !== undefined || !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /** The season's tournament with its teams; null when the vendor has no bracket for it yet. */
  async eventDetails(season: number): Promise<SportEventDetail | null> {
    const games = await this.bracketOf(season);
    if (games.length === 0) return null;
    const scope = { league: this.league, season };
    const participants = toNcaaFieldParticipants(this.league, games);
    const bracket = toNcaaBracket(scope, games);
    return {
      ...toNcaaTournamentEvent(scope, games, participants.length),
      participants,
      games: toNcaaScheduledGames(this.league, games),
      ...(bracket !== null && { bracket }),
    };
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
    // The men's bracket names each game's region; the women's document has none to read.
    return this.client.getAllPages(bracketPathOf(this.league), { season }, this.league.bracketRegions ? ncaabBracketListSchema : ncaaBracketListSchema);
  }

  private seasonsFor(dateRange?: DateRange): number[] {
    if (!dateRange) return [];
    // Season s's tournament is played in calendar year s + 1, so the years from..to are
    // seasons from - 1 to to - 1.
    const first = dateRange.from.getUTCFullYear() - 1;
    const seasonCount = dateRange.to.getUTCFullYear() - first;
    return seasonCount <= MAX_SEASONS_READ ? Array.from({ length: seasonCount }, (_, index) => first + index) : [];
  }
}
