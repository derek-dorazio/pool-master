import { MatchSide, ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import { ncaabBracketListSchema, ncaaBracketListSchema, ncaaTeamListSchema, type NcaaBracketGame } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaa-tournament-contract';
import {
  NCAA_MEN,
  NCAA_WOMEN,
  ncaaTournamentScopeId,
  parseNcaaTournamentScope,
  toNcaaBracket,
  toNcaaFieldParticipants,
  toNcaaGameScoreUpdates,
  toNcaaScheduledGames,
  toNcaaTeamParticipant,
  toNcaaTournamentEvent,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaa-tournament-mapping';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';
import { ncaaFullBracket, ncaaTeamId } from '../../../support/ncaa-full-bracket';

const bracketIn = (file: string, league = 'ncaab'): NcaaBracketGame[] => ncaaBracketListSchema.parse(readBalldontlieFixture(league, file)).data;
const bracket2025 = bracketIn('bracket-2025.json');
const [firstFour2025, duke2025, , championship2025] = bracket2025;
const bracket2026 = bracketIn('bracket-2026-partial.json');
const [final2026, live2026, scheduled2026, unknown2026, halfDecided2026, championship2026] = bracket2026;
const womens2025 = bracketIn('bracket-2025.json', 'ncaaw');
const SEASON_2025 = { league: NCAA_MEN, season: 2025 };
const SEASON_2026 = { league: NCAA_MEN, season: 2026 };
const WOMENS_2025 = { league: NCAA_WOMEN, season: 2025 };

function withState(game: NcaaBracketGame, status_state: CompetitionStatusState): NcaaBracketGame {
  return { ...game, status_state };
}

describe('NCAA tournament scopes', () => {
  it('names a season\'s men\'s and women\'s tournaments by league, and reads each name back', () => {
    expect(ncaaTournamentScopeId(SEASON_2025)).toBe('ncaab-2025-tournament');
    expect(ncaaTournamentScopeId(WOMENS_2025)).toBe('ncaaw-2025-tournament');
    expect(parseNcaaTournamentScope('ncaab-2025-tournament')).toEqual(SEASON_2025);
    expect(parseNcaaTournamentScope('ncaaw-2025-tournament')).toEqual(WOMENS_2025);
  });

  it('reads a golf tournament id, an NFL scope or a malformed id as no NCAA tournament', () => {
    expect(parseNcaaTournamentScope('41')).toBeNull();
    expect(parseNcaaTournamentScope('nfl-2025-postseason')).toBeNull();
    expect(parseNcaaTournamentScope('ncaab-25-tournament')).toBeNull();
    expect(parseNcaaTournamentScope('ncaaf-2025-tournament')).toBeNull();
  });
});

describe('an NCAA men\'s tournament as an event', () => {
  it('is complete once its championship is listed and every game is final, spanning the First Four to the championship', () => {
    expect(toNcaaTournamentEvent(SEASON_2025, bracket2025)).toEqual({
      externalId: 'ncaab-2025-tournament',
      providerId: 'balldontlie',
      sport: Sport.BASKETBALL,
      name: 'NCAA Men\'s Tournament',
      startDate: new Date('2026-03-17T23:40:00.000Z'),
      endDate: new Date('2026-04-07T01:20:00.000Z'),
      status: 'COMPLETED',
      rounds: 7,
      fieldLocked: true,
      providerSlots: [
        { code: 'POST:1', startsAt: new Date('2026-03-17T23:40:00.000Z'), endsAt: new Date('2026-03-17T23:40:00.000Z') },
        { code: 'POST:2', startsAt: new Date('2026-03-19T16:15:00.000Z'), endsAt: new Date('2026-03-19T19:00:00.000Z') },
        { code: 'POST:7', startsAt: new Date('2026-04-07T01:20:00.000Z'), endsAt: new Date('2026-04-07T01:20:00.000Z') },
      ],
    });
  });

  it('is under way while a game is live or final and others are to play, its undated championship left out of the dates', () => {
    expect(toNcaaTournamentEvent(SEASON_2026, bracket2026)).toMatchObject({
      status: 'IN_PROGRESS',
      fieldLocked: true,
      startDate: new Date('2027-03-18T16:15:00.000Z'),
      endDate: new Date('2027-03-20T17:00:00.000Z'),
    });
  });

  it('is not over while its championship is not yet listed, however many listed games are final', () => {
    expect(toNcaaTournamentEvent(SEASON_2025, [firstFour2025, duke2025]).status).toBe('IN_PROGRESS');
  });

  it('is scheduled, with its field open, before any game starts', () => {
    expect(toNcaaTournamentEvent(SEASON_2026, [scheduled2026, championship2026])).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
  });

  it('refuses a bracket with no dated game, naming the season', () => {
    expect(() => toNcaaTournamentEvent(SEASON_2026, [championship2026])).toThrow(BalldontlieContractError);
    expect(() => toNcaaTournamentEvent(SEASON_2026, [championship2026])).toThrow('the 2026 bracket has no game with a date');
  });
});

describe('NCAA men\'s basketball teams', () => {
  it('lists a team under its raw feed id and full name', () => {
    const [duke] = ncaaTeamListSchema.parse(readBalldontlieFixture('ncaab', 'teams.json')).data;
    expect(toNcaaTeamParticipant(NCAA_MEN, duke)).toEqual({
      externalId: '150',
      providerId: 'balldontlie',
      sport: Sport.BASKETBALL,
      name: 'Duke Blue Devils',
      status: 'ACTIVE',
      metadata: { abbreviation: 'DUKE' },
    });
  });

  it('refuses a team with no id or no full name', () => {
    expect(() => toNcaaTeamParticipant(NCAA_MEN, { full_name: 'Duke Blue Devils' })).toThrow('a team has no id');
    expect(() => toNcaaTeamParticipant(NCAA_MEN, { id: 150 })).toThrow('team 150 has no full_name');
  });

  it('lists the bracket\'s decided teams once each, each with its seed, the First Four\'s two teams among them', () => {
    const field = toNcaaFieldParticipants(NCAA_MEN, bracket2025);
    expect(field.map((team) => [team.externalId, team.name, team.seed])).toEqual([
      ['251', 'Texas Longhorns', 11],
      ['152', 'NC State Wolfpack', 11],
      ['150', 'Duke Blue Devils', 1],
      ['2561', 'Siena Saints', 16],
      ['194', 'Ohio State Buckeyes', 8],
      ['2628', 'TCU Horned Frogs', 9],
      ['57', 'Florida Gators', 1],
    ]);
  });

  it('lists a First Four team before its game is played, while it shows only in the First Four', () => {
    const scheduledFirstFour = withState(firstFour2025, CompetitionStatusState.SCHEDULED);
    expect(toNcaaFieldParticipants(NCAA_MEN, [scheduledFirstFour, duke2025]).map((team) => team.externalId)).toEqual(['251', '152', '150', '2561']);
  });

  it('lists a First Four winner once after it plays, though it now shows in a round of 64 game too', () => {
    const texasInRoundOf64: NcaaBracketGame = { ...duke2025, away_team: firstFour2025.home_team };
    expect(toNcaaFieldParticipants(NCAA_MEN, [firstFour2025, texasInRoundOf64]).map((team) => team.externalId)).toEqual(['251', '152', '150']);
  });

  it('names no team for a side still to be decided, and takes the short name or no seed when that is all the bracket gives', () => {
    const tbdGame: NcaaBracketGame = { ...halfDecided2026, home_team: { id: 9, name: 'Wildcats', full_name: null, seed: null } };
    expect(toNcaaFieldParticipants(NCAA_MEN, [tbdGame, championship2026]).map((team) => [team.externalId, team.name, team.seed])).toEqual([
      ['9', 'Wildcats', undefined],
    ]);
  });

  it('refuses a decided team with no name at all', () => {
    const nameless: NcaaBracketGame = { ...duke2025, home_team: { id: 150, full_name: null } };
    expect(() => toNcaaFieldParticipants(NCAA_MEN, [nameless])).toThrow('a team of bracket game 401856490 has no name');
  });
});

describe('NCAA men\'s tournament game scores', () => {
  it('gives each game whose teams are decided, the First Four\'s included, leaving out an unknown state', () => {
    expect(toNcaaGameScoreUpdates(NCAA_MEN, bracket2026)).toEqual([
      { providerGameId: '401900101', homeTeamExternalId: '57', awayTeamExternalId: '2390', state: ProviderGameState.FINAL, homeScore: 81, awayScore: 58 },
      { providerGameId: '401900102', homeTeamExternalId: '194', awayTeamExternalId: '2628', state: ProviderGameState.IN_PROGRESS, homeScore: 44, awayScore: 47 },
      { providerGameId: '401900103', homeTeamExternalId: '150', awayTeamExternalId: '2561', state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null },
    ]);
    expect(toNcaaGameScoreUpdates(NCAA_MEN, [firstFour2025, unknown2026])).toEqual([
      { providerGameId: '401856478', homeTeamExternalId: '251', awayTeamExternalId: '152', state: ProviderGameState.FINAL, homeScore: 68, awayScore: 59 },
    ]);
  });

  it('reads no score before tip-off, whatever the vendor sends', () => {
    const early = withState(live2026, CompetitionStatusState.POSTPONED);
    expect(toNcaaGameScoreUpdates(NCAA_MEN, [early])[0]).toMatchObject({ state: ProviderGameState.POSTPONED, homeScore: null, awayScore: null });
  });

  it('passes on a final with no score as one, for the writer to skip', () => {
    const scoreless: NcaaBracketGame = { ...final2026, home_team: { ...final2026.home_team, score: null } };
    expect(toNcaaGameScoreUpdates(NCAA_MEN, [scoreless])[0]).toMatchObject({ state: ProviderGameState.FINAL, homeScore: null, awayScore: 58 });
  });

  it('refuses a game with both teams decided but no game id or no round', () => {
    expect(() => toNcaaGameScoreUpdates(NCAA_MEN, [{ ...championship2025, game_id: null }])).toThrow('a bracket game with both teams has no game_id');
    expect(() => toNcaaGameScoreUpdates(NCAA_MEN, [{ ...championship2025, round: undefined }])).toThrow('bracket game 401856550 has no round');
  });
});

describe('the NCAA women\'s tournament, whose bracket numbers the First Four round 0 and the championship round 6', () => {
  it('is an event of its own, seven rounds long from its round 0 First Four, and complete once its round 6 championship is final', () => {
    expect(toNcaaTournamentEvent(WOMENS_2025, womens2025)).toEqual({
      externalId: 'ncaaw-2025-tournament',
      providerId: 'balldontlie',
      sport: Sport.BASKETBALL,
      name: 'NCAA Women\'s Tournament',
      startDate: new Date('2026-03-18T23:00:00.000Z'),
      endDate: new Date('2026-04-05T19:00:00.000Z'),
      status: 'COMPLETED',
      rounds: 7,
      fieldLocked: true,
      providerSlots: [
        { code: 'POST:0', startsAt: new Date('2026-03-18T23:00:00.000Z'), endsAt: new Date('2026-03-18T23:00:00.000Z') },
        { code: 'POST:1', startsAt: new Date('2026-03-20T19:00:00.000Z'), endsAt: new Date('2026-03-20T21:30:00.000Z') },
        { code: 'POST:6', startsAt: new Date('2026-04-05T19:00:00.000Z'), endsAt: new Date('2026-04-05T19:00:00.000Z') },
      ],
    });
  });

  it('is not over while only the men\'s championship round, 7, would say so', () => {
    const [firstFour, uconn] = womens2025;
    expect(toNcaaTournamentEvent(WOMENS_2025, [firstFour, { ...uconn, round: 7 }]).status).toBe('IN_PROGRESS');
  });

  it('lists a women\'s team under the feed\'s raw id with the women\'s tour, apart from the men\'s team of the same school', () => {
    const [, duke] = ncaaTeamListSchema.parse(readBalldontlieFixture('ncaaw', 'teams.json')).data;
    expect(toNcaaTeamParticipant(NCAA_WOMEN, duke)).toMatchObject({ externalId: '150', name: 'Duke Blue Devils', metadata: { abbreviation: 'DUKE' } });
  });

  it('lists the round 0 First Four\'s teams in the field with every round 1 team, each with its seed', () => {
    expect(toNcaaFieldParticipants(NCAA_WOMEN, womens2025).map((team) => [team.externalId, team.seed])).toEqual([
      ['2390', 16],
      ['2569', 16],
      ['41', 1],
      ['2636', 16],
      ['150', 3],
      ['2655', 14],
      ['2579', 1],
    ]);
  });

  it('gives game scores from the round 0 First Four on', () => {
    expect(toNcaaGameScoreUpdates(NCAA_WOMEN, womens2025).map((game) => [game.providerGameId, game.homeTeamExternalId, game.awayTeamExternalId, game.homeScore, game.awayScore])).toEqual([
      ['401856700', '2390', '2569', 62, 55],
      ['401856710', '41', '2636', 88, 50],
      ['401856711', '150', '2655', 74, 61],
      ['401856772', '41', '2579', 72, 66],
    ]);
  });

});

describe('an NCAA men\'s bracket from the vendor\'s (#1728)', () => {
  const whole = ncaabBracketListSchema.parse({ data: ncaaFullBracket() }).data;
  const firstFourPlayed = ncaabBracketListSchema.parse({ data: ncaaFullBracket({ firstFourFinal: true }) }).data;
  const team = (regionId: number, seed: number) => `${ncaaTeamId(regionId, seed)}`;

  it('lays out the First Four as round 1, in region order, each game advancing into the side of the round of 64 game its seed plays in', () => {
    const bracket = toNcaaBracket(SEASON_2025, whole);
    expect(bracket?.filter((match) => match.roundNumber === 1).map((match) => [match.matchNumber, match.regionLabel, match.homeTeamExternalId, match.awayTeamExternalId, match.advancesTo])).toEqual([
      [1, 'East', '111', '151', { roundNumber: 2, matchNumber: 5, side: MatchSide.AWAY }],
      [2, 'South', '316', '356', { roundNumber: 2, matchNumber: 17, side: MatchSide.AWAY }],
    ]);
  });

  it('lays out the round of 64 as round 2 by region in region id order, each region top to bottom by seed, the better seed home and a First Four side empty', () => {
    const bracket = toNcaaBracket(SEASON_2025, whole);
    const firstRound = bracket?.filter((match) => match.roundNumber === 2).map((match) => [match.matchNumber, match.regionLabel, match.homeTeamExternalId, match.awayTeamExternalId]);
    expect(firstRound?.slice(0, 8)).toEqual([
      [1, 'East', team(1, 1), team(1, 16)],
      [2, 'East', team(1, 8), team(1, 9)],
      [3, 'East', team(1, 5), team(1, 12)],
      [4, 'East', team(1, 4), team(1, 13)],
      [5, 'East', team(1, 6), null],
      [6, 'East', team(1, 3), team(1, 14)],
      [7, 'East', team(1, 7), team(1, 10)],
      [8, 'East', team(1, 2), team(1, 15)],
    ]);
    expect(firstRound?.map((match) => match[1])).toEqual(['East', 'West', 'South', 'Midwest'].flatMap((region) => Array.from({ length: 8 }, () => region)));
    expect(firstRound?.[16]).toEqual([17, 'South', team(3, 1), null]);
  });

  it('links each pair of games into the next round through the Elite Eight, the first two regions\' champions meeting in the first semifinal and the last two in the second', () => {
    const bracket = toNcaaBracket(SEASON_2025, whole) ?? [];
    const game = (roundNumber: number, matchNumber: number) =>
      bracket.find((match) => match.roundNumber === roundNumber && match.matchNumber === matchNumber);
    const to = (roundNumber: number, matchNumber: number, side: MatchSide) => ({ roundNumber, matchNumber, side });
    expect(bracket).toHaveLength(65);
    expect(bracket.map((match) => match.roundNumber).filter((round, index, rounds) => rounds.indexOf(round) === index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect([1, 2, 3, 4, 5, 6, 7].map((round) => bracket.filter((match) => match.roundNumber === round).map((match) => match.matchNumber)))
      .toEqual([2, 32, 16, 8, 4, 2, 1].map((count) => Array.from({ length: count }, (_, index) => index + 1)));
    expect(([[2, 1], [2, 2], [2, 32], [3, 1], [4, 8], [5, 1], [5, 2], [5, 3], [5, 4], [6, 1], [6, 2]] as const)
      .map(([round, number]) => [round, number, game(round, number)?.advancesTo])).toEqual([
      [2, 1, to(3, 1, MatchSide.HOME)],
      [2, 2, to(3, 1, MatchSide.AWAY)],
      [2, 32, to(3, 16, MatchSide.AWAY)],
      [3, 1, to(4, 1, MatchSide.HOME)],
      [4, 8, to(5, 4, MatchSide.AWAY)],
      [5, 1, to(6, 1, MatchSide.HOME)],
      [5, 2, to(6, 1, MatchSide.AWAY)],
      [5, 3, to(6, 2, MatchSide.HOME)],
      [5, 4, to(6, 2, MatchSide.AWAY)],
      [6, 1, to(7, 1, MatchSide.HOME)],
      [6, 2, to(7, 1, MatchSide.AWAY)],
    ]);
    expect(game(7, 1)?.advancesTo).toBeNull();
    expect([1, 2, 3, 4].map((number) => game(5, number)?.regionLabel)).toEqual(['East', 'West', 'South', 'Midwest']);
    expect([game(6, 1), game(6, 2), game(7, 1)].map((match) => match?.regionLabel)).toEqual([null, null, null]);
    expect([game(1, 1), game(2, 1)].map((match) => match?.scheduledAt instanceof Date)).toEqual([true, true]);
    expect(game(3, 1)?.scheduledAt).toBeNull();
  });

  it('lays out no bracket for the women\'s tournament, whose bracket names no region, nor for a region short of its eight games', () => {
    expect(toNcaaBracket(WOMENS_2025, whole)).toBeNull();
    expect(toNcaaBracket(SEASON_2025, whole.filter((game) => !(game.round === 2 && game.region_label === 'West' && game.home_team?.seed === '1')))).toBeNull();
  });

  it('lays out the same bracket once the First Four is played, the round of 64 side its winner now shows in still left for the winner to advance into', () => {
    const shape = (games: NcaaBracketGame[]) => toNcaaBracket(SEASON_2025, games)?.map(({ scheduledAt: _scheduledAt, ...match }) => match);
    expect(shape(firstFourPlayed)).toEqual(shape(whole));
    expect(shape(firstFourPlayed)?.filter((match) => match.roundNumber === 2 && match.awayTeamExternalId === null).map((match) => match.matchNumber)).toEqual([5, 17]);
  });

  it('gives every game with both teams, the First Four\'s as round 1 and the round of 64\'s as round 2, a First Four side\'s game once its winner shows in it', () => {
    const games = toNcaaScheduledGames(NCAA_MEN, whole);
    expect(games.map((game) => game.roundNumber)).toEqual([1, 1, ...Array.from({ length: 30 }, () => 2)]);
    expect(toNcaaScheduledGames(NCAA_MEN, firstFourPlayed)).toHaveLength(34);
    expect(toNcaaScheduledGames(NCAA_WOMEN, womens2025).map((game) => game.roundNumber)).toEqual([1, 2, 2, 7]);
  });
});
