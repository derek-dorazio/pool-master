import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import {
  eplScopeId,
  matchesByMatchweek,
  parseEplScope,
  toEplFieldParticipants,
  toEplGameScoreUpdates,
  toEplMatchweekEvent,
  toEplMatchweekEvents,
  toEplTeamParticipant,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/epl-mapping';
import { soccerMatchListSchema, soccerTeamListSchema, type SoccerMatch } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/soccer-contract';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

const matches2026 = soccerMatchListSchema.parse(readBalldontlieFixture('epl', 'matches-2026.json')).data;
const teams2026 = soccerTeamListSchema.parse(readBalldontlieFixture('epl', 'teams-2026.json')).data;
const matchweek11 = matchesByMatchweek(matches2026).get(11) ?? [];
const matchweek12 = matchesByMatchweek(matches2026).get(12) ?? [];
const [cityFulham, arsenalChelsea, liverpoolEverton, brentfordLeeds, villaSpurs] = matchweek11;
const MATCHWEEK_11 = { season: 2026, matchweek: 11 };

function withState(match: SoccerMatch, status_state: CompetitionStatusState): SoccerMatch {
  return { ...match, status_state };
}

describe('Premier League matchweek scopes', () => {
  it('names a season\'s matchweek and reads the name back', () => {
    expect(eplScopeId(MATCHWEEK_11)).toBe('epl-2026-matchweek-11');
    expect(parseEplScope('epl-2026-matchweek-11')).toEqual(MATCHWEEK_11);
    expect(parseEplScope('epl-2026-matchweek-38')).toEqual({ season: 2026, matchweek: 38 });
  });

  it('reads a golf tournament id, another league\'s scope or a malformed id as no matchweek', () => {
    expect(parseEplScope('41')).toBeNull();
    expect(parseEplScope('nfl-2026-week-11')).toBeNull();
    expect(parseEplScope('epl-2026-matchweek-0')).toBeNull();
    expect(parseEplScope('epl-26-matchweek-11')).toBeNull();
  });
});

describe('a season\'s matches by matchweek', () => {
  it('groups the matches by round number, leaving out one with no round number', () => {
    const byMatchweek = matchesByMatchweek(matches2026);
    expect([...byMatchweek.keys()]).toEqual([11, 12]);
    expect(byMatchweek.get(11)?.map((match) => match.id)).toEqual([900111, 900112, 900113, 900114, 900115]);
    expect([...byMatchweek.values()].flat().map((match) => match.id)).not.toContain(900199);
  });
});

describe('a Premier League matchweek as an event', () => {
  it('is under way while one match is live and others are final or to play, spanning its first to its last kick-off', () => {
    expect(toEplMatchweekEvent(MATCHWEEK_11, matchweek11, 10)).toEqual({
      externalId: 'epl-2026-matchweek-11',
      providerId: 'balldontlie',
      sport: Sport.SOCCER,
      name: 'Premier League Matchweek 11',
      startDate: new Date('2026-11-21T12:30:00.000Z'),
      endDate: new Date('2026-11-23T20:00:00.000Z'),
      status: 'IN_PROGRESS',
      rounds: 1,
      participantCount: 10,
      fieldLocked: true,
      metadata: { tour: 'EPL', season: 2026 },
    });
  });

  it('is complete once every match is final, a draw among them', () => {
    expect(toEplMatchweekEvent(MATCHWEEK_11, [cityFulham, arsenalChelsea]).status).toBe('COMPLETED');
  });

  it('is not over while a postponed match is still to be played', () => {
    expect(toEplMatchweekEvent(MATCHWEEK_11, [cityFulham, villaSpurs]).status).toBe('IN_PROGRESS');
  });

  it('is scheduled, with its field open, before any match kicks off', () => {
    expect(toEplMatchweekEvent({ season: 2026, matchweek: 12 }, matchweek12)).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
  });

  it('refuses a match with no kick-off date', () => {
    const undated: SoccerMatch = { ...brentfordLeeds, date: undefined };
    expect(() => toEplMatchweekEvent(MATCHWEEK_11, [undated])).toThrow(BalldontlieContractError);
    expect(() => toEplMatchweekEvent(MATCHWEEK_11, [undated])).toThrow('match 900114 has no date');
  });

  it('lists each matchweek of a season once, earliest first', () => {
    const reversed = [...matches2026].reverse();
    expect(toEplMatchweekEvents(2026, reversed).map((event) => [event.externalId, event.status])).toEqual([
      ['epl-2026-matchweek-11', 'IN_PROGRESS'],
      ['epl-2026-matchweek-12', 'SCHEDULED'],
    ]);
  });
});

describe('Premier League teams', () => {
  it('lists a team under its prefixed id and name, carrying the league\'s keyword', () => {
    const [arsenal] = teams2026;
    expect(toEplTeamParticipant(arsenal)).toEqual({
      externalId: 'epl-team-1',
      providerId: 'balldontlie',
      sport: Sport.SOCCER,
      name: 'Arsenal',
      active: true,
      metadata: { tour: 'EPL', abbreviation: 'ARS' },
    });
    expect(toEplTeamParticipant({ id: 99, name: 'Newcomers FC', abbreviation: null }).metadata).toEqual({ tour: 'EPL' });
  });

  it('refuses a team with no id or no name', () => {
    expect(() => toEplTeamParticipant({ name: 'Arsenal' })).toThrow('a team has no id');
    expect(() => toEplTeamParticipant({ id: 1 })).toThrow('team 1 has no name');
  });

  it('gives a matchweek\'s teams once each, in the order they first play, named from the season\'s teams', () => {
    expect(toEplFieldParticipants([cityFulham, arsenalChelsea, cityFulham], teams2026).map((team) => [team.externalId, team.name])).toEqual([
      ['epl-team-12', 'Manchester City'],
      ['epl-team-9', 'Fulham'],
      ['epl-team-1', 'Arsenal'],
      ['epl-team-6', 'Chelsea'],
    ]);
  });

  it('refuses a match whose team the season\'s teams do not list, or that names no team', () => {
    expect(() => toEplFieldParticipants([{ ...cityFulham, away_team_id: 404 }], teams2026)).toThrow('the season\'s teams do not list team 404 of match 900111');
    expect(() => toEplFieldParticipants([{ ...cityFulham, home_team_id: null }], teams2026)).toThrow('match 900111 has no home_team_id');
  });
});

describe('Premier League match scores', () => {
  it('gives every match\'s teams, state and score, a draw as level scores, leaving out an unknown state', () => {
    expect(toEplGameScoreUpdates([...matchweek11, ...matchweek12])).toEqual([
      { externalGameId: '900111', homeTeamExternalId: 'epl-team-12', awayTeamExternalId: 'epl-team-9', state: ProviderGameState.FINAL, homeScore: 2, awayScore: 1 },
      { externalGameId: '900112', homeTeamExternalId: 'epl-team-1', awayTeamExternalId: 'epl-team-6', state: ProviderGameState.FINAL, homeScore: 1, awayScore: 1 },
      { externalGameId: '900113', homeTeamExternalId: 'epl-team-11', awayTeamExternalId: 'epl-team-8', state: ProviderGameState.IN_PROGRESS, homeScore: 1, awayScore: 0 },
      { externalGameId: '900114', homeTeamExternalId: 'epl-team-4', awayTeamExternalId: 'epl-team-10', state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null },
      { externalGameId: '900115', homeTeamExternalId: 'epl-team-2', awayTeamExternalId: 'epl-team-17', state: ProviderGameState.POSTPONED, homeScore: null, awayScore: null },
      { externalGameId: '900121', homeTeamExternalId: 'epl-team-1', awayTeamExternalId: 'epl-team-12', state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null },
    ]);
  });

  it('reads no score before kick-off, whatever the vendor sends', () => {
    const early: SoccerMatch = { ...withState(liverpoolEverton, CompetitionStatusState.SCHEDULED) };
    expect(toEplGameScoreUpdates([early])[0]).toMatchObject({ state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null });
  });

  it('passes on a final with no score as one, for the writer to skip', () => {
    expect(toEplGameScoreUpdates([{ ...cityFulham, home_score: null }])[0]).toMatchObject({ state: ProviderGameState.FINAL, homeScore: null, awayScore: 1 });
  });

  it('refuses a match with no id or no team', () => {
    expect(() => toEplGameScoreUpdates([{ ...cityFulham, id: undefined }])).toThrow('a match has no id');
    expect(() => toEplGameScoreUpdates([{ ...cityFulham, away_team_id: null }])).toThrow('match 900111 has no away_team_id');
  });
});
