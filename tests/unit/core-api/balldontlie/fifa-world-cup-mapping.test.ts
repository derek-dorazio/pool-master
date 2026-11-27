import { MatchSide, ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import { fifaMatchListSchema, fifaTeamListSchema, type FifaMatch } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/fifa-world-cup-contract';
import {
  knockoutMatchesOf,
  parseWorldCupScope,
  bracketMatchesOf,
  toWorldCupBracket,
  toWorldCupEvent,
  toWorldCupEvents,
  toWorldCupFieldParticipants,
  toWorldCupGameScoreUpdates,
  toWorldCupScheduledGames,
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
    expect(toWorldCupEvent(WC_2022, knockout2022)).toEqual({
      externalId: 'fifa-wc-2022-knockout',
      providerId: 'balldontlie',
      sport: Sport.SOCCER,
      name: 'FIFA World Cup',
      startDate: new Date('2022-12-03T15:00:00.000Z'),
      endDate: new Date('2022-12-18T15:00:00.000Z'),
      status: 'COMPLETED',
      fieldLocked: true,
      providerSlots: [
        { code: 'POST:2', startsAt: new Date('2022-12-03T15:00:00.000Z'), endsAt: new Date('2022-12-05T15:00:00.000Z') },
        { code: 'POST:5', startsAt: new Date('2022-12-17T15:00:00.000Z'), endsAt: new Date('2022-12-17T15:00:00.000Z') },
        { code: 'POST:6', startsAt: new Date('2022-12-18T15:00:00.000Z'), endsAt: new Date('2022-12-18T15:00:00.000Z') },
      ],
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
  it('lists a nation under its raw feed id and name, carrying the league\'s keyword', () => {
    const [argentina] = fifaTeamListSchema.parse(readBalldontlieFixture('fifa', 'teams.json')).data;
    expect(toWorldCupTeamParticipant(argentina, '/fifa/worldcup/v1/teams')).toEqual({
      externalId: '9',
      providerId: 'balldontlie',
      sport: Sport.SOCCER,
      name: 'Argentina',
      status: 'ACTIVE',
      abbreviation: 'ARG',
      metadata: {},
    });
    expect(toWorldCupTeamParticipant({ id: 99, name: 'Wales', abbreviation: null }, '/fifa/worldcup/v1/teams').abbreviation).toBeUndefined();
  });

  it('refuses a team with no id or no name', () => {
    expect(() => toWorldCupTeamParticipant({ name: 'Argentina' }, '/fifa/worldcup/v1/teams')).toThrow('a team has no id');
    expect(() => toWorldCupTeamParticipant({ id: 9 }, '/fifa/worldcup/v1/teams')).toThrow('team 9 has no name');
  });

  it('gives the bracket\'s teams decided so far, once each, naming no team for a side still to be decided', () => {
    expect(toWorldCupFieldParticipants([spainMorocco, quarterFinal]).map((team) => [team.externalId, team.name])).toEqual([
      ['33', 'Spain'],
      ['23', 'Morocco'],
    ]);
  });
});

describe('World Cup match scores', () => {
  it('gives each knockout match with both teams, a shoot-out\'s scores beside a level score, leaving out an unknown state and an undecided side', () => {
    expect(toWorldCupGameScoreUpdates(knockout2026)).toEqual([
      { providerGameId: '2689', homeTeamExternalId: '33', awayTeamExternalId: '23', state: ProviderGameState.FINAL, homeScore: 0, awayScore: 0, homeShootoutScore: 0, awayShootoutScore: 3 },
      { providerGameId: '2690', homeTeamExternalId: '9', awayTeamExternalId: '25', state: ProviderGameState.IN_PROGRESS, homeScore: 1, awayScore: 1, homeShootoutScore: null, awayShootoutScore: null },
      { providerGameId: '2691', homeTeamExternalId: '14', awayTeamExternalId: '20', state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null },
    ]);
  });

  it('gives the 2022 final, level after extra time, with Argentina\'s shoot-out win, and a match won outright with no shoot-out', () => {
    expect(toWorldCupGameScoreUpdates([final2022, netherlandsUsa])).toEqual([
      expect.objectContaining({ providerGameId: '2264', homeScore: 3, awayScore: 3, homeShootoutScore: 4, awayShootoutScore: 2 }),
      expect.objectContaining({ providerGameId: '2249', homeScore: 3, awayScore: 1, homeShootoutScore: null, awayShootoutScore: null }),
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

/**
 * The 2026 knockout listing as the vendor gives it once the round of 32 is set: every knockout
 * match from 73 to 104, the round of 32's teams decided, later sides by their source match
 * ("Winner of Match 74"), but match 89's home side already decided, its source gone.
 */
const fullKnockout2026 = knockoutMatchesOf(matchesIn('matches-2026-knockout.json'));
const byVendorNumber = (number: number): FifaMatch => {
  const match = fullKnockout2026.find((each) => each.match_number === number);
  if (!match) throw new Error(`fixture has no match ${String(number)}`);
  return match;
};
const replaced = (number: number, change: Partial<FifaMatch>): FifaMatch[] =>
  fullKnockout2026.map((match) => (match.match_number === number ? { ...match, ...change } : match));

describe('a World Cup bracket and its games from the feed (#1728)', () => {
  it('leaves the play-off for third place out of the bracket, by its stage name or a side from a semifinal\'s loser', () => {
    expect(bracketMatchesOf(fullKnockout2026).map((match) => match.match_number)).not.toContain(103);
    expect(bracketMatchesOf(fullKnockout2026)).toHaveLength(31);
    const unnamed = { ...byVendorNumber(103), stage: { name: 'Match for 3rd', order: 6 } };
    expect(bracketMatchesOf([unnamed])).toEqual([]);
  });

  it('counts the 2026 knockout as five rounds, the round of 32 to the final, and gives no rounds for a partial listing', () => {
    expect(toWorldCupEvent(WC_2026, fullKnockout2026).rounds).toBe(5);
    expect(toWorldCupEvent(WC_2022, knockout2022).rounds).toBeUndefined();
    expect(toWorldCupEvent(WC_2026, knockout2026).rounds).toBeUndefined();
  });

  it('numbers the round of 32 in bracket order read back from the final, each pair\'s winners meeting in the next round', () => {
    const bracket = toWorldCupBracket(fullKnockout2026);
    expect(bracket).toHaveLength(31);
    // From the final (104) back: 101 then 102; 97, 98, 99, 100; then the round of 16 and 32 they come from.
    const vendorOrder = [74, 77, 73, 75, 83, 84, 81, 82, 76, 78, 79, 80, 86, 88, 85, 87];
    const homeIds = vendorOrder.map((number) => String(byVendorNumber(number).home_team?.id));
    expect(bracket?.slice(0, 16).map((match) => match.homeTeamExternalId)).toEqual(homeIds);
    expect(bracket?.[0]).toEqual({
      matchNumber: 1,
      roundNumber: 1,
      homeTeamExternalId: '23',
      awayTeamExternalId: '33',
      scheduledAt: new Date(byVendorNumber(74).datetime ?? ''),
      advancesTo: { roundNumber: 2, matchNumber: 1, side: MatchSide.HOME },
      regionLabel: null,
    });
    expect(bracket?.[1].advancesTo).toEqual({ roundNumber: 2, matchNumber: 1, side: MatchSide.AWAY });
    expect(bracket?.map((match) => match.roundNumber)).toEqual([...Array<number>(16).fill(1), ...Array<number>(8).fill(2), 3, 3, 3, 3, 4, 4, 5]);
    expect(bracket?.[16]).toMatchObject({ roundNumber: 2, matchNumber: 1, homeTeamExternalId: null, awayTeamExternalId: null, advancesTo: { roundNumber: 3, matchNumber: 1, side: MatchSide.HOME } });
    expect(bracket?.[28]).toMatchObject({ roundNumber: 4, matchNumber: 1, scheduledAt: new Date(byVendorNumber(101).datetime ?? ''), advancesTo: { roundNumber: 5, matchNumber: 1, side: MatchSide.HOME } });
    expect(bracket?.[30]).toMatchObject({ matchNumber: 1, roundNumber: 5, advancesTo: null, scheduledAt: new Date(byVendorNumber(104).datetime ?? '') });
  });

  it('links a decided side to the match its team won the round before, the same as its source would', () => {
    const decided = toWorldCupBracket(fullKnockout2026);
    const bySource = toWorldCupBracket(replaced(89, { home_team: null, home_team_source: { type: 'winner', source_match_number: 74 } }));
    expect(bySource).toEqual(decided);
  });

  it('gives no bracket until every round of 32 side is decided', () => {
    expect(toWorldCupBracket(replaced(80, { away_team: null, away_team_source: { type: 'group_2nd' } }))).toBeNull();
  });

  it('gives no bracket for a partial listing, or for a side that links to no match of the round before', () => {
    expect(toWorldCupBracket(knockout2022)).toBeNull();
    expect(toWorldCupBracket(knockout2026)).toBeNull();
    expect(toWorldCupBracket(replaced(97, { away_team_source: { type: 'winner', source_match_number: 74 } }))).toBeNull();
    expect(toWorldCupBracket(replaced(98, { home_team_source: { type: 'winner', source_match_number: 89 } }))).toBeNull();
    expect(toWorldCupBracket(replaced(91, { home_team_source: null }))).toBeNull();
  });

  it('gives each bracket match with both teams decided as a game in its round, and no third-place game', () => {
    const games = toWorldCupScheduledGames(fullKnockout2026);
    expect(games).toHaveLength(16);
    expect(games[0]).toEqual({
      games: [{ providerGameId: '2673', gameNumber: 1 }],
      roundNumber: 1,
      homeTeamExternalId: String(byVendorNumber(73).home_team?.id),
      awayTeamExternalId: String(byVendorNumber(73).away_team?.id),
      scheduledAt: new Date(byVendorNumber(73).datetime ?? ''),
    });
    const settled = replaced(89, { away_team: { id: 7, name: 'Germany' }, away_team_source: null });
    expect(toWorldCupScheduledGames(settled).find((game) => game.games[0]?.providerGameId === '2689')).toMatchObject({ roundNumber: 2, homeTeamExternalId: '23', awayTeamExternalId: '7' });
  });

  it('gives no games while the rounds cannot be told from a partial listing', () => {
    expect(toWorldCupScheduledGames(knockout2026)).toEqual([]);
  });
});
