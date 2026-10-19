/**
 * Bracket picks (#721): the pure rules of a bracket pool — which teams each game offers an entry
 * from its own picks, which picks stand once an earlier one changes, how the picks score against
 * the results, and how entries level on points are ranked by their tiebreaker.
 */
import { expect } from '@jest/globals';
import {
  MatchSide,
  MatchStatus,
  PickOutcome,
  UpsetBonusRule,
  type KnockoutRoundPointsSettings,
} from '@poolmaster/shared/domain';
import {
  contestBracketGames,
  finalTotalPoints,
  findBracketProblem,
  rankPredictionStandings,
  resolveBracketPicks,
  scoreBracketPicks,
} from '../../../packages/core-api/src/modules/scoring-families/head-to-head/bracket-picks';
import { knockoutSeeds } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/score-team';
import {
  EIGHT_SEEDS,
  NFL_SEEDS,
  bracketMatches,
  bracketPick as pick,
  eightTeamBracket,
  nflPlayoff,
  sixTeamByeBracket,
  withResults,
} from '../../support/bracket-fixtures';

const { HOME, AWAY } = MatchSide;
const sidesOf = (resolved: ReturnType<typeof resolveBracketPicks>, matchNumber: number) => resolved.sides.get(`m${matchNumber}`);
const ids = (picks: ReadonlyArray<{ sportEventMatchId: string }>) => picks.map((each) => each.sportEventMatchId);

describe('resolveBracketPicks — a fixed-link bracket', () => {
  it('offers each first-round game its real teams and a later game the teams the entry picked to win the games feeding it', () => {
    const resolved = resolveBracketPicks(eightTeamBracket(), [pick(1, 'T1'), pick(2, 'T5'), pick(5, 'T5')], EIGHT_SEEDS);

    expect(sidesOf(resolved, 1)).toEqual({ home: 'T1', away: 'T8' });
    expect(sidesOf(resolved, 5)).toEqual({ home: 'T1', away: 'T5' });
    expect(sidesOf(resolved, 6)).toEqual({ home: null, away: null });
    expect(sidesOf(resolved, 7)).toEqual({ home: 'T5', away: null });
    expect(ids(resolved.kept)).toEqual(['m1', 'm2', 'm5']);
    expect(resolved.stranded).toEqual([]);
  });

  it('strands a first-round pick naming a team not playing that game', () => {
    const resolved = resolveBracketPicks(eightTeamBracket(), [pick(1, 'T2')], EIGHT_SEEDS);

    expect(resolved.kept).toEqual([]);
    expect(ids(resolved.stranded)).toEqual(['m1']);
  });

  it('strands a later pick whose team the entry did not pick to get there', () => {
    // T4 is picked to lose game 2, so it cannot be picked to win game 5.
    const resolved = resolveBracketPicks(eightTeamBracket(), [pick(1, 'T1'), pick(2, 'T5'), pick(5, 'T4')], EIGHT_SEEDS);

    expect(ids(resolved.kept)).toEqual(['m1', 'm2']);
    expect(ids(resolved.stranded)).toEqual(['m5']);
  });

  it('strands the picks of two later rounds that followed from a changed first-round pick, keeping the others', () => {
    // The entry had T5 through game 2, game 5 and the final; game 2 now goes to T4.
    const picks = [pick(1, 'T1'), pick(2, 'T4'), pick(3, 'T2'), pick(4, 'T3'), pick(5, 'T5'), pick(6, 'T2'), pick(7, 'T5')];
    const resolved = resolveBracketPicks(eightTeamBracket(), picks, EIGHT_SEEDS);

    expect(sidesOf(resolved, 5)).toEqual({ home: 'T1', away: 'T4' });
    expect(sidesOf(resolved, 7)).toEqual({ home: null, away: 'T2' });
    expect(ids(resolved.kept)).toEqual(['m1', 'm2', 'm3', 'm4', 'm6']);
    expect(ids(resolved.stranded)).toEqual(['m5', 'm7']);
  });

  it('keeps the entry\'s own predicted sides once the real later games are filled in by the results', () => {
    // T8 really beat T1, but the entry picked T1, so its game 5 is still T1 against its game-2 pick.
    const played = withResults(eightTeamBracket(), new Map([
      [1, { winner: AWAY }],
      [5, { home: 'T8', away: 'T4', winner: HOME }],
    ]));
    const resolved = resolveBracketPicks(played, [pick(1, 'T1'), pick(2, 'T4'), pick(5, 'T1')], EIGHT_SEEDS);

    expect(sidesOf(resolved, 5)).toEqual({ home: 'T1', away: 'T4' });
    expect(ids(resolved.kept)).toEqual(['m1', 'm2', 'm5']);
  });
});

describe('resolveBracketPicks — a team on a bye', () => {
  it('keeps a team placed straight into round 2 on its side, and fills the other side from the entry\'s round-1 pick', () => {
    const resolved = resolveBracketPicks(sixTeamByeBracket(), [pick(1, 'T5'), pick(3, 'T1'), pick(4, 'T2')], EIGHT_SEEDS);

    expect(sidesOf(resolved, 3)).toEqual({ home: 'T1', away: 'T5' });
    expect(sidesOf(resolved, 4)).toEqual({ home: 'T2', away: null });
    expect(sidesOf(resolved, 5)).toEqual({ home: 'T1', away: 'T2' });
    expect(ids(resolved.kept)).toEqual(['m1', 'm3', 'm4']);
  });

  it('lets an entry pick the bye team before the game feeding its opponent is picked', () => {
    const resolved = resolveBracketPicks(sixTeamByeBracket(), [pick(3, 'T1')], EIGHT_SEEDS);

    expect(ids(resolved.kept)).toEqual(['m3']);
  });
});

describe('resolveBracketPicks — a reseeded round, as the NFL plays its Divisional round', () => {
  // AFC: the 7 upsets the 2, the 3 and the 5 win; NFC: every home team wins.
  const wildCard = [pick(1, 'AFC-7'), pick(2, 'AFC-3'), pick(3, 'AFC-5'), pick(4, 'NFC-2'), pick(5, 'NFC-3'), pick(6, 'NFC-4')];

  it('pairs the entry\'s picked Wild Card winners by seed in each conference, the 1 seed hosting the worst seed left', () => {
    const resolved = resolveBracketPicks(nflPlayoff(), wildCard, NFL_SEEDS);

    expect(sidesOf(resolved, 7)).toEqual({ home: 'AFC-1', away: 'AFC-7' });
    expect(sidesOf(resolved, 8)).toEqual({ home: 'AFC-3', away: 'AFC-5' });
    expect(sidesOf(resolved, 9)).toEqual({ home: 'NFC-1', away: 'NFC-4' });
    expect(sidesOf(resolved, 10)).toEqual({ home: 'NFC-2', away: 'NFC-3' });
  });

  it('leaves the Divisional games open beside the bye team until every Wild Card game is picked', () => {
    const resolved = resolveBracketPicks(nflPlayoff(), wildCard.slice(0, 5), NFL_SEEDS);

    expect(sidesOf(resolved, 7)).toEqual({ home: 'AFC-1', away: null });
    expect(sidesOf(resolved, 8)).toEqual({ home: null, away: null });
  });

  it('re-pairs the round when a Wild Card pick changes, stranding a Divisional pick whose team moved game and the championship pick after it', () => {
    // With AFC-7 through, AFC-5 visits AFC-3 in game 8; with AFC-2 through instead, AFC-5 visits AFC-1 in game 7.
    const before = [...wildCard, pick(7, 'AFC-1'), pick(8, 'AFC-5'), pick(11, 'AFC-5')];
    expect(resolveBracketPicks(nflPlayoff(), before, NFL_SEEDS).stranded).toEqual([]);

    const after = before.map((each) => (each.sportEventMatchId === 'm1' ? pick(1, 'AFC-2') : each));
    const resolved = resolveBracketPicks(nflPlayoff(), after, NFL_SEEDS);

    expect(sidesOf(resolved, 7)).toEqual({ home: 'AFC-1', away: 'AFC-5' });
    expect(sidesOf(resolved, 8)).toEqual({ home: 'AFC-2', away: 'AFC-3' });
    expect(sidesOf(resolved, 11)).toEqual({ home: 'AFC-1', away: null });
    expect(ids(resolved.stranded)).toEqual(['m8', 'm11']);
  });

  it('pairs by the entry\'s picks, not the Divisional games the admin placed from the real results', () => {
    const placed = withResults(nflPlayoff(), new Map([
      [1, { winner: HOME }], [2, { winner: HOME }], [3, { winner: HOME }],
      [4, { winner: HOME }], [5, { winner: HOME }], [6, { winner: HOME }],
    ])).map((match) => (match.matchNumber === 7 ? { ...match, awaySportEventParticipantId: 'AFC-4' }
      : match.matchNumber === 8 ? { ...match, homeSportEventParticipantId: 'AFC-2', awaySportEventParticipantId: 'AFC-3' }
        : match));
    const resolved = resolveBracketPicks(placed, wildCard, NFL_SEEDS);

    expect(sidesOf(resolved, 7)).toEqual({ home: 'AFC-1', away: 'AFC-7' });
    expect(sidesOf(resolved, 8)).toEqual({ home: 'AFC-3', away: 'AFC-5' });
  });
});

describe('findBracketProblem', () => {
  it('finds nothing in a fixed-link bracket, a bracket with byes, or a reseeded NFL playoff', () => {
    expect(findBracketProblem(eightTeamBracket(), EIGHT_SEEDS)).toBeNull();
    expect(findBracketProblem(sixTeamByeBracket(), EIGHT_SEEDS)).toBeNull();
    expect(findBracketProblem(nflPlayoff(), NFL_SEEDS)).toBeNull();
  });

  it('refuses an event with no games', () => {
    expect(findBracketProblem([], EIGHT_SEEDS)).toBe('it has no games');
  });

  it('refuses a last round of two games, which has no single final', () => {
    const noFinal = eightTeamBracket().filter((match) => match.roundNumber < 3);

    expect(findBracketProblem(noFinal, EIGHT_SEEDS)).toBe('its last round has 2 games, not one final');
  });

  it('refuses a first-round game with a team still to be decided', () => {
    const bracket = eightTeamBracket().map((match) => (match.matchNumber === 3 ? { ...match, awaySportEventParticipantId: null } : match));

    expect(findBracketProblem(bracket, EIGHT_SEEDS)).toBe('game 3 of round 1 has a team that no pick can decide');
  });

  it('refuses a later game that no earlier game leads to', () => {
    const bracket = bracketMatches('event-orphan', [
      { matchNumber: 1, round: 1, home: 'T1', away: 'T4', advancesTo: { matchNumber: 3, side: HOME } },
      { matchNumber: 2, round: 1, home: 'T2', away: 'T3', advancesTo: { matchNumber: 3, side: AWAY } },
      { matchNumber: 3, round: 2, home: null, away: null, advancesTo: { matchNumber: 5, side: HOME } },
      { matchNumber: 4, round: 2, home: null, away: null, advancesTo: { matchNumber: 5, side: AWAY } },
      { matchNumber: 5, round: 3, home: null, away: null },
    ]);

    expect(findBracketProblem(bracket, EIGHT_SEEDS)).toBe('game 4 of round 2 has a team that no pick can decide');
  });
});

describe('scoreBracketPicks', () => {
  const ROUND_VALUES = [1, 2, 4];
  const NO_BONUS: KnockoutRoundPointsSettings = { roundValues: ROUND_VALUES, upsetBonus: { rule: UpsetBonusRule.NONE } };
  const SEED_BONUS: KnockoutRoundPointsSettings = { roundValues: ROUND_VALUES, upsetBonus: { rule: UpsetBonusRule.SEED_DIFFERENCE, multiplier: 1 } };
  // Round 1: T1 and T3 win at home; T5 beats T4 and T7 beats T2, both upsets. Round 2 still to play.
  const afterRoundOne = withResults(eightTeamBracket(), new Map([
    [1, { winner: HOME }], [2, { winner: AWAY }], [3, { winner: AWAY }], [4, { winner: HOME }],
  ]));
  const picks = [pick(1, 'T1'), pick(2, 'T5'), pick(3, 'T2'), pick(4, 'T3'), pick(5, 'T1'), pick(6, 'T2'), pick(7, 'T2')];

  it('scores each correct pick its round\'s value, busts every pick on a team that is out, and leaves the rest pending', () => {
    const score = scoreBracketPicks(afterRoundOne, picks, EIGHT_SEEDS, NO_BONUS);

    expect(Object.fromEntries(score.picks)).toEqual({
      m1: { outcome: PickOutcome.CORRECT, points: 1 },
      m2: { outcome: PickOutcome.CORRECT, points: 1 },
      m3: { outcome: PickOutcome.BUSTED, points: 0 },
      m4: { outcome: PickOutcome.CORRECT, points: 1 },
      m5: { outcome: PickOutcome.PENDING, points: null },
      m6: { outcome: PickOutcome.BUSTED, points: 0 },
      m7: { outcome: PickOutcome.BUSTED, points: 0 },
    });
    expect(score.points).toBe(3);
    expect(score.correctPickCount).toBe(3);
    expect(score.decidedPickCount).toBe(6);
  });

  it('adds the round value of every pending pick to the points for the most the entry can still reach', () => {
    const score = scoreBracketPicks(afterRoundOne, picks, EIGHT_SEEDS, NO_BONUS);

    // 3 points so far, and only T1 in game 5 (worth 2) can still come true.
    expect(score.maxPossiblePoints).toBe(5);
  });

  it('adds the seed difference to a correct upset pick under the seed-difference bonus', () => {
    const score = scoreBracketPicks(afterRoundOne, picks, EIGHT_SEEDS, SEED_BONUS);

    // T5 over T4: 1 for the round plus 1 for the seed difference.
    expect(score.picks.get('m2')).toEqual({ outcome: PickOutcome.CORRECT, points: 2 });
    expect(score.points).toBe(4);
    expect(score.maxPossiblePoints).toBe(6);
  });

  it('shrinks the most possible as later rounds are played, until it equals the points', () => {
    const allPending = scoreBracketPicks(eightTeamBracket(), picks, EIGHT_SEEDS, NO_BONUS);
    expect(allPending).toMatchObject({ points: 0, maxPossiblePoints: 1 * 4 + 2 * 2 + 4, decidedPickCount: 0 });

    const finished = withResults(afterRoundOne, new Map([
      [5, { home: 'T1', away: 'T5', winner: HOME }],
      [6, { home: 'T7', away: 'T3', winner: AWAY }],
      [7, { home: 'T1', away: 'T3', winner: HOME, homeScore: 70, awayScore: 64 }],
    ]));
    const score = scoreBracketPicks(finished, picks, EIGHT_SEEDS, NO_BONUS);
    expect(score).toMatchObject({ points: 5, maxPossiblePoints: 5, correctPickCount: 4, decidedPickCount: 7 });
  });

  it('counts a pick correct when its team wins a game of that round in another game than the entry predicted', () => {
    // The entry's Wild Card picks send AFC-5 to game 7; the real reseeding put it in game 8, which it won.
    const realResults = withResults(nflPlayoff(), new Map([
      [1, { winner: AWAY }], [2, { winner: HOME }], [3, { winner: AWAY }],
      [7, { home: 'AFC-1', away: 'AFC-7', winner: HOME }],
      [8, { home: 'AFC-3', away: 'AFC-5', winner: AWAY }],
    ]));
    const score = scoreBracketPicks(realResults, [pick(7, 'AFC-5')], NFL_SEEDS, { roundValues: [1, 2, 4, 8], upsetBonus: { rule: UpsetBonusRule.NONE } });

    expect(score.picks.get('m7')).toEqual({ outcome: PickOutcome.CORRECT, points: 2 });
  });

  it('keeps a pick on a team that won its earlier rounds pending until it loses', () => {
    const played = withResults(afterRoundOne, new Map([[5, { home: 'T1', away: 'T5', winner: AWAY }]]));
    const score = scoreBracketPicks(played, [pick(1, 'T1'), pick(7, 'T5')], EIGHT_SEEDS, NO_BONUS);

    expect(score.picks.get('m1')).toEqual({ outcome: PickOutcome.CORRECT, points: 1 });
    expect(score.picks.get('m7')).toEqual({ outcome: PickOutcome.PENDING, points: null });
  });

  it('counts an unseeded winner as the field\'s worst seed for the upset bonus', () => {
    const seeds = knockoutSeeds([{ id: 'T1', seedNumber: 1 }, { id: 'T8', seedNumber: 8 }, { id: 'X' }]);
    const bracket = bracketMatches('event-unseeded', [{ matchNumber: 1, round: 1, home: 'T1', away: 'X' }]);
    const score = scoreBracketPicks(withResults(bracket, new Map([[1, { winner: AWAY }]])), [pick(1, 'X')], seeds, {
      roundValues: [1], upsetBonus: { rule: UpsetBonusRule.SEED_DIFFERENCE, multiplier: 2 },
    });

    expect(seeds.get('X')).toBe(8);
    expect(score.points).toBe(1 + (8 - 1) * 2);
  });
});

describe('finalTotalPoints', () => {
  it('is null until the final is played, then both teams\' points together', () => {
    expect(finalTotalPoints(eightTeamBracket())).toBeNull();
    const played = withResults(eightTeamBracket(), new Map([[7, { home: 'T1', away: 'T2', winner: HOME, homeScore: 71, awayScore: 65 }]]));
    expect(finalTotalPoints(played)).toBe(136);
  });
});

describe('rankPredictionStandings', () => {
  const standing = (entryId: string, points: number, tiebreakerValue: number | null) => ({ entryId, points, tiebreakerValue });

  it('ranks by points, most first, sharing a place between entries level on points while the final is unplayed', () => {
    expect(rankPredictionStandings([standing('b', 7, 140), standing('a', 10, 100), standing('c', 7, 155)], null)).toEqual([
      { entryId: 'a', position: 1, displayPosition: '1' },
      { entryId: 'b', position: 2, displayPosition: 'T2' },
      { entryId: 'c', position: 2, displayPosition: 'T2' },
    ]);
  });

  it('puts the entry whose tiebreaker is closest to the final\'s total first among entries level on points', () => {
    expect(rankPredictionStandings([standing('b', 7, 140), standing('a', 10, 100), standing('c', 7, 155)], 150)).toEqual([
      { entryId: 'a', position: 1, displayPosition: '1' },
      { entryId: 'c', position: 2, displayPosition: '2' },
      { entryId: 'b', position: 3, displayPosition: '3' },
    ]);
  });

  it('never lets a closer tiebreaker lift an entry above one with more points', () => {
    expect(rankPredictionStandings([standing('close', 6, 150), standing('far', 7, 10)], 150).map((rank) => rank.entryId)).toEqual(['far', 'close']);
  });

  it('ranks an entry with no tiebreaker after the level entries that gave one', () => {
    expect(rankPredictionStandings([standing('none', 7, null), standing('far', 7, 300)], 150)).toEqual([
      { entryId: 'far', position: 1, displayPosition: '1' },
      { entryId: 'none', position: 2, displayPosition: '2' },
    ]);
  });

  it('shares a place between entries whose tiebreakers are equally close, over and under', () => {
    expect(rankPredictionStandings([standing('under', 7, 145), standing('over', 7, 155), standing('last', 2, 150)], 150)).toEqual([
      { entryId: 'under', position: 1, displayPosition: 'T1' },
      { entryId: 'over', position: 1, displayPosition: 'T1' },
      { entryId: 'last', position: 3, displayPosition: '3' },
    ]);
  });
});

describe('a second-chance bracket, started at a later round once the results decide its teams', () => {
  const ROUND_VALUES: KnockoutRoundPointsSettings = { roundValues: [1, 2, 4], upsetBonus: { rule: UpsetBonusRule.SEED_DIFFERENCE, multiplier: 1 } };
  // Round 1 played: T1, T2 and T3 won and T5 upset T4; the results placed round 2 as T1-T5 and T2-T3.
  const afterRoundOne = withResults(eightTeamBracket(), new Map([
    [1, { winner: HOME }], [2, { winner: AWAY }], [3, { winner: HOME }], [4, { winner: HOME }],
  ])).map((match) => (match.matchNumber === 5 ? { ...match, homeSportEventParticipantId: 'T1', awaySportEventParticipantId: 'T5' }
    : match.matchNumber === 6 ? { ...match, homeSportEventParticipantId: 'T2', awaySportEventParticipantId: 'T3' }
      : match));
  const fromRoundTwo = contestBracketGames(afterRoundOne, 2);

  it('picks the games from its starting round on, leaving cancelled games out; a full bracket picks every game played', () => {
    const gameIds = (games: ReadonlyArray<{ id: string }>) => games.map((each) => each.id);
    expect(gameIds(fromRoundTwo)).toEqual(['m5', 'm6', 'm7']);
    expect(gameIds(contestBracketGames(eightTeamBracket(), 1))).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
    const cancelled = eightTeamBracket().map((match) => (match.matchNumber === 6 ? { ...match, status: MatchStatus.CANCELLED } : match));
    expect(gameIds(contestBracketGames(cancelled, 2))).toEqual(['m5', 'm7']);
  });

  it('offers its starting round the real teams the results put there, and the final the entry\'s picks of that round', () => {
    const resolved = resolveBracketPicks(fromRoundTwo, [pick(5, 'T5'), pick(6, 'T2'), pick(7, 'T5')], EIGHT_SEEDS);

    expect(sidesOf(resolved, 5)).toEqual({ home: 'T1', away: 'T5' });
    expect(sidesOf(resolved, 6)).toEqual({ home: 'T2', away: 'T3' });
    expect(sidesOf(resolved, 7)).toEqual({ home: 'T5', away: 'T2' });
    expect(ids(resolved.kept)).toEqual(['m5', 'm6', 'm7']);
  });

  it('strands a starting-round pick on a team already knocked out, and the final pick that followed from it', () => {
    const resolved = resolveBracketPicks(fromRoundTwo, [pick(5, 'T4'), pick(6, 'T2'), pick(7, 'T4')], EIGHT_SEEDS);

    expect(ids(resolved.kept)).toEqual(['m6']);
    expect(ids(resolved.stranded)).toEqual(['m5', 'm7']);
  });

  it('finds nothing wrong once its starting round\'s teams are decided', () => {
    expect(findBracketProblem(fromRoundTwo, EIGHT_SEEDS, 2)).toBeNull();
  });

  it('refuses a starting round whose teams the results have not yet decided', () => {
    expect(findBracketProblem(contestBracketGames(eightTeamBracket(), 2), EIGHT_SEEDS, 2)).toBe('game 5 of round 2 has a team that no pick can decide');
  });

  it('refuses a starting round past the bracket\'s last round, naming the round', () => {
    expect(findBracketProblem(contestBracketGames(afterRoundOne, 4), EIGHT_SEEDS, 4)).toBe('it has no games from round 4 on');
  });

  it('scores each pick at its own round\'s value of the event, with the upset bonus, and ignores the results of the rounds before it', () => {
    const played = withResults(afterRoundOne, new Map([
      [5, { winner: AWAY }],
      [6, { winner: HOME }],
      [7, { home: 'T5', away: 'T2', winner: AWAY, homeScore: 60, awayScore: 72 }],
    ]));
    const score = scoreBracketPicks(contestBracketGames(played, 2), [pick(5, 'T5'), pick(6, 'T2'), pick(7, 'T5')], EIGHT_SEEDS, ROUND_VALUES);

    // T5 over T1 in round 2: 2 plus a seed difference of 4. T2 in round 2: 2. T5 lost the final.
    expect(Object.fromEntries(score.picks)).toEqual({
      m5: { outcome: PickOutcome.CORRECT, points: 2 + 4 },
      m6: { outcome: PickOutcome.CORRECT, points: 2 },
      m7: { outcome: PickOutcome.BUSTED, points: 0 },
    });
    expect(score).toMatchObject({ points: 8, maxPossiblePoints: 8, correctPickCount: 2, decidedPickCount: 3 });
    expect(finalTotalPoints(contestBracketGames(played, 2))).toBe(132);
  });

  describe('on a reseeded NFL-style playoff, starting at the reseeded Divisional round', () => {
    // Wild Card: the AFC home teams win; in the NFC the 7 upsets the 2. The admin reseeds the
    // Divisional round from those results: AFC-1 hosts AFC-4 and AFC-2 hosts AFC-3; NFC-1 hosts
    // NFC-7 and NFC-3 hosts NFC-4.
    const placed = new Map([[7, ['AFC-1', 'AFC-4']], [8, ['AFC-2', 'AFC-3']], [9, ['NFC-1', 'NFC-7']], [10, ['NFC-3', 'NFC-4']]]);
    const afterWildCard = withResults(nflPlayoff(), new Map([
      [1, { winner: HOME }], [2, { winner: HOME }], [3, { winner: HOME }],
      [4, { winner: AWAY }], [5, { winner: HOME }], [6, { winner: HOME }],
    ])).map((match) => {
      const sides = placed.get(match.matchNumber);
      return sides ? { ...match, homeSportEventParticipantId: sides[0], awaySportEventParticipantId: sides[1] } : match;
    });
    const divisionalOn = contestBracketGames(afterWildCard, 2);

    it('refuses the Divisional round before the Wild Card results place its visitors', () => {
      expect(findBracketProblem(contestBracketGames(nflPlayoff(), 2), NFL_SEEDS, 2)).toBe('game 7 of round 2 has a team that no pick can decide');
    });

    it('takes the Divisional games as the admin reseeded them, not re-paired from picks, and fills in the later rounds from the entry\'s picks', () => {
      expect(findBracketProblem(divisionalOn, NFL_SEEDS, 2)).toBeNull();
      const resolved = resolveBracketPicks(divisionalOn, [pick(7, 'AFC-4'), pick(8, 'AFC-2'), pick(9, 'NFC-1'), pick(10, 'NFC-3'), pick(11, 'AFC-4'), pick(13, 'AFC-4')], NFL_SEEDS);

      expect(sidesOf(resolved, 7)).toEqual({ home: 'AFC-1', away: 'AFC-4' });
      expect(sidesOf(resolved, 10)).toEqual({ home: 'NFC-3', away: 'NFC-4' });
      expect(sidesOf(resolved, 11)).toEqual({ home: 'AFC-4', away: 'AFC-2' });
      expect(sidesOf(resolved, 12)).toEqual({ home: 'NFC-1', away: 'NFC-3' });
      expect(sidesOf(resolved, 13)).toEqual({ home: 'AFC-4', away: null });
      expect(ids(resolved.kept)).toEqual(['m7', 'm8', 'm9', 'm10', 'm11', 'm13']);
    });

    it('scores a Divisional upset at the Divisional round\'s value, not the first round\'s', () => {
      const played = withResults(afterWildCard, new Map([[7, { winner: AWAY }], [8, { winner: HOME }]]));
      const score = scoreBracketPicks(contestBracketGames(played, 2), [pick(7, 'AFC-4'), pick(8, 'AFC-3')], NFL_SEEDS, {
        roundValues: [1, 2, 4, 8], upsetBonus: { rule: UpsetBonusRule.NONE },
      });

      expect(score.picks.get('m7')).toEqual({ outcome: PickOutcome.CORRECT, points: 2 });
      expect(score.picks.get('m8')).toEqual({ outcome: PickOutcome.BUSTED, points: 0 });
    });
  });
});
