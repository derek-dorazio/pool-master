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
  nflTeamExternalId,
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

const GAMES_PATH = '/nfl/v1/games';
const TEAMS_PATH = '/nfl/v1/teams';
const STANDINGS_PATH = '/nfl/v1/standings';

/** A range spanning more seasons than this reads the current and next season instead of every one. */
const MAX_SEASONS_READ = 3;

/** The month (0-based) a new NFL season's events start being listed: March, after the Super Bowl. */
const SEASON_ROLLOVER_MONTH = 2;

export class NflReader {
  constructor(
    private readonly client: BalldontlieClient,
    private readonly now: () => number,
  ) {}

  /**
   * The events whose games start inside `dateRange`. An NFL season runs from September into the
   * next February, so a range reads the seasons from the year before it starts to the year it
   * ends. Without a range, or with one too wide to walk, it reads the season under way and the
   * next: every NFL game ever played is no catalog.
   */
  async upcomingEvents(dateRange?: DateRange): Promise<SportEvent[]> {
    const games: NflGame[] = [];
    for (const season of this.seasonsFor(dateRange)) {
      games.push(...await this.client.getAllPages(
        GAMES_PATH,
        { 'seasons[]': [season], 'season_types[]': [NflSeasonType.REGULAR_SEASON, NflSeasonType.POSTSEASON] },
        nflGameListSchema,
      ));
    }
    return toNflSportEvents(games)
      .filter((event) => !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
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
    const isNflTeam = (teamId: number | undefined) => teamId !== undefined && nflTeams.has(nflTeamExternalId(teamId));
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
    if (dateRange) {
      const first = dateRange.from.getUTCFullYear() - 1;
      const count = dateRange.to.getUTCFullYear() - first + 1;
      if (count <= MAX_SEASONS_READ) return Array.from({ length: count }, (_, index) => first + index);
    }
    const today = new Date(this.now());
    const current = today.getUTCMonth() >= SEASON_ROLLOVER_MONTH ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    return [current, current + 1];
  }
}
