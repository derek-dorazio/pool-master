/**
 * The BALLDONTLIE NFL reads behind the adapter (#1496): the season's games grouped into events
 * (a regular season week, or the postseason), a scope's teams, every NFL team, and a scope's
 * game scores, and a season's standings for the postseason's seeds. The games, teams and standings
 * endpoints name no paid tier in the vendor's document.
 */

import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import type { BalldontlieClient } from './balldontlie-client';
import { NflSeasonType, nflGameListSchema, nflStandingListSchema, nflTeamListSchema, type NflGame } from './nfl-contract';
import {
  nflScopeId,
  NflScopeKind,
  seasonTypeOf,
  toGameScoreUpdates,
  toNflFieldParticipants,
  toNflPlayoffBracket,
  toNflPlayoffField,
  toNflPostseasonGames,
  toNflScheduledGames,
  toNflSportEvent,
  toNflSportEvents,
  toNflTeamParticipant,
  type NflScope,
} from './nfl-mapping';
import { participantFeedId } from './participant-feed-id';

const GAMES_PATH = '/nfl/v1/games';
const TEAMS_PATH = '/nfl/v1/teams';
const STANDINGS_PATH = '/nfl/v1/standings';

/** A range spanning more seasons than this reads none: every NFL game ever played is no catalog. */
const MAX_SEASONS_READ = 3;

export class NflReader {
  constructor(private readonly client: BalldontlieClient) {}

  /**
   * One season's events, when `season` names it (the events sync asks for a Season by its id here,
   * #2003); otherwise the events whose games start inside `dateRange`. An NFL season runs from
   * September into the next February, so a range reads the seasons from the year before it starts
   * to the year it ends. With neither, or a range too wide to walk, it reads none: nothing here
   * works out a season from today's date.
   */
  async upcomingEvents(dateRange?: DateRange, season?: number): Promise<SportEvent[]> {
    if (season !== undefined) return toNflSportEvents(await this.seasonGames(season));
    const games: NflGame[] = [];
    for (const each of this.seasonsFor(dateRange)) {
      games.push(...await this.seasonGames(each));
    }
    return toNflSportEvents(games)
      .filter((event) => !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  private seasonGames(season: number): Promise<NflGame[]> {
    return this.client.getAllPages(
      GAMES_PATH,
      { 'seasons[]': [season], 'season_types[]': [NflSeasonType.REGULAR_SEASON, NflSeasonType.POSTSEASON] },
      nflGameListSchema,
    );
  }

  /**
   * The scope with its teams and games; null when the vendor has no game in it yet. A week's teams
   * are the ones playing its games. The postseason's are each conference's seeds 1 to 7 from the
   * season's standings, with their seeds, so the 1 seeds are in its field before they play (until
   * the standings seed anyone, the NFL teams its games have so far), and
   * once both conferences are seeded it carries its whole bracket (#1728).
   */
  async eventDetails(scope: NflScope): Promise<SportEventDetail | null> {
    const games = await this.gamesOf(scope);
    if (games.length === 0) return null;
    if (scope.kind === NflScopeKind.WEEK) {
      const participants = toNflFieldParticipants(games);
      return { ...toNflSportEvent(scope, games, participants.length), participants, games: toNflScheduledGames(games) };
    }
    const standings = await this.client.get(STANDINGS_PATH, { season: scope.season }, nflStandingListSchema);
    const seeded = toNflPlayoffField(standings.data);
    // Before the standings seed anyone, the field is the NFL teams the games have so far.
    const participants = seeded.length > 0 ? seeded : await this.nflTeamsPlaying(games);
    const scheduled = toNflPostseasonGames(games, new Set(participants.map((team) => team.externalId)));
    const bracket = toNflPlayoffBracket(seeded, scheduled);
    return {
      ...toNflSportEvent(scope, games, participants.length),
      participants,
      games: scheduled,
      ...(bracket !== null && { bracket }),
    };
  }

  /**
   * The teams of the games between two of the vendor's NFL teams, so an all-star game's sides,
   * which the vendor may list in the postseason, are no team of the field.
   */
  private async nflTeamsPlaying(games: readonly NflGame[]): Promise<ProviderParticipant[]> {
    const nflTeams = new Set((await this.teams()).map((team) => team.externalId));
    const isNflTeam = (teamId: number | undefined) => teamId !== undefined && nflTeams.has(participantFeedId(teamId));
    return toNflFieldParticipants(games.filter((game) => isNflTeam(game.home_team?.id) && isNflTeam(game.visitor_team?.id)));
  }

  /** Every NFL team. */
  async teams(): Promise<ProviderParticipant[]> {
    const page = await this.client.get(TEAMS_PATH, {}, nflTeamListSchema);
    return page.data.map((team) => toNflTeamParticipant(team, TEAMS_PATH));
  }

  /** Every game of the scope, with its teams, state and score. */
  async liveScores(scope: NflScope): Promise<LiveScoreResult> {
    const games = await this.gamesOf(scope);
    return { category: 'GAME', externalEventId: nflScopeId(scope), games: toGameScoreUpdates(games) };
  }

  private gamesOf(scope: NflScope): Promise<NflGame[]> {
    return this.client.getAllPages(
      GAMES_PATH,
      {
        'seasons[]': [scope.season],
        'season_types[]': [seasonTypeOf(scope)],
        'weeks[]': scope.kind === NflScopeKind.WEEK ? [scope.week] : undefined,
      },
      nflGameListSchema,
    );
  }

  private seasonsFor(dateRange?: DateRange): number[] {
    if (!dateRange) return [];
    const first = dateRange.from.getUTCFullYear() - 1;
    const count = dateRange.to.getUTCFullYear() - first + 1;
    return count <= MAX_SEASONS_READ ? Array.from({ length: count }, (_, index) => first + index) : [];
  }
}
