/**
 * The NHL's playoffs from BALLDONTLIE (#1496): the league as the shared series-playoffs mapping
 * needs it, the normalizers from the vendor's NHL shapes, and the two reads behind them. Each
 * round is a best of seven, one match of the bracket whose games' winners the GAME writer counts
 * (#1545). The games and teams endpoints name no paid tier in the vendor's document.
 *
 * The vendor numbers an NHL season by the year it starts ("2026 for 2026-27"), so the 2025
 * season's playoffs (`nhl-2025-postseason`) run from April into June 2026.
 */

import { Sport } from '@poolmaster/shared/domain';
import { BalldontlieContractError, type BalldontlieClient } from './balldontlie-client';
import { nhlGameListSchema, nhlTeamListSchema, type NhlGame, type NhlTeam } from './nhl-contract';
import type { PlayoffGame, PlayoffsLeague, PlayoffTeam } from './series-playoffs';
import type { PlayoffsSource } from './series-playoffs-reader';

export const NHL_PLAYOFFS: PlayoffsLeague = {
  key: 'nhl',
  tour: 'NHL',
  sport: Sport.HOCKEY,
  eventName: 'NHL Playoffs',
  // Sixteen teams, every series best of seven. Each round's name is the tour a future NHL Clutch
  // Card league on that round would match, as the NBA's are.
  rounds: [
    { name: 'NHL First Round', seriesLength: 7, seriesCount: 8 },
    { name: 'NHL Second Round', seriesLength: 7, seriesCount: 4 },
    { name: 'NHL Conference Finals', seriesLength: 7, seriesCount: 2 },
    { name: 'Stanley Cup Final', seriesLength: 7, seriesCount: 1 },
  ],
  // The 2025 season opens in October 2025; its playoffs run from April into June 2026.
  playoffYearOffset: 1,
  // September, ahead of October's opening night.
  seasonRolloverMonth: 8,
};

const GAMES_PATH = '/nhl/v1/games';
const TEAMS_PATH = '/nhl/v1/teams';

/** A field the document leaves optional but without which a row cannot be placed or scored. */
function required<Value>(value: Value | undefined, path: string, row: string, field: string): Value {
  if (value === undefined) throw new BalldontlieContractError(path, [`${row} has no ${field}`]);
  return value;
}

export function toNhlPlayoffTeam(team: NhlTeam, path: string): PlayoffTeam {
  const id = required(team.id, path, 'a team', 'id');
  return {
    id,
    name: required(team.full_name, path, `team ${String(id)}`, 'full_name'),
    metadata: { abbreviation: team.tricode, conference: team.conference_name, division: team.division_name },
  };
}

/**
 * A game placed on its day (`game_date`). Its start time, `start_time_utc`, is a string whose
 * format the document leaves open, so it is not read: the day is all an event's dates need.
 */
export function toNhlPlayoffGame(game: NhlGame): PlayoffGame {
  const row = `game ${game.id === undefined ? '(no id)' : String(game.id)}`;
  return {
    id: required(game.id, GAMES_PATH, row, 'id'),
    season: required(game.season, GAMES_PATH, row, 'season'),
    postseason: required(game.postseason, GAMES_PATH, row, 'postseason'),
    start: Date.parse(required(game.game_date, GAMES_PATH, row, 'game_date')),
    home: toNhlPlayoffTeam(required(game.home_team, GAMES_PATH, row, 'home_team'), GAMES_PATH),
    away: toNhlPlayoffTeam(required(game.away_team, GAMES_PATH, row, 'away_team'), GAMES_PATH),
    state: game.status_state,
    homeScore: game.home_score ?? null,
    awayScore: game.away_score ?? null,
  };
}

/**
 * Whether a team is a current franchise. The document leaves a team's conference nullable, as
 * it is for a franchise that has folded or moved (the vendor keeps such teams in its list), and
 * a team in no conference plays in no playoffs.
 */
export function isNhlFranchise(team: NhlTeam): boolean {
  return Boolean(team.conference_name);
}

/** The NHL's two reads: a season's postseason games, and every current franchise. */
export function nhlPlayoffsSource(client: BalldontlieClient): PlayoffsSource {
  return {
    league: NHL_PLAYOFFS,
    async games(season) {
      const games = await client.getAllPages(GAMES_PATH, { seasons: [season], postseason: true }, nhlGameListSchema);
      return games.map(toNhlPlayoffGame);
    },
    async teams() {
      const teams = await client.getAllPages(TEAMS_PATH, {}, nhlTeamListSchema);
      return teams.filter(isNhlFranchise).map((team) => toNhlPlayoffTeam(team, TEAMS_PATH));
    },
  };
}
