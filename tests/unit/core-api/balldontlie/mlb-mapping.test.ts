import { Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { mlbGameListSchema, mlbTeamListSchema, type MlbGame } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/mlb-contract';
import { isMlbClub, MLB_POSTSEASON, toMlbPlayoffGame, toMlbPlayoffTeam } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/mlb-mapping';
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
function without(game: MlbGame, field: keyof MlbGame): MlbGame {
  const copy = { ...game };
  delete copy[field];
  return copy;
}

const gamesIn = (file: string): MlbGame[] => mlbGameListSchema.parse(readBalldontlieFixture('mlb', file)).data;
const postseason2025 = gamesIn('games-2025-postseason.json');
const partial = gamesIn('games-2026-postseason-partial.json');
const partialFinal = rowAt(partial, 0);
const partialScheduled = rowAt(partial, 2);
const dodgers = rowAt(mlbTeamListSchema.parse(readBalldontlieFixture('mlb', 'teams.json')).data, 10);

describe('MLB postseason league', () => {
  it('is baseball\'s postseason, played in the season\'s own year, ending in a best-of-seven World Series', () => {
    expect(MLB_POSTSEASON).toMatchObject({ key: 'mlb', tour: 'MLB', sport: Sport.BASEBALL, playoffYearOffset: 0 });
    expect(MLB_POSTSEASON.rounds.at(-1)).toMatchObject({ name: 'World Series', seriesLength: 7 });
  });

  it('names its four rounds with each one\'s series length and count, which a real bracket with four byes fills exactly', () => {
    const games = postseason2025.map(toMlbPlayoffGame);
    const seriesByRound = MLB_POSTSEASON.rounds.map((_, index) => playoffSeries(games).filter((each) => each.round === index + 1).length);

    expect(MLB_POSTSEASON.rounds.map((round) => [round.name, round.seriesLength, round.seriesCount])).toEqual([
      ['MLB Wild Card Series', 3, 4],
      ['MLB Division Series', 5, 4],
      ['MLB League Championship Series', 7, 2],
      ['World Series', 7, 1],
    ]);
    expect(seriesByRound).toEqual([4, 4, 2, 1]);
  });
});

describe('toMlbPlayoffTeam', () => {
  it('keeps the team\'s id and full display name, with its abbreviation, league and division as facts', () => {
    expect(toMlbPlayoffTeam(dodgers, '/mlb/v1/teams')).toEqual({
      id: 18,
      name: 'Los Angeles Dodgers',
      metadata: { abbreviation: 'LAD', league: 'National', division: 'West' },
    });
  });

  it('refuses a team with no id or no display name, naming the field and the path', () => {
    expect(() => toMlbPlayoffTeam({ display_name: 'Los Angeles Dodgers' }, '/mlb/v1/teams')).toThrow(new BalldontlieContractError('/mlb/v1/teams', ['a team has no id']));
    expect(() => toMlbPlayoffTeam({ id: 18 }, '/mlb/v1/teams')).toThrow(new BalldontlieContractError('/mlb/v1/teams', ['team 18 has no display_name']));
  });
});

describe('isMlbClub', () => {
  it('keeps a team of the American or the National League', () => {
    expect(isMlbClub(dodgers)).toBe(true);
    expect(isMlbClub({ ...dodgers, league: 'American' })).toBe(true);
  });

  it('leaves out a team of no league, such as an All-Star side with a blank league, or one that names none', () => {
    expect(isMlbClub({ id: 31, display_name: 'American League All-Stars', league: '', division: '' })).toBe(false);
    expect(isMlbClub({ id: 32, display_name: 'Team With No League' })).toBe(false);
  });
});

describe('toMlbPlayoffGame', () => {
  it('places a game at its first pitch and takes each side\'s runs as its score', () => {
    expect(toMlbPlayoffGame(partialFinal)).toMatchObject({
      id: 5066001,
      season: 2026,
      start: Date.parse('2026-09-29T18:08:00.000Z'),
      home: { id: 10, name: 'New York Yankees' },
      away: { id: 7, name: 'Detroit Tigers' },
      state: 'final',
      homeScore: 4,
      awayScore: 1,
    });
  });

  it('reads a game with no line yet, before the first pitch, as no score', () => {
    expect(toMlbPlayoffGame(partialScheduled)).toMatchObject({ state: 'scheduled', homeScore: null, awayScore: null });
    expect(toMlbPlayoffGame({ ...partialFinal, home_team_data: {}, away_team_data: {} })).toMatchObject({ homeScore: null, awayScore: null });
  });

  it.each(['id', 'season', 'postseason', 'date', 'home_team', 'away_team'] as const)('refuses a game with no %s, naming it', (field) => {
    const row = field === 'id' ? 'game (no id)' : 'game 5066001';
    expect(() => toMlbPlayoffGame(without(partialFinal, field))).toThrow(new BalldontlieContractError('/mlb/v1/games', [`${row} has no ${field}`]));
  });

  it('refuses a game whose side has no team id, naming the games path', () => {
    expect(() => toMlbPlayoffGame({ ...partialFinal, away_team: { display_name: 'Detroit Tigers' } }))
      .toThrow(new BalldontlieContractError('/mlb/v1/games', ['a team has no id']));
  });

  it('makes a full postseason, twelve teams to a World Series won four games to three, a completed event of 2025', () => {
    const event = toPlayoffsEvent(MLB_POSTSEASON, 2025, postseason2025.map(toMlbPlayoffGame));
    expect(event).toMatchObject({
      externalId: 'mlb-2025-postseason',
      name: 'MLB Postseason',
      sport: Sport.BASEBALL,
      status: 'COMPLETED',
      startDate: new Date('2025-09-30T23:08:00.000Z'),
      endDate: new Date('2025-10-30T23:08:00.000Z'),
      metadata: { tour: 'MLB', season: 2025 },
    });
  });

  it('keeps the postseason in progress after the Division Series, with every listed game final but no World Series yet', () => {
    const throughDivisionSeries = postseason2025.filter((game) => Date.parse(game.date ?? '') < Date.parse('2025-10-12T00:00:00Z'));
    expect(toPlayoffsEvent(MLB_POSTSEASON, 2025, throughDivisionSeries.map(toMlbPlayoffGame)).status).toBe('IN_PROGRESS');
  });
});
