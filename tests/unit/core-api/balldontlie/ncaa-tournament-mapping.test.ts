import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import { ncaaBracketListSchema, ncaaTeamListSchema, type NcaaBracketGame } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaa-tournament-contract';
import {
  NCAA_MEN,
  NCAA_WOMEN,
  ncaaTournamentScopeId,
  parseNcaaTournamentScope,
  toNcaaFieldParticipants,
  toNcaaGameScoreUpdates,
  toNcaaTeamParticipant,
  toNcaaTournamentEvent,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaa-tournament-mapping';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

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
    expect(toNcaaTournamentEvent(SEASON_2025, bracket2025, 68)).toEqual({
      externalId: 'ncaab-2025-tournament',
      providerId: 'balldontlie',
      sport: Sport.BASKETBALL,
      name: 'NCAA Men\'s Tournament',
      startDate: new Date('2026-03-17T23:40:00.000Z'),
      endDate: new Date('2026-04-07T01:20:00.000Z'),
      status: 'COMPLETED',
      rounds: 6,
      participantCount: 68,
      fieldLocked: true,
      metadata: { tour: NCAA_MEN.tour, season: 2025 },
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
  it('lists a team under its prefixed id and full name', () => {
    const [duke] = ncaaTeamListSchema.parse(readBalldontlieFixture('ncaab', 'teams.json')).data;
    expect(toNcaaTeamParticipant(NCAA_MEN, duke)).toEqual({
      externalId: 'ncaab-team-150',
      providerId: 'balldontlie',
      sport: Sport.BASKETBALL,
      name: 'Duke Blue Devils',
      active: true,
      metadata: { tour: 'NCAAM', abbreviation: 'DUKE' },
    });
  });

  it('refuses a team with no id or no full name', () => {
    expect(() => toNcaaTeamParticipant(NCAA_MEN, { full_name: 'Duke Blue Devils' })).toThrow('a team has no id');
    expect(() => toNcaaTeamParticipant(NCAA_MEN, { id: 150 })).toThrow('team 150 has no full_name');
  });

  it('lists the bracket\'s decided teams once each, each with its seed, leaving out both First Four teams', () => {
    const field = toNcaaFieldParticipants(NCAA_MEN, bracket2025);
    expect(field.map((team) => [team.externalId, team.name, team.metadata])).toEqual([
      ['ncaab-team-150', 'Duke Blue Devils', { tour: 'NCAAM', seed: 1 }],
      ['ncaab-team-2561', 'Siena Saints', { tour: 'NCAAM', seed: 16 }],
      ['ncaab-team-194', 'Ohio State Buckeyes', { tour: 'NCAAM', seed: 8 }],
      ['ncaab-team-2628', 'TCU Horned Frogs', { tour: 'NCAAM', seed: 9 }],
      ['ncaab-team-57', 'Florida Gators', { tour: 'NCAAM', seed: 1 }],
    ]);
  });

  it('leaves out a First Four team before its game is played, while it shows only in the First Four', () => {
    const scheduledFirstFour = withState(firstFour2025, CompetitionStatusState.SCHEDULED);
    expect(toNcaaFieldParticipants(NCAA_MEN, [scheduledFirstFour, duke2025]).map((team) => team.externalId)).toEqual(['ncaab-team-150', 'ncaab-team-2561']);
  });

  it('leaves out a First Four winner after it plays, though it now shows in a round of 64 game too', () => {
    const texasInRoundOf64: NcaaBracketGame = { ...duke2025, away_team: firstFour2025.home_team };
    expect(toNcaaFieldParticipants(NCAA_MEN, [firstFour2025, texasInRoundOf64]).map((team) => team.externalId)).toEqual(['ncaab-team-150']);
  });

  it('names no team for a side still to be decided, and takes the short name or no seed when that is all the bracket gives', () => {
    const tbdGame: NcaaBracketGame = { ...halfDecided2026, home_team: { id: 9, name: 'Wildcats', full_name: null, seed: null } };
    expect(toNcaaFieldParticipants(NCAA_MEN, [tbdGame, championship2026]).map((team) => [team.externalId, team.name, team.metadata])).toEqual([
      ['ncaab-team-9', 'Wildcats', { tour: 'NCAAM' }],
    ]);
  });

  it('refuses a decided team with no name at all', () => {
    const nameless: NcaaBracketGame = { ...duke2025, home_team: { id: 150, full_name: null } };
    expect(() => toNcaaFieldParticipants(NCAA_MEN, [nameless])).toThrow('a team of bracket game 401856490 has no name');
  });
});

describe('NCAA men\'s tournament game scores', () => {
  it('gives each game from the round of 64 on whose teams are decided, leaving out the First Four and an unknown state', () => {
    expect(toNcaaGameScoreUpdates(NCAA_MEN, bracket2026)).toEqual([
      { externalGameId: '401900101', homeTeamExternalId: 'ncaab-team-57', awayTeamExternalId: 'ncaab-team-2390', state: ProviderGameState.FINAL, homeScore: 81, awayScore: 58 },
      { externalGameId: '401900102', homeTeamExternalId: 'ncaab-team-194', awayTeamExternalId: 'ncaab-team-2628', state: ProviderGameState.IN_PROGRESS, homeScore: 44, awayScore: 47 },
      { externalGameId: '401900103', homeTeamExternalId: 'ncaab-team-150', awayTeamExternalId: 'ncaab-team-2561', state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null },
    ]);
    expect(toNcaaGameScoreUpdates(NCAA_MEN, [firstFour2025, unknown2026])).toEqual([]);
  });

  it('names the First Four winner in its round of 64 game, the team that fills that side\'s play-in place', () => {
    const texasInRoundOf64: NcaaBracketGame = { ...duke2025, status_state: CompetitionStatusState.SCHEDULED, away_team: { ...firstFour2025.home_team, score: null } };
    expect(toNcaaGameScoreUpdates(NCAA_MEN, [firstFour2025, texasInRoundOf64])).toEqual([{
      externalGameId: '401856490',
      homeTeamExternalId: 'ncaab-team-150',
      awayTeamExternalId: 'ncaab-team-251',
      state: ProviderGameState.SCHEDULED,
      homeScore: null,
      awayScore: null,
      playInWinnerTeamExternalId: 'ncaab-team-251',
    }]);
  });

  it('names an away First Four winner too, and none while its First Four game is not final, has no score or is level', () => {
    const ncStateWon: NcaaBracketGame = { ...firstFour2025, home_team: { ...firstFour2025.home_team, score: 59 }, away_team: { ...firstFour2025.away_team, score: 68 } };
    const ncStateInRoundOf64: NcaaBracketGame = { ...duke2025, home_team: firstFour2025.away_team };
    expect(toNcaaGameScoreUpdates(NCAA_MEN, [ncStateWon, ncStateInRoundOf64])[0]).toMatchObject({ playInWinnerTeamExternalId: 'ncaab-team-152' });

    const texasInRoundOf64: NcaaBracketGame = { ...duke2025, away_team: firstFour2025.home_team };
    const notWon: NcaaBracketGame[] = [
      withState(firstFour2025, CompetitionStatusState.IN_PROGRESS),
      { ...firstFour2025, away_team: { ...firstFour2025.away_team, score: null } },
      { ...firstFour2025, home_team: { ...firstFour2025.home_team, score: undefined } },
      { ...firstFour2025, away_team: { ...firstFour2025.away_team, score: 68 } },
      { ...firstFour2025, away_team: null },
    ];
    for (const firstFour of notWon) {
      expect(toNcaaGameScoreUpdates(NCAA_MEN, [firstFour, texasInRoundOf64])[0]).not.toHaveProperty('playInWinnerTeamExternalId');
    }
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
  it('is an event of its own, six rounds long, carrying the women\'s tour and complete once its round 6 championship is final', () => {
    expect(toNcaaTournamentEvent(WOMENS_2025, womens2025, 64)).toEqual({
      externalId: 'ncaaw-2025-tournament',
      providerId: 'balldontlie',
      sport: Sport.BASKETBALL,
      name: 'NCAA Women\'s Tournament',
      startDate: new Date('2026-03-18T23:00:00.000Z'),
      endDate: new Date('2026-04-05T19:00:00.000Z'),
      status: 'COMPLETED',
      rounds: 6,
      participantCount: 64,
      fieldLocked: true,
      metadata: { tour: 'NCAAW', season: 2025 },
    });
  });

  it('is not over while only the men\'s championship round, 7, would say so', () => {
    const [firstFour, uconn] = womens2025;
    expect(toNcaaTournamentEvent(WOMENS_2025, [firstFour, { ...uconn, round: 7 }]).status).toBe('IN_PROGRESS');
  });

  it('lists a women\'s team under the women\'s prefix with the women\'s tour, apart from the men\'s team of the same school', () => {
    const [, duke] = ncaaTeamListSchema.parse(readBalldontlieFixture('ncaaw', 'teams.json')).data;
    expect(toNcaaTeamParticipant(NCAA_WOMEN, duke)).toMatchObject({ externalId: 'ncaaw-team-150', name: 'Duke Blue Devils', metadata: { tour: 'NCAAW', abbreviation: 'DUKE' } });
  });

  it('leaves out both round 0 First Four teams from the field, keeping every round 1 team with its seed', () => {
    expect(toNcaaFieldParticipants(NCAA_WOMEN, womens2025).map((team) => [team.externalId, team.metadata])).toEqual([
      ['ncaaw-team-41', { tour: 'NCAAW', seed: 1 }],
      ['ncaaw-team-2636', { tour: 'NCAAW', seed: 16 }],
      ['ncaaw-team-150', { tour: 'NCAAW', seed: 3 }],
      ['ncaaw-team-2655', { tour: 'NCAAW', seed: 14 }],
      ['ncaaw-team-2579', { tour: 'NCAAW', seed: 1 }],
    ]);
  });

  it('gives game scores from round 1 on, leaving out the round 0 First Four', () => {
    expect(toNcaaGameScoreUpdates(NCAA_WOMEN, womens2025).map((game) => [game.externalGameId, game.homeTeamExternalId, game.awayTeamExternalId, game.homeScore, game.awayScore])).toEqual([
      ['401856710', 'ncaaw-team-41', 'ncaaw-team-2636', 88, 50],
      ['401856711', 'ncaaw-team-150', 'ncaaw-team-2655', 74, 61],
      ['401856772', 'ncaaw-team-41', 'ncaaw-team-2579', 72, 66],
    ]);
  });

  it('names a round 0 First Four winner in its round 1 game', () => {
    const [firstFour, uconn] = womens2025;
    const winnerInRoundOf64: NcaaBracketGame = { ...uconn, away_team: firstFour.home_team };
    expect(toNcaaGameScoreUpdates(NCAA_WOMEN, [firstFour, winnerInRoundOf64])[0]).toMatchObject({ playInWinnerTeamExternalId: 'ncaaw-team-2390' });
  });
});
