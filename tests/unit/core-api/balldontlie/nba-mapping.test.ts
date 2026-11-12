import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import { nbaTeamListSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nba-contract';
import { toNbaPlayoffGame, toNbaPlayoffPlayer, toNbaPlayoffTeam, toNbaPlayoffTeams, toNbaStatLine } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nba-mapping';

/**
 * The NBA normalizers' refusals: the vendor's document leaves every field but the state optional,
 * and a row missing one the playoffs cannot be placed or scored without is a contract error that
 * names the row and the field, not a game quietly dropped. The happy paths run in
 * nba-adapter.test.ts against the fixtures.
 */

const OKC = { id: 21, full_name: 'Oklahoma City Thunder', abbreviation: 'OKC', conference: 'West' as const, division: 'Northwest' as const };
const IND = { id: 12, full_name: 'Indiana Pacers', abbreviation: 'IND', conference: 'East' as const, division: 'Central' as const };
const GAME = {
  id: 18444001,
  date: '2025-06-05',
  datetime: '2025-06-06T00:30:00Z',
  season: 2024,
  status_state: CompetitionStatusState.FINAL,
  home_team_score: 110,
  visitor_team_score: 111,
  home_team: OKC,
  visitor_team: IND,
};

const LINE = { min: '40:12', pts: 22, reb: 12, ast: 6, player: { id: 3202, first_name: 'Jayson', last_name: 'Tatum' }, game: { id: 18444001 } };

describe('NBA playoffs normalizers', () => {
  it('refuses a team with no name, naming the team and the path it came from', () => {
    expect(() => toNbaPlayoffTeam({ id: 21 }, '/nba/v1/teams')).toThrow('team 21 has no full_name');
  });

  it('refuses a game with no id, saying it has none', () => {
    expect(() => toNbaPlayoffGame({ ...GAME, id: undefined })).toThrow('game (no id) has no id');
  });

  it('refuses a game with neither a tip-off nor a day, since it cannot be placed in the playoffs', () => {
    expect(() => toNbaPlayoffGame({ ...GAME, date: undefined, datetime: null })).toThrow('game 18444001 has no date');
  });

  it('reads a game with no score yet as having none, not 0-0', () => {
    expect(toNbaPlayoffGame({ ...GAME, home_team_score: undefined, visitor_team_score: undefined })).toMatchObject({ homeScore: null, awayScore: null });
  });

  it('reads a teams list holding a defunct franchise with a blank conference and division, keeping only the teams in the East or West', () => {
    // The vendor's document gives both as enums, so this row breaks it and cannot be served by the
    // fake API; the live list is thought to hold such rows (ids above 30) and must not fail on them.
    const page = nbaTeamListSchema.parse({
      data: [
        OKC,
        { id: 37, conference: '', division: '', full_name: 'Chicago Stags', abbreviation: 'CHS' },
        { id: 38, full_name: 'Baltimore Bullets', abbreviation: 'BAL' },
        IND,
      ],
    });

    expect(toNbaPlayoffTeams(page.data).map((team) => team.name)).toEqual(['Oklahoma City Thunder', 'Indiana Pacers']);
  });

  it.each([
    ['empty', ''],
    ['zero minutes', '0'],
    ['zero minutes and seconds', '00:00'],
    ['missing', undefined],
  ])('gives no line for a player whose minutes are %s, one who did not get in', (_label, min) => {
    expect(toNbaStatLine({ ...LINE, min })).toBeNull();
  });

  it('gives a line for a player on the floor only seconds', () => {
    expect(toNbaStatLine({ ...LINE, min: '0:12' })).toEqual({
      gameId: 18444001,
      playerId: 3202,
      stats: [{ stat: 'POINTS', value: 22 }, { stat: 'REBOUNDS', value: 12 }, { stat: 'ASSISTS', value: 6 }],
    });
  });

  it('refuses a played stat row with no player, no player id or no game, naming what is missing', () => {
    expect(() => toNbaStatLine({ ...LINE, player: undefined })).toThrow('a stat row has no player');
    expect(() => toNbaStatLine({ ...LINE, player: {} })).toThrow('a stat row\'s player has no id');
    expect(() => toNbaStatLine({ ...LINE, game: undefined })).toThrow('player 3202\'s stat row has no game');
    expect(() => toNbaStatLine({ ...LINE, game: {} })).toThrow('player 3202\'s stat row has no game id');
  });

  it('refuses a played stat row missing rebounds or assists, which Triple Threat scores', () => {
    expect(() => toNbaStatLine({ ...LINE, reb: undefined })).toThrow('player 3202\'s stat row has no reb');
    expect(() => toNbaStatLine({ ...LINE, ast: undefined })).toThrow('player 3202\'s stat row has no ast');
  });

  it('names a player by whichever of his names the vendor gives, keeping his position and team', () => {
    expect(toNbaPlayoffPlayer({ id: 7, last_name: 'Nene', position: 'C', team: OKC })).toEqual({ id: 7, name: 'Nene', metadata: { position: 'C', team: 'Oklahoma City Thunder' } });
  });

  it('refuses a player with no id or no name at all, naming the player', () => {
    expect(() => toNbaPlayoffPlayer({ first_name: 'Sam' })).toThrow('a player has no id');
    expect(() => toNbaPlayoffPlayer({ id: 7, first_name: '', last_name: '' })).toThrow('player 7 has no first_name or last_name');
  });
});
