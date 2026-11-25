/**
 * MLB's postseason from BALLDONTLIE (#1496): the league as the shared series-playoffs mapping
 * needs it, the normalizers from the vendor's MLB shapes, and the two reads behind them. Twelve
 * teams play a best-of-three Wild Card Series, a best-of-five Division Series and best-of-seven
 * League Championship and World Series; each series is one match of the bracket whose games'
 * winners the GAME writer counts (#1545). The four top seeds' byes are no series. The games and
 * teams endpoints name no paid tier in the vendor's document.
 *
 * An MLB season is the calendar year, and its postseason is played in October of the same year.
 */

import { Sport } from '@poolmaster/shared/domain';
import { BalldontlieContractError, type BalldontlieClient } from './balldontlie-client';
import { MLB_LEAGUES, mlbGameListSchema, mlbStandingListSchema, mlbTeamListSchema, type MlbGame, type MlbStanding, type MlbTeam } from './mlb-contract';
import type { PlayoffSeedRanks } from './series-playoff-bracket';
import { BracketShapeKind, type PlayoffGame, type PlayoffsLeague, type PlayoffTeam } from './series-playoffs';
import type { PlayoffsSource } from './series-playoffs-reader';

export const MLB_POSTSEASON: PlayoffsLeague = {
  key: 'mlb',
  sport: Sport.BASEBALL,
  eventName: 'MLB Postseason',
  // The four top seeds' byes are no series, so a seed's first series is the Division Series.
  rounds: [
    { name: 'MLB Wild Card Series', seriesLength: 3, seriesCount: 4 },
    { name: 'MLB Division Series', seriesLength: 5, seriesCount: 4 },
    { name: 'MLB League Championship Series', seriesLength: 7, seriesCount: 2 },
    { name: 'World Series', seriesLength: 7, seriesCount: 1 },
  ],
  // The 2026 season's postseason is played in October 2026.
  playoffYearOffset: 0,
  // March, when spring training gives way to the new season.
  // Six seeds a league, the top two waiting out the Wild Card Series; the American League's half
  // is listed first, as an admin loads it. The names are the vendor's `league` on a club.
  bracket: {
    kind: BracketShapeKind.BYES,
    leagues: [
      { name: 'American', label: 'AL' },
      { name: 'National', label: 'NL' },
    ],
  },
};

const GAMES_PATH = '/mlb/v1/games';
const TEAMS_PATH = '/mlb/v1/teams';
const STANDINGS_PATH = '/mlb/v1/standings';

/** A field the document leaves optional but without which a row cannot be placed or scored. */
function required<Value>(value: Value | undefined, path: string, row: string, field: string): Value {
  if (value === undefined) throw new BalldontlieContractError(path, [`${row} has no ${field}`]);
  return value;
}

export function toMlbPlayoffTeam(team: MlbTeam, path: string): PlayoffTeam {
  const id = required(team.id, path, 'a team', 'id');
  return {
    id,
    name: required(team.display_name, path, `team ${String(id)}`, 'display_name'),
    metadata: { abbreviation: team.abbreviation, league: team.league, division: team.division },
  };
}

export function toMlbPlayoffGame(game: MlbGame): PlayoffGame {
  const row = `game ${game.id === undefined ? '(no id)' : String(game.id)}`;
  return {
    id: required(game.id, GAMES_PATH, row, 'id'),
    season: required(game.season, GAMES_PATH, row, 'season'),
    postseason: required(game.postseason, GAMES_PATH, row, 'postseason'),
    start: Date.parse(required(game.date, GAMES_PATH, row, 'date')),
    home: toMlbPlayoffTeam(required(game.home_team, GAMES_PATH, row, 'home_team'), GAMES_PATH),
    away: toMlbPlayoffTeam(required(game.away_team, GAMES_PATH, row, 'away_team'), GAMES_PATH),
    state: game.status_state,
    // A side's runs are its score; the vendor sends no line before the first pitch.
    homeScore: game.home_team_data?.runs ?? null,
    awayScore: game.away_team_data?.runs ?? null,
  };
}

/** Whether a team is an MLB club, in the American or the National League. */
export function isMlbClub(team: MlbTeam): boolean {
  return team.league !== undefined && MLB_LEAGUES.includes(team.league);
}

/** MLB's two reads: a season's postseason games, and every club (the teams list's others left out). */
/** Seeds a league seeds: its three division winners, then its three best other clubs. */
const DIVISION_WINNERS = 3;
const WILD_CARDS = 3;

/**
 * Each league's six seeds: its division winners 1 to 3 by their place in the league, then its next
 * three clubs by the same 4 to 6. A league whose standings lack a division or league place for a
 * club near the top gives no seeds, rather than a guess.
 */
export function toMlbSeeds(standings: readonly MlbStanding[]): PlayoffSeedRanks {
  const seeds = new Map<number, number>();
  for (const league of MLB_LEAGUES) {
    const rows = standings.flatMap((standing) => {
      const { team, division_rank: divisionRank, league_rank: leagueRank } = standing;
      return team?.id === undefined || team.league !== league ? [] : [{ id: team.id, divisionRank, leagueRank }];
    });
    if (rows.some((row) => row.divisionRank === undefined || row.leagueRank === undefined)) continue;
    const byPlace = [...rows].sort((left, right) => (left.leagueRank ?? 0) - (right.leagueRank ?? 0));
    const winners = byPlace.filter((row) => row.divisionRank === 1).slice(0, DIVISION_WINNERS);
    const wildCards = byPlace.filter((row) => !winners.includes(row)).slice(0, WILD_CARDS);
    if (winners.length !== DIVISION_WINNERS || wildCards.length !== WILD_CARDS) continue;
    [...winners, ...wildCards].forEach((row, index) => seeds.set(row.id, index + 1));
  }
  return seeds;
}

export function mlbPostseasonSource(client: BalldontlieClient): PlayoffsSource {
  return {
    league: MLB_POSTSEASON,
    async games(season) {
      const games = await client.getAllPages(GAMES_PATH, { 'seasons[]': [season], postseason: true }, mlbGameListSchema);
      return games.map(toMlbPlayoffGame);
    },
    async teams() {
      const page = await client.get(TEAMS_PATH, {}, mlbTeamListSchema);
      return page.data.filter(isMlbClub).map((team) => toMlbPlayoffTeam(team, TEAMS_PATH));
    },
    async seedRanks(season) {
      const page = await client.get(STANDINGS_PATH, { season }, mlbStandingListSchema);
      return toMlbSeeds(page.data);
    },
  };
}
