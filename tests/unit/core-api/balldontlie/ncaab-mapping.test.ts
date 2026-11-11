import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import { ncaabBracketListSchema, ncaabTeamListSchema, type NcaabBracketGame } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaab-contract';
import {
  NCAAB_LEAGUE_NAME,
  ncaabScopeId,
  parseNcaabScope,
  toNcaabFieldParticipants,
  toNcaabGameScoreUpdates,
  toNcaabSportEvent,
  toNcaabTeamParticipant,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaab-mapping';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

const bracketIn = (file: string): NcaabBracketGame[] => ncaabBracketListSchema.parse(readBalldontlieFixture('ncaab', file)).data;
const bracket2025 = bracketIn('bracket-2025.json');
const [firstFour2025, duke2025, , championship2025] = bracket2025;
const bracket2026 = bracketIn('bracket-2026-partial.json');
const [final2026, live2026, scheduled2026, unknown2026, halfDecided2026, championship2026] = bracket2026;
const SEASON_2025 = { season: 2025 };
const SEASON_2026 = { season: 2026 };

function withState(game: NcaabBracketGame, status_state: CompetitionStatusState): NcaabBracketGame {
  return { ...game, status_state };
}

describe('NCAA men\'s tournament scopes', () => {
  it('names a season\'s tournament, and reads the name back', () => {
    expect(ncaabScopeId(SEASON_2025)).toBe('ncaab-2025-tournament');
    expect(parseNcaabScope('ncaab-2025-tournament')).toEqual(SEASON_2025);
  });

  it('reads a golf tournament id, an NFL scope or a malformed id as no NCAA tournament', () => {
    expect(parseNcaabScope('41')).toBeNull();
    expect(parseNcaabScope('nfl-2025-postseason')).toBeNull();
    expect(parseNcaabScope('ncaab-25-tournament')).toBeNull();
  });
});

describe('an NCAA men\'s tournament as an event', () => {
  it('is complete once its championship is listed and every game is final, spanning the First Four to the championship', () => {
    expect(toNcaabSportEvent(SEASON_2025, bracket2025, 68)).toEqual({
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
      metadata: { tour: NCAAB_LEAGUE_NAME, season: 2025 },
    });
  });

  it('is under way while a game is live or final and others are to play, its undated championship left out of the dates', () => {
    expect(toNcaabSportEvent(SEASON_2026, bracket2026)).toMatchObject({
      status: 'IN_PROGRESS',
      fieldLocked: true,
      startDate: new Date('2027-03-18T16:15:00.000Z'),
      endDate: new Date('2027-03-20T17:00:00.000Z'),
    });
  });

  it('is not over while its championship is not yet listed, however many listed games are final', () => {
    expect(toNcaabSportEvent(SEASON_2025, [firstFour2025, duke2025]).status).toBe('IN_PROGRESS');
  });

  it('is scheduled, with its field open, before any game starts', () => {
    expect(toNcaabSportEvent(SEASON_2026, [scheduled2026, championship2026])).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
  });

  it('refuses a bracket with no dated game, naming the season', () => {
    expect(() => toNcaabSportEvent(SEASON_2026, [championship2026])).toThrow(BalldontlieContractError);
    expect(() => toNcaabSportEvent(SEASON_2026, [championship2026])).toThrow('the 2026 bracket has no game with a date');
  });
});

describe('NCAA men\'s basketball teams', () => {
  it('lists a team under its prefixed id and full name', () => {
    const [duke] = ncaabTeamListSchema.parse(readBalldontlieFixture('ncaab', 'teams.json')).data;
    expect(toNcaabTeamParticipant(duke)).toEqual({
      externalId: 'ncaab-team-150',
      providerId: 'balldontlie',
      sport: Sport.BASKETBALL,
      name: 'Duke Blue Devils',
      active: true,
      metadata: { abbreviation: 'DUKE' },
    });
  });

  it('refuses a team with no id or no full name', () => {
    expect(() => toNcaabTeamParticipant({ full_name: 'Duke Blue Devils' })).toThrow('a team has no id');
    expect(() => toNcaabTeamParticipant({ id: 150 })).toThrow('team 150 has no full_name');
  });

  it('lists the bracket\'s decided teams once each, First Four teams included, each with its seed', () => {
    const field = toNcaabFieldParticipants(bracket2025);
    expect(field.map((team) => [team.externalId, team.name, team.metadata])).toEqual([
      ['ncaab-team-251', 'Texas Longhorns', { seed: 11 }],
      ['ncaab-team-152', 'NC State Wolfpack', { seed: 11 }],
      ['ncaab-team-150', 'Duke Blue Devils', { seed: 1 }],
      ['ncaab-team-2561', 'Siena Saints', { seed: 16 }],
      ['ncaab-team-194', 'Ohio State Buckeyes', { seed: 8 }],
      ['ncaab-team-2628', 'TCU Horned Frogs', { seed: 9 }],
      ['ncaab-team-57', 'Florida Gators', { seed: 1 }],
    ]);
  });

  it('names no team for a side still to be decided, and takes the short name or no seed when that is all the bracket gives', () => {
    const tbdGame: NcaabBracketGame = { ...halfDecided2026, home_team: { id: 9, name: 'Wildcats', full_name: null, seed: null } };
    expect(toNcaabFieldParticipants([tbdGame, championship2026]).map((team) => [team.externalId, team.name, team.metadata])).toEqual([
      ['ncaab-team-9', 'Wildcats', {}],
    ]);
  });

  it('refuses a decided team with no name at all', () => {
    const nameless: NcaabBracketGame = { ...duke2025, home_team: { id: 150, full_name: null } };
    expect(() => toNcaabFieldParticipants([nameless])).toThrow('a team of bracket game 401856490 has no name');
  });
});

describe('NCAA men\'s tournament game scores', () => {
  it('gives each game from the round of 64 on whose teams are decided, leaving out the First Four and an unknown state', () => {
    expect(toNcaabGameScoreUpdates(bracket2026)).toEqual([
      { externalGameId: '401900101', homeTeamExternalId: 'ncaab-team-57', awayTeamExternalId: 'ncaab-team-2390', state: ProviderGameState.FINAL, homeScore: 81, awayScore: 58 },
      { externalGameId: '401900102', homeTeamExternalId: 'ncaab-team-194', awayTeamExternalId: 'ncaab-team-2628', state: ProviderGameState.IN_PROGRESS, homeScore: 44, awayScore: 47 },
      { externalGameId: '401900103', homeTeamExternalId: 'ncaab-team-150', awayTeamExternalId: 'ncaab-team-2561', state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null },
    ]);
    expect(toNcaabGameScoreUpdates([firstFour2025, unknown2026])).toEqual([]);
  });

  it('reads no score before tip-off, whatever the vendor sends', () => {
    const early = withState(live2026, CompetitionStatusState.POSTPONED);
    expect(toNcaabGameScoreUpdates([early])[0]).toMatchObject({ state: ProviderGameState.POSTPONED, homeScore: null, awayScore: null });
  });

  it('passes on a final with no score as one, for the writer to skip', () => {
    const scoreless: NcaabBracketGame = { ...final2026, home_team: { ...final2026.home_team, score: null } };
    expect(toNcaabGameScoreUpdates([scoreless])[0]).toMatchObject({ state: ProviderGameState.FINAL, homeScore: null, awayScore: 58 });
  });

  it('refuses a game with both teams decided but no game id or no round', () => {
    expect(() => toNcaabGameScoreUpdates([{ ...championship2025, game_id: null }])).toThrow('a bracket game with both teams has no game_id');
    expect(() => toNcaabGameScoreUpdates([{ ...championship2025, round: undefined }])).toThrow('bracket game 401856550 has no round');
  });
});
