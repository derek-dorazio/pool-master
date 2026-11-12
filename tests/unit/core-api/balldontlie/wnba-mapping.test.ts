import { Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { wnbaGameListSchema, wnbaTeamListSchema, type WnbaGame } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/wnba-contract';
import { isWnbaFranchise, toWnbaPlayoffGame, toWnbaPlayoffTeam, WNBA_PLAYOFFS } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/wnba-mapping';
import { playoffSeries } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/series-playoff-rounds';
import { toPlayoffsEvent } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/series-playoffs';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/** The row at `index`; a fixture without one is a broken fixture. */
function rowAt<Row>(rows: readonly Row[], index: number): Row {
  const row = rows.at(index);
  if (row === undefined) throw new Error(`the fixture has no row ${String(index)}`);
  return row;
}

/** A copy of the game without one field, as a vendor row that leaves it out. */
function without(game: WnbaGame, field: keyof WnbaGame): WnbaGame {
  const copy = { ...game };
  delete copy[field];
  return copy;
}

const gamesIn = (file: string): WnbaGame[] => wnbaGameListSchema.parse(readBalldontlieFixture('wnba', file)).data;
const season2025 = gamesIn('games-2025.json');
const partial = gamesIn('games-2026-partial.json');
const regularSeason = rowAt(partial, 0);
const playoffFinal = rowAt(partial, 1);
const aces = rowAt(wnbaTeamListSchema.parse(readBalldontlieFixture('wnba', 'teams.json')).data, 2);

describe('WNBA playoffs league', () => {
  it('is basketball\'s WNBA playoffs, played in the season\'s own year, ending in best-of-seven Finals', () => {
    expect(WNBA_PLAYOFFS).toMatchObject({ key: 'wnba', tour: 'WNBA', sport: Sport.BASKETBALL, playoffYearOffset: 0 });
    expect(WNBA_PLAYOFFS.rounds.at(-1)).toMatchObject({ name: 'WNBA Finals', seriesLength: 7 });
  });

  it('names its three rounds with each one\'s series length and count, which a real bracket fills exactly', () => {
    const games = season2025.map(toWnbaPlayoffGame).filter((game) => game.postseason);
    const seriesByRound = WNBA_PLAYOFFS.rounds.map((_, index) => playoffSeries(games).filter((each) => each.round === index + 1).length);

    expect(WNBA_PLAYOFFS.rounds.map((round) => [round.name, round.seriesLength, round.seriesCount])).toEqual([
      ['WNBA First Round', 3, 4],
      ['WNBA Semifinals', 5, 2],
      ['WNBA Finals', 7, 1],
    ]);
    expect(seriesByRound).toEqual([4, 2, 1]);
  });
});

describe('toWnbaPlayoffTeam', () => {
  it('keeps the team\'s id and full name, with its abbreviation and conference as facts', () => {
    expect(toWnbaPlayoffTeam(aces, '/wnba/v1/teams')).toEqual({
      id: 7,
      name: 'Las Vegas Aces',
      metadata: { abbreviation: 'LVA', conference: 'Western' },
    });
  });

  it('refuses a team with no id or no full name, naming the field and the path', () => {
    expect(() => toWnbaPlayoffTeam({ full_name: 'Las Vegas Aces' }, '/wnba/v1/teams')).toThrow(new BalldontlieContractError('/wnba/v1/teams', ['a team has no id']));
    expect(() => toWnbaPlayoffTeam({ id: 7 }, '/wnba/v1/teams')).toThrow(new BalldontlieContractError('/wnba/v1/teams', ['team 7 has no full_name']));
  });
});

describe('isWnbaFranchise', () => {
  it('keeps a team in a conference and leaves out one in none, as a folded franchise may be', () => {
    expect(isWnbaFranchise(aces)).toBe(true);
    expect(isWnbaFranchise({ ...aces, conference: '' })).toBe(false);
    expect(isWnbaFranchise({ id: 20, full_name: 'Houston Comets' })).toBe(false);
  });
});

describe('toWnbaPlayoffGame', () => {
  it('reads whether a game is a playoff game from its postseason flag', () => {
    expect(toWnbaPlayoffGame(playoffFinal).postseason).toBe(true);
    expect(toWnbaPlayoffGame(regularSeason).postseason).toBe(false);
  });

  it('places a game at its tip-off and reads its season, teams, state and score', () => {
    expect(toWnbaPlayoffGame(playoffFinal)).toMatchObject({
      id: 4262001,
      season: 2026,
      start: Date.parse('2026-09-13T19:00:00.000Z'),
      home: { id: 8, name: 'Minnesota Lynx' },
      away: { id: 10, name: 'Phoenix Mercury' },
      state: 'final',
      homeScore: 91,
      awayScore: 80,
    });
  });

  it('reads a game the vendor sends with no score as no score', () => {
    expect(toWnbaPlayoffGame(without(without(playoffFinal, 'home_score'), 'away_score'))).toMatchObject({ homeScore: null, awayScore: null });
  });

  it.each(['id', 'season', 'postseason', 'date', 'home_team', 'visitor_team'] as const)('refuses a game with no %s, naming it', (field) => {
    const row = field === 'id' ? 'game (no id)' : 'game 4262001';
    expect(() => toWnbaPlayoffGame(without(playoffFinal, field))).toThrow(new BalldontlieContractError('/wnba/v1/games', [`${row} has no ${field}`]));
  });

  it('makes a full playoffs, eight teams to Finals won four games to none, a completed event of 2025', () => {
    const event = toPlayoffsEvent(WNBA_PLAYOFFS, 2025, season2025.map(toWnbaPlayoffGame).filter((game) => game.postseason));
    expect(event).toMatchObject({
      externalId: 'wnba-2025-postseason',
      name: 'WNBA Playoffs',
      sport: Sport.BASKETBALL,
      status: 'COMPLETED',
      startDate: new Date('2025-09-14T23:30:00.000Z'),
      endDate: new Date('2025-10-09T23:30:00.000Z'),
      metadata: { tour: 'WNBA', season: 2025 },
    });
  });
});
