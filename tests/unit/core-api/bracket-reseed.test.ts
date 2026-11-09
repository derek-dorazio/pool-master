import { expect } from '@jest/globals';
import { MatchEnding, MatchSide, MatchStatus, type SportEventMatch } from '@poolmaster/shared/domain';
import {
  findReseededPlaceGaps,
  findRoundMatchupProblems,
  proposeRoundMatchups,
  reseededRounds,
  roundPlacementBlocker,
  type RoundMatchup,
} from '../../../packages/core-api/src/modules/events/bracket-reseed';
import { findBracketProblems, type BracketMatchInput } from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';

// The pure rules of a reseeded bracket (#722), on an NFL-shaped playoff: seven seeds in each
// conference, the 1 seed on a bye, Wild Card games that link nowhere, a Divisional round placed by
// seed, and conference championships and a Super Bowl fed by links.

/** Field row ids are the team's conference and seed: "AFC-1" is the AFC's 1 seed. */
const seedOf = new Map(['AFC', 'NFC'].flatMap((conference) => [1, 2, 3, 4, 5, 6, 7].map((seed) => [`${conference}-${seed}`, seed] as const)));

interface MatchSpec {
  matchNumber: number;
  round: number;
  home: string | null;
  away: string | null;
  region: string | null;
  advancesTo?: { matchNumber: number; side: MatchSide };
}

function nflPlayoff(): SportEventMatch[] {
  const specs: MatchSpec[] = [
    { matchNumber: 1, round: 1, home: 'AFC-2', away: 'AFC-7', region: 'AFC' },
    { matchNumber: 2, round: 1, home: 'AFC-3', away: 'AFC-6', region: 'AFC' },
    { matchNumber: 3, round: 1, home: 'AFC-4', away: 'AFC-5', region: 'AFC' },
    { matchNumber: 4, round: 1, home: 'NFC-2', away: 'NFC-7', region: 'NFC' },
    { matchNumber: 5, round: 1, home: 'NFC-3', away: 'NFC-6', region: 'NFC' },
    { matchNumber: 6, round: 1, home: 'NFC-4', away: 'NFC-5', region: 'NFC' },
    { matchNumber: 7, round: 2, home: 'AFC-1', away: null, region: 'AFC', advancesTo: { matchNumber: 11, side: MatchSide.HOME } },
    { matchNumber: 8, round: 2, home: null, away: null, region: 'AFC', advancesTo: { matchNumber: 11, side: MatchSide.AWAY } },
    { matchNumber: 9, round: 2, home: 'NFC-1', away: null, region: 'NFC', advancesTo: { matchNumber: 12, side: MatchSide.HOME } },
    { matchNumber: 10, round: 2, home: null, away: null, region: 'NFC', advancesTo: { matchNumber: 12, side: MatchSide.AWAY } },
    { matchNumber: 11, round: 3, home: null, away: null, region: 'AFC', advancesTo: { matchNumber: 13, side: MatchSide.HOME } },
    { matchNumber: 12, round: 3, home: null, away: null, region: 'NFC', advancesTo: { matchNumber: 13, side: MatchSide.AWAY } },
    { matchNumber: 13, round: 4, home: null, away: null, region: null },
  ];
  return specs.map((spec) => ({
    id: `m${spec.matchNumber}`,
    sportEventId: 'super-bowl-lxi',
    roundNumber: spec.round,
    matchNumber: spec.matchNumber,
    homeSportEventParticipantId: spec.home,
    awaySportEventParticipantId: spec.away,
    isNeutralSite: spec.round === 4,
    scheduledDate: null,
    status: MatchStatus.SCHEDULED,
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    homeShootoutScore: null,
    awayShootoutScore: null, ending: MatchEnding.PLAYED,
    advancesToMatchId: spec.advancesTo ? `m${spec.advancesTo.matchNumber}` : null,
    advancesToSide: spec.advancesTo?.side ?? null,
    regionLabel: spec.region,
    homeSpread: null,
    periodScores: [],
    createdAt: new Date('2027-01-01T00:00:00.000Z'),
    updatedAt: new Date('2027-01-01T00:00:00.000Z'),
  }));
}

/** The bracket after Wild Card weekend, each match won by the side named. */
function afterWildCard(winners: ReadonlyMap<number, MatchSide>): SportEventMatch[] {
  return nflPlayoff().map((match) => {
    const winnerSide = winners.get(match.matchNumber);
    return winnerSide === undefined ? match : { ...match, status: MatchStatus.COMPLETED, winnerSide };
  });
}

// AFC: the 7 upsets the 2, the 3 and the 5 win; NFC: every home team wins.
const UPSET_WEEKEND = new Map([[1, MatchSide.AWAY], [2, MatchSide.HOME], [3, MatchSide.AWAY], [4, MatchSide.HOME], [5, MatchSide.HOME], [6, MatchSide.HOME]]);

const pair = (matchNumber: number, home: string, away: string): RoundMatchup => ({ matchNumber, homeSportEventParticipantId: home, awaySportEventParticipantId: away });

describe('reseededRounds', () => {
  it('names only the round after the matches that link nowhere: the Divisional round, not the final', () => {
    expect([...reseededRounds(nflPlayoff())]).toEqual([2]);
  });

  it('names no round in a bracket where every match but the final links on', () => {
    expect(reseededRounds(nflPlayoff().filter((match) => match.roundNumber > 1)).size).toBe(0);
  });
});

describe('roundPlacementBlocker', () => {
  it('blocks placing the Divisional round while a Wild Card game has no result', () => {
    const fiveResults = new Map([...UPSET_WEEKEND].filter(([matchNumber]) => matchNumber !== 6));
    expect(roundPlacementBlocker(afterWildCard(fiveResults), 2)).toEqual({
      code: 'BRACKET_ROUND_NOT_FINISHED',
      reason: 'match 6 of round 1 has no result yet',
    });
  });

  it('blocks placing a round once one of its games has started, and allows it in between', () => {
    const bracket = afterWildCard(UPSET_WEEKEND);
    expect(roundPlacementBlocker(bracket, 2)).toBeNull();

    const started = bracket.map((match) => (match.matchNumber === 9 ? { ...match, status: MatchStatus.IN_PROGRESS } : match));
    expect(roundPlacementBlocker(started, 2)).toMatchObject({ code: 'BRACKET_ROUND_ALREADY_PLAYED' });
  });

  it('blocks placing a round once one of its games has a quarter score, though its status is still scheduled', () => {
    const scored = afterWildCard(UPSET_WEEKEND).map((match) => (match.matchNumber === 9
      ? { ...match, periodScores: [{ periodNumber: 1, homeScore: 7, awayScore: 0 }] }
      : match));

    expect(roundPlacementBlocker(scored, 2)).toMatchObject({ code: 'BRACKET_ROUND_ALREADY_PLAYED' });
  });
});

describe('proposeRoundMatchups', () => {
  it('pairs each conference\'s best seed left with its worst and keeps the 1 seed on its bye\'s home side', () => {
    const { matchups, problems } = proposeRoundMatchups(afterWildCard(UPSET_WEEKEND), 2, seedOf);

    expect(problems).toEqual([]);
    expect(matchups).toEqual([
      pair(7, 'AFC-1', 'AFC-7'),
      pair(8, 'AFC-3', 'AFC-5'),
      pair(9, 'NFC-1', 'NFC-4'),
      pair(10, 'NFC-2', 'NFC-3'),
    ]);
  });

  it('gives the bye team the away side when that is the side it holds', () => {
    const bracket = afterWildCard(UPSET_WEEKEND).map((match) => (match.matchNumber === 7
      ? { ...match, homeSportEventParticipantId: null, awaySportEventParticipantId: 'AFC-1' }
      : match));

    expect(proposeRoundMatchups(bracket, 2, seedOf).matchups[0]).toEqual(pair(7, 'AFC-7', 'AFC-1'));
  });

  it('proposes nothing and names the region when its teams do not fill its matches', () => {
    const bracket = afterWildCard(UPSET_WEEKEND).filter((match) => match.matchNumber !== 3);

    expect(proposeRoundMatchups(bracket, 2, seedOf)).toEqual({
      matchups: [],
      problems: ['round 2 in AFC has 4 places for 3 teams'],
    });
  });
});

describe('an NFL bracket whose conference championships are reseeded too', () => {
  // The Divisional games link nowhere, so the best seed left hosts each conference championship.
  const unlinkedDivisional = (): SportEventMatch[] => nflPlayoff().map((match) => (match.roundNumber === 2
    ? { ...match, advancesToMatchId: null, advancesToSide: null }
    : match));

  it('names both the Divisional round and the conference championships as reseeded', () => {
    expect([...reseededRounds(unlinkedDivisional())].sort((left, right) => left - right)).toEqual([2, 3]);
  });

  it('gives the 2 seed the home side over the 4 seed once the 4 seed knocks out the 1 seed', () => {
    // Every home team wins on Wild Card weekend. Divisional: the AFC 4 seed beats the 1 and the 2
    // beats the 3; in the NFC the 1 and 2 seeds win.
    const bracket = unlinkedDivisional().map((match) => {
      const placed: Partial<Record<number, [string, string, MatchSide]>> = {
        7: ['AFC-1', 'AFC-4', MatchSide.AWAY],
        8: ['AFC-2', 'AFC-3', MatchSide.HOME],
        9: ['NFC-1', 'NFC-7', MatchSide.HOME],
        10: ['NFC-2', 'NFC-3', MatchSide.HOME],
      };
      const row = placed[match.matchNumber];
      if (row) return { ...match, homeSportEventParticipantId: row[0], awaySportEventParticipantId: row[1], status: MatchStatus.COMPLETED, winnerSide: row[2] };
      return match.roundNumber === 1 ? { ...match, status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME } : match;
    });

    expect(proposeRoundMatchups(bracket, 3, seedOf)).toEqual({
      matchups: [pair(11, 'AFC-2', 'AFC-4'), pair(12, 'NFC-1', 'NFC-2')],
      problems: [],
    });
  });
});

describe('findRoundMatchupProblems', () => {
  const bracket = afterWildCard(UPSET_WEEKEND);
  const proposal = proposeRoundMatchups(bracket, 2, seedOf).matchups;

  it('accepts the proposed pairing, and any other that keeps the bye and each team in its conference', () => {
    expect(findRoundMatchupProblems(bracket, 2, proposal, seedOf)).toEqual([]);
    const swapped = [pair(7, 'AFC-1', 'AFC-5'), pair(8, 'AFC-7', 'AFC-3'), proposal[2], proposal[3]];
    expect(findRoundMatchupProblems(bracket, 2, swapped, seedOf)).toEqual([]);
  });

  it.each([
    ['a match left out', proposal.slice(0, 3), ['match 10 of round 2 is not set']],
    ['a match set twice', [...proposal, proposal[3]], ['match 10 is set more than once']],
    ['a match of another round', [...proposal, pair(11, 'AFC-1', 'AFC-3')], ['match 11 is not in round 2']],
    ['a team that lost on Wild Card weekend', [proposal[0], pair(8, 'AFC-3', 'AFC-6'), proposal[2], proposal[3]], [
      'match 8 away names a team that is not left in round 2',
      '1 team left in round 2 is not placed',
    ]],
    ['a team placed twice', [proposal[0], pair(8, 'AFC-3', 'AFC-7'), proposal[2], proposal[3]], [
      'match 8 away names a team already placed',
      '1 team left in round 2 is not placed',
    ]],
    ['a team moved to the other conference', [proposal[0], pair(8, 'AFC-3', 'NFC-3'), proposal[2], pair(10, 'NFC-2', 'AFC-5')], [
      'match 8 away names a team from NFC, but the match is in AFC',
      'match 10 away names a team from AFC, but the match is in NFC',
    ]],
    ['the bye team moved off its match', [pair(7, 'AFC-3', 'AFC-7'), pair(8, 'AFC-1', 'AFC-5'), proposal[2], proposal[3]], [
      'match 8 home moves a team that holds match 7 home',
    ]],
  ])('reports %s', (_case, matchups, expected) => {
    expect(findRoundMatchupProblems(bracket, 2, matchups, seedOf)).toEqual(expected);
  });
});

describe('findBracketProblems on a league that reseeds', () => {
  const asInput = (match: SportEventMatch): BracketMatchInput => ({
    matchNumber: match.matchNumber,
    roundNumber: match.roundNumber,
    homeSportEventParticipantId: match.homeSportEventParticipantId,
    awaySportEventParticipantId: match.awaySportEventParticipantId,
    isNeutralSite: match.isNeutralSite,
    scheduledDate: null,
    advancesTo: match.advancesToMatchId === null ? null : { matchNumber: Number(match.advancesToMatchId.slice(1)), side: match.advancesToSide ?? MatchSide.HOME },
    regionLabel: match.regionLabel,
  });
  const matches = nflPlayoff().map(asInput);
  const context = { roundNumbers: new Set([1, 2, 3, 4]), fieldIds: new Set(seedOf.keys()) };

  it('accepts Wild Card games that link nowhere when the league reseeds, and refuses them when it does not', () => {
    expect(findBracketProblems(matches, { ...context, reseeds: true })).toEqual([]);
    expect(findBracketProblems(matches, context)).not.toEqual([]);
  });

  it('still asks a reseeded bracket for one final, the one match in its last round', () => {
    const twoFinals = matches.map((match) => (match.matchNumber === 12 ? { ...match, roundNumber: 4, advancesTo: null } : match));

    expect(findBracketProblems(twoFinals, { ...context, reseeds: true })).toContain('a bracket has one final, the one match in its last round, but this one has 2 in round 4');
  });
});

describe('findReseededPlaceGaps', () => {
  it('finds no gap when each conference\'s open Divisional places match its Wild Card games', () => {
    expect(findReseededPlaceGaps(nflPlayoff())).toEqual([]);
  });

  it('names the conference whose bye team was left out: one place more than the winners to come', () => {
    const noBye = nflPlayoff().map((match) => (match.matchNumber === 7 ? { ...match, homeSportEventParticipantId: null } : match));

    expect(findReseededPlaceGaps(noBye)).toEqual([{ roundNumber: 2, regionLabel: 'AFC', openPlaces: 4, winnersToCome: 3 }]);
  });

  it('checks every reseeded round in order, here the Divisional round and the conference championships', () => {
    const unlinkedDivisional = nflPlayoff().map((match) => (match.roundNumber === 2 ? { ...match, advancesToMatchId: null, advancesToSide: null } : match));

    expect(findReseededPlaceGaps(unlinkedDivisional)).toEqual([]);
    expect(findReseededPlaceGaps(unlinkedDivisional.filter((match) => match.matchNumber !== 12))).toEqual([
      { roundNumber: 3, regionLabel: 'NFC', openPlaces: 0, winnersToCome: 2 },
    ]);
  });

  it('counts a side as open when the match linking into it names no side', () => {
    const sideless = nflPlayoff().map((match) => (match.matchNumber === 1
      ? { ...match, roundNumber: 2, regionLabel: 'NFC', advancesToMatchId: 'm8', advancesToSide: null }
      : match));

    expect(findReseededPlaceGaps(sideless)).toEqual([{ roundNumber: 2, regionLabel: 'AFC', openPlaces: 3, winnersToCome: 2 }]);
  });
});

describe('roundPlacementBlocker — wording', () => {
  it('names every unfinished game, and every started game, in the plural', () => {
    expect(roundPlacementBlocker(nflPlayoff(), 2)).toEqual({
      code: 'BRACKET_ROUND_NOT_FINISHED',
      reason: 'matches 1, 2, 3, 4, 5, 6 of round 1 have no result yet',
    });
    const twoStarted = afterWildCard(UPSET_WEEKEND).map((match) => (match.matchNumber === 9 || match.matchNumber === 10
      ? { ...match, status: MatchStatus.IN_PROGRESS }
      : match));
    expect(roundPlacementBlocker(twoStarted, 2)).toEqual({
      code: 'BRACKET_ROUND_ALREADY_PLAYED',
      reason: 'matches 9, 10 of round 2 have started',
    });
    const oneStarted = afterWildCard(UPSET_WEEKEND).map((match) => (match.matchNumber === 9 ? { ...match, status: MatchStatus.IN_PROGRESS } : match));
    expect(roundPlacementBlocker(oneStarted, 2)?.reason).toBe('match 9 of round 2 has started');
  });
});

describe('proposeRoundMatchups — edge cases', () => {
  it('sorts a team with no seed after every seeded one, so it meets the best seed', () => {
    const noSevenSeed = new Map([...seedOf].filter(([rowId]) => rowId !== 'AFC-7' && rowId !== 'AFC-5'));

    expect(proposeRoundMatchups(afterWildCard(UPSET_WEEKEND), 2, noSevenSeed).matchups.slice(0, 2)).toEqual([
      pair(7, 'AFC-1', 'AFC-5'),
      pair(8, 'AFC-3', 'AFC-7'),
    ]);
  });

  it('re-proposes the same pairing once the winners are already named in the round', () => {
    const bracket = afterWildCard(UPSET_WEEKEND);
    const placed = proposeRoundMatchups(bracket, 2, seedOf).matchups;
    const saved = bracket.map((match) => {
      const matchup = placed.find((candidate) => candidate.matchNumber === match.matchNumber);
      return matchup ? { ...match, homeSportEventParticipantId: matchup.homeSportEventParticipantId, awaySportEventParticipantId: matchup.awaySportEventParticipantId } : match;
    });

    expect(proposeRoundMatchups(saved, 2, seedOf)).toEqual({ matchups: placed, problems: [] });
  });

  it('keeps a Wild Card winner its link already placed in the round', () => {
    // The AFC 3 v 6 game links into match 8 home, where the 3 seed already stands.
    const bracket = afterWildCard(UPSET_WEEKEND).map((match) => (match.matchNumber === 2
      ? { ...match, advancesToMatchId: 'm8', advancesToSide: MatchSide.HOME }
      : match.matchNumber === 8 ? { ...match, homeSportEventParticipantId: 'AFC-3' } : match));

    const { matchups, problems } = proposeRoundMatchups(bracket.filter((match) => match.regionLabel === 'AFC' && match.roundNumber <= 2), 2, seedOf);

    expect(problems).toEqual([]);
    expect(matchups).toEqual([pair(7, 'AFC-1', 'AFC-7'), pair(8, 'AFC-3', 'AFC-5')]);
  });

  it('places a bye team that carries no seed on the side it holds', () => {
    const bracket = afterWildCard(UPSET_WEEKEND).filter((match) => match.matchNumber === 1 || match.matchNumber === 7);
    const noByeSeed = new Map([...seedOf].filter(([rowId]) => rowId !== 'AFC-1'));

    expect(proposeRoundMatchups(bracket, 2, noByeSeed)).toEqual({ matchups: [pair(7, 'AFC-1', 'AFC-7')], problems: [] });
  });

  it('refuses a pairing of two teams that each hold a different match, and a pair left with no open match', () => {
    // AFC: the 1 seed holds match 7 and the 5 seed is placed on match 8, so 1 v 5... the best and
    // worst seeds left hold different matches, and the middle pair has nowhere to go.
    const bracket = afterWildCard(new Map([[1, MatchSide.HOME], [2, MatchSide.HOME], [3, MatchSide.HOME]]))
      .filter((match) => match.regionLabel === 'AFC' && match.roundNumber <= 2)
      .map((match) => (match.matchNumber === 3 ? { ...match, awaySportEventParticipantId: 'AFC-6', homeSportEventParticipantId: 'AFC-4' }
        : match.matchNumber === 2 ? { ...match, homeSportEventParticipantId: 'AFC-3', awaySportEventParticipantId: 'AFC-7' }
          : match.matchNumber === 8 ? { ...match, homeSportEventParticipantId: 'AFC-5' } : match))
      .filter((match) => match.matchNumber !== 1);

    expect(proposeRoundMatchups(bracket, 2, seedOf)).toEqual({
      matchups: [],
      problems: [
        'round 2 in AFC: the teams in matches 7 and 8 would meet, but each already holds its place',
        'round 2 in AFC has no open match left for a pair',
      ],
    });
  });

  it('counts no team for a Wild Card game without a result', () => {
    expect(proposeRoundMatchups(nflPlayoff(), 2, seedOf).problems).toEqual([
      expect.stringContaining('round 2 in AFC has 4 places for 1 team'),
      expect.stringContaining('round 2 in NFC has 4 places for 1 team'),
    ]);
  });

  it('names the round without a region when its matches carry none', () => {
    const unregioned = afterWildCard(UPSET_WEEKEND)
      .filter((match) => match.regionLabel === 'AFC' && match.roundNumber <= 2 && match.matchNumber !== 3)
      .map((match) => ({ ...match, regionLabel: null }));

    expect(proposeRoundMatchups(unregioned, 2, seedOf).problems).toEqual(['round 2 has 4 places for 3 teams']);
  });
});

describe('findRoundMatchupProblems — wording', () => {
  const bracket = afterWildCard(UPSET_WEEKEND);

  it('names every unset match in the plural, and no unplaced teams while a match is unset', () => {
    expect(findRoundMatchupProblems(bracket, 2, [], seedOf)).toEqual(['matches 7, 8, 9, 10 of round 2 are not set']);
  });

  it('counts unplaced teams in the plural, and names a team or match with no region', () => {
    const proposal = proposeRoundMatchups(bracket, 2, seedOf).matchups;
    const unregioned = bracket.map((match) => (match.matchNumber === 10 ? { ...match, regionLabel: null } : match));

    expect(findRoundMatchupProblems(unregioned, 2, [proposal[0], pair(8, 'AFC-3', 'AFC-3'), proposal[2], pair(10, 'NFC-2', 'NFC-2')], seedOf)).toEqual([
      'match 8 away names a team already placed',
      'match 10 home names a team from NFC, but the match is in no region',
      'match 10 away names a team already placed',
      'match 10 away names a team from NFC, but the match is in no region',
      '2 teams left in round 2 are not placed',
    ]);
  });

  it('names a team with no region played into a regional match', () => {
    const unregionedTeam = bracket.map((match) => (match.matchNumber === 6 ? { ...match, regionLabel: null } : match));
    const proposal = proposeRoundMatchups(bracket, 2, seedOf).matchups;

    expect(findRoundMatchupProblems(unregionedTeam, 2, proposal, seedOf)).toEqual(['match 9 away names a team from no region, but the match is in NFC']);
  });
});
