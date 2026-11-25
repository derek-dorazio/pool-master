/**
 * The NBA's playoffs from BALLDONTLIE (#1496): the league as the shared series-playoffs mapping
 * needs it, the normalizers from the vendor's NBA shapes, and the two reads behind them. Each
 * round is a best of seven, one match of the bracket whose games' winners the GAME writer counts
 * (#1545). The games and teams endpoints name no paid tier in the vendor's document.
 */

import { Sport } from '@poolmaster/shared/domain';
import { BalldontlieContractError, type BalldontlieClient } from './balldontlie-client';
import {
  NBA_CONFERENCES,
  NBA_PLAYOFFS_SEASON_TYPE,
  nbaGameListSchema,
  nbaStandingListSchema,
  nbaTeamListSchema,
  type NbaStanding,
  type NbaGame,
  type NbaTeam,
} from './nba-contract';
import type { PlayoffSeedRanks } from './series-playoff-bracket';
import { BracketShapeKind, type PlayoffGame, type PlayoffsLeague, type PlayoffTeam } from './series-playoffs';
import type { PlayoffsSource } from './series-playoffs-reader';

export const NBA_PLAYOFFS: PlayoffsLeague = {
  key: 'nba',
  sport: Sport.BASKETBALL,
  eventName: 'NBA Playoffs',
  rounds: [
    { name: 'NBA First Round', seriesLength: 7, seriesCount: 8 },
    { name: 'NBA Conference Semifinals', seriesLength: 7, seriesCount: 4 },
    { name: 'NBA Conference Finals', seriesLength: 7, seriesCount: 2 },
    { name: 'NBA Finals', seriesLength: 7, seriesCount: 1 },
  ],
  // The 2025 season opens in October 2025; its playoffs run from April into June 2026.
  playoffYearOffset: 1,
  // September, ahead of October's opening night.
  // Each conference seeds its own half; the West's is listed first, as an admin loads it.
  bracket: { kind: BracketShapeKind.SEEDED, groups: ['West', 'East'] },
};

const GAMES_PATH = '/nba/v1/games';
const TEAMS_PATH = '/nba/v1/teams';
const STANDINGS_PATH = '/nba/v1/standings';

/** A field the document leaves optional but without which a row cannot be placed or scored. */
function required<Value>(value: Value | undefined, path: string, row: string, field: string): Value {
  if (value === undefined) throw new BalldontlieContractError(path, [`${row} has no ${field}`]);
  return value;
}

export function toNbaPlayoffTeam(team: NbaTeam, path: string): PlayoffTeam {
  const id = required(team.id, path, 'a team', 'id');
  return {
    id,
    name: required(team.full_name, path, `team ${String(id)}`, 'full_name'),
    metadata: { abbreviation: team.abbreviation, conference: team.conference, division: team.division },
  };
}

/** The league's current teams from the teams list, leaving out any franchise in no conference now. */
export function toNbaPlayoffTeams(teams: readonly NbaTeam[]): PlayoffTeam[] {
  return teams
    .filter((team) => team.conference !== undefined && NBA_CONFERENCES.includes(team.conference))
    .map((team) => toNbaPlayoffTeam(team, TEAMS_PATH));
}

export function toNbaPlayoffGame(game: NbaGame): PlayoffGame {
  const row = `game ${game.id === undefined ? '(no id)' : String(game.id)}`;
  // A game's tip-off, or its day where the league has not set the time yet. A day alone parses as
  // midnight UTC, so such a game sorts before that day's timed games. A day is enough for what reads
  // it: the event's first and last days, and which series starts last, the final starting days
  // after the last conference final.
  const start = game.datetime ?? required(game.date, GAMES_PATH, row, 'date');
  return {
    id: required(game.id, GAMES_PATH, row, 'id'),
    season: required(game.season, GAMES_PATH, row, 'season'),
    postseason: required(game.postseason, GAMES_PATH, row, 'postseason'),
    start: Date.parse(start),
    home: toNbaPlayoffTeam(required(game.home_team, GAMES_PATH, row, 'home_team'), GAMES_PATH),
    away: toNbaPlayoffTeam(required(game.visitor_team, GAMES_PATH, row, 'visitor_team'), GAMES_PATH),
    state: game.status_state,
    homeScore: game.home_team_score ?? null,
    awayScore: game.visitor_team_score ?? null,
  };
}

/**
 * Each team's rank in its conference, the seed of the 1 to 6 seeds; the 7 and 8 seeds come from
 * the play-in, so their ranks are not their seeds, and the bracket reads them from who they meet.
 */
export function toNbaSeedRanks(standings: readonly NbaStanding[]): PlayoffSeedRanks {
  return new Map(standings.flatMap((standing) => {
    const id = standing.team?.id;
    const rank = standing.conference_rank;
    return id === undefined || rank === undefined ? [] : [[id, rank] as const];
  }));
}

/** The NBA's reads: a season's playoff games (never the play-in), every team, and the standings. */
export function nbaPlayoffsSource(client: BalldontlieClient): PlayoffsSource {
  return {
    league: NBA_PLAYOFFS,
    async games(season) {
      const games = await client.getAllPages(GAMES_PATH, { 'seasons[]': [season], season_type: NBA_PLAYOFFS_SEASON_TYPE }, nbaGameListSchema);
      return games.map(toNbaPlayoffGame);
    },
    async teams() {
      const page = await client.get(TEAMS_PATH, {}, nbaTeamListSchema);
      return toNbaPlayoffTeams(page.data);
    },
    async seedRanks(season) {
      const page = await client.get(STANDINGS_PATH, { season }, nbaStandingListSchema);
      return toNbaSeedRanks(page.data);
    },
  };
}
