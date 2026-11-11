import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import { fifaMatchListSchema, fifaTeamListSchema, type FifaMatch } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/fifa-world-cup-contract';
import {
  knockoutMatchesOf,
  parseWorldCupScope,
  toWorldCupEvent,
  toWorldCupEvents,
  toWorldCupFieldParticipants,
  toWorldCupGameScoreUpdates,
  toWorldCupTeamParticipant,
  worldCupScopeId,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/fifa-world-cup-mapping';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

const matchesIn = (file: string): FifaMatch[] => fifaMatchListSchema.parse(readBalldontlieFixture('fifa', file)).data;
const edition2022 = matchesIn('matches-2022.json');
const edition2026 = matchesIn('matches-2026-partial.json');
const knockout2022 = knockoutMatchesOf(edition2022);
const knockout2026 = knockoutMatchesOf(edition2026);
const [netherlandsUsa, japanCroatia, , final2022] = knockout2022;
const [spainMorocco, , franceJapan, , quarterFinal] = knockout2026;
const WC_2022 = { season: 2022 };
const WC_2026 = { season: 2026 };

describe('World Cup bracket scopes', () => {
  it('names an edition\'s knockout bracket and reads the name back', () => {
    expect(worldCupScopeId(WC_2022)).toBe('fifa-wc-2022-knockout');
    expect(parseWorldCupScope('fifa-wc-2026-knockout')).toEqual(WC_2026);
  });

  it('reads a golf tournament id, another league\'s scope or a malformed id as no World Cup bracket', () => {
    expect(parseWorldCupScope('41')).toBeNull();
    expect(parseWorldCupScope('epl-2026-matchweek-11')).toBeNull();
    expect(parseWorldCupScope('fifa-wc-22-knockout')).toBeNull();
  });
});

describe('a World Cup knockout bracket as an event', () => {
  it('leaves the group stage out: only a match with no group is a knockout match', () => {
    expect(knockout2022.map((match) => match.id)).toEqual([2249, 2253, 2263, 2264]);
  });

  it('is complete once every listed knockout match is final, spanning the round of 16 to the final', () => {
    expect(toWorldCupEvent(WC_2022, knockout2022, 8)).toEqual({
      externalId: 'fifa-wc-2022-knockout',
      providerId: 'balldontlie',
      sport: Sport.SOCCER,
      name: 'FIFA World Cup',
      startDate: new Date('2022-12-03T15:00:00.000Z'),
      endDate: new Date('2022-12-18T15:00:00.000Z'),
      status: 'COMPLETED',
      participantCount: 8,
      fieldLocked: true,
      metadata: { tour: 'FIFAWC', season: 2022 },
    });
  });

  it('is under way while a match is live or final and others are to play, and scheduled with its field open before any kick-off', () => {
    expect(toWorldCupEvent(WC_2026, knockout2026).status).toBe('IN_PROGRESS');
    expect(toWorldCupEvent(WC_2026, [franceJapan, quarterFinal])).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
  });

  it('refuses a match with no kick-off time', () => {
    expect(() => toWorldCupEvent(WC_2026, [{ ...franceJapan, datetime: undefined }])).toThrow(BalldontlieContractError);
    expect(() => toWorldCupEvent(WC_2026, [{ ...franceJapan, datetime: undefined }])).toThrow('match 2691 has no datetime');
  });

  it('lists one bracket per edition among the matches, earliest first, and none for an edition with only group matches', () => {
    expect(toWorldCupEvents([...edition2026, ...edition2022]).map((event) => [event.externalId, event.status])).toEqual([
      ['fifa-wc-2022-knockout', 'COMPLETED'],
      ['fifa-wc-2026-knockout', 'IN_PROGRESS'],
    ]);
    expect(toWorldCupEvents(edition2022.filter((match) => match.group))).toEqual([]);
  });

  it('refuses a knockout match that names no edition', () => {
    expect(() => toWorldCupEvents([{ ...netherlandsUsa, season: {} }])).toThrow('match 2249 has no season year');
  });
});

describe('World Cup teams', () => {
  it('lists a nation under its prefixed id and name, carrying the league\'s keyword', () => {
    const [argentina] = fifaTeamListSchema.parse(readBalldontlieFixture('fifa', 'teams.json')).data;
    expect(toWorldCupTeamParticipant(argentina, '/fifa/worldcup/v1/teams')).toEqual({
      externalId: 'fifa-wc-team-9',
      providerId: 'balldontlie',
      sport: Sport.SOCCER,
      name: 'Argentina',
      active: true,
      metadata: { tour: 'FIFAWC', abbreviation: 'ARG' },
    });
    expect(toWorldCupTeamParticipant({ id: 99, name: 'Wales', abbreviation: null }, '/fifa/worldcup/v1/teams').metadata).toEqual({ tour: 'FIFAWC' });
  });

  it('refuses a team with no id or no name', () => {
    expect(() => toWorldCupTeamParticipant({ name: 'Argentina' }, '/fifa/worldcup/v1/teams')).toThrow('a team has no id');
    expect(() => toWorldCupTeamParticipant({ id: 9 }, '/fifa/worldcup/v1/teams')).toThrow('team 9 has no name');
  });

  it('gives the bracket\'s teams decided so far, once each, naming no team for a side still to be decided', () => {
    expect(toWorldCupFieldParticipants([spainMorocco, quarterFinal]).map((team) => [team.externalId, team.name])).toEqual([
      ['fifa-wc-team-33', 'Spain'],
      ['fifa-wc-team-23', 'Morocco'],
    ]);
  });
});

describe('World Cup match scores', () => {
  it('gives each knockout match with both teams, a shoot-out\'s scores beside a level score, leaving out an unknown state and an undecided side', () => {
    expect(toWorldCupGameScoreUpdates(knockout2026)).toEqual([
      { externalGameId: '2689', homeTeamExternalId: 'fifa-wc-team-33', awayTeamExternalId: 'fifa-wc-team-23', state: ProviderGameState.FINAL, homeScore: 0, awayScore: 0, homeShootoutScore: 0, awayShootoutScore: 3 },
      { externalGameId: '2690', homeTeamExternalId: 'fifa-wc-team-9', awayTeamExternalId: 'fifa-wc-team-25', state: ProviderGameState.IN_PROGRESS, homeScore: 1, awayScore: 1, homeShootoutScore: null, awayShootoutScore: null },
      { externalGameId: '2691', homeTeamExternalId: 'fifa-wc-team-14', awayTeamExternalId: 'fifa-wc-team-20', state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null },
    ]);
  });

  it('gives the 2022 final, level after extra time, with Argentina\'s shoot-out win, and a match won outright with no shoot-out', () => {
    expect(toWorldCupGameScoreUpdates([final2022, netherlandsUsa])).toEqual([
      expect.objectContaining({ externalGameId: '2264', homeScore: 3, awayScore: 3, homeShootoutScore: 4, awayShootoutScore: 2 }),
      expect.objectContaining({ externalGameId: '2249', homeScore: 3, awayScore: 1, homeShootoutScore: null, awayShootoutScore: null }),
    ]);
    expect(toWorldCupGameScoreUpdates([japanCroatia])[0]).toMatchObject({ homeShootoutScore: 1, awayShootoutScore: 3 });
  });

  it('reads no score before kick-off, whatever the vendor sends', () => {
    const early: FifaMatch = { ...final2022, status_state: CompetitionStatusState.SCHEDULED };
    expect(toWorldCupGameScoreUpdates([early])[0]).toMatchObject({ homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null });
  });

  it('refuses a match with both teams but no id, or a team with no id', () => {
    expect(() => toWorldCupGameScoreUpdates([{ ...netherlandsUsa, id: undefined }])).toThrow('a match with both teams has no id');
    expect(() => toWorldCupGameScoreUpdates([{ ...netherlandsUsa, away_team: { name: 'United States' } }])).toThrow('match 2249 has no away team id');
  });
});
