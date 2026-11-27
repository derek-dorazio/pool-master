import { homeAwayOf, legacyMatch } from '../../support/match-sides';
import { sportPlay } from '../../support/sport-play';
import {
  MatchEnding,
  MatchSide,
  MatchStatus,
  SportEventParticipantStatus,
  ScoringFamily,
  SlotKind,
  Sport,
  SportEventStatus,
  UpsetBonusRule,
  type ContestRoundCoverage,
  type ContestScoringSettings,
  type SportEventRoundMatch,
  type SportEventRoundSlot,
  type UpsetBonus,
} from '@poolmaster/shared/domain';
import { getScoringFamilyModule } from '../../../packages/core-api/src/modules/scoring-families';
import { upsetBonusFor } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/score-team';
import type { FieldScoringEvent } from '../../../packages/core-api/src/modules/scoring-families/scoring-family-module';
import type { SportEventParticipantView } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { bracketRoundSlots, roundSlot, weekRoundSlot } from '../../support/round-slots';

// Knockout round points (#699): what each team scores from the bracket's results under a
// contest's round values and upset bonus, and when a team is left unscored.

const family = getScoringFamilyModule(ScoringFamily.HEAD_TO_HEAD);
const TOURNAMENT: FieldScoringEvent = { sport: Sport.BASKETBALL, ...sportPlay(Sport.BASKETBALL), rounds: 2, roundsPar: undefined, status: SportEventStatus.IN_PROGRESS, slotDefinitions: [] };
/** A contest covering every round of the event: one with no template's slots to narrow it. */
const EVERY_ROUND: ContestRoundCoverage = { slotDefinitionIds: null };
const NO_BONUS: UpsetBonus = { rule: UpsetBonusRule.NONE };
const SEED_DIFFERENCE: UpsetBonus = { rule: UpsetBonusRule.SEED_DIFFERENCE, multiplier: 1 };

function knockout(roundValues: number[], upsetBonus: UpsetBonus = NO_BONUS): ContestScoringSettings {
  return { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues, upsetBonus } };
}

interface TeamInput {
  name: string;
  seed?: number;
  /** Withdrew after the draw (#704), its place taken by a replacement. */
  withdrawn?: boolean;
}

interface MatchInput {
  matchNumber: number;
  round: number;
  home: string | null;
  away: string | null;
  winner?: MatchSide;
  /** The match number and side its winner advances to. */
  advancesTo?: number;
  /** The round's slot, when not the bracket's own round of that number (a group matchday). */
  slot?: SportEventRoundSlot;
}

/** The field of teams, each row carrying the bracket matches it is in, as the field read attaches them. */
function bracketField(teams: TeamInput[], matchInputs: MatchInput[]): SportEventParticipantView[] {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.BASKETBALL);
  const event = store.addEvent({ sport: Sport.BASKETBALL, rounds: 2 });
  const rows = teams.map(({ name, seed, withdrawn = false }) => {
    const participant = store.addParticipant(sport.id, name, { participantType: 'TEAM' });
    const entry = store.addToField(event.id, participant.id, {
      ...(seed === undefined ? {} : { seedNumber: seed }),
      ...(withdrawn ? { status: SportEventParticipantStatus.WITHDRAWN } : {}),
    });
    return { name, entry, participant };
  });
  const idOf = (name: string | null) => (name === null ? null : rows.find((row) => row.name === name)?.entry.id ?? null);
  const matches: SportEventRoundMatch[] = matchInputs.map((input) => (legacyMatch({
    id: `match-${input.matchNumber}`,
    sportEventId: event.id,
    roundNumber: input.round,
    slot: input.slot ?? bracketRoundSlots(Math.max(2, ...matchInputs.map((each) => each.round)))[input.round - 1],
    matchNumber: input.matchNumber,
    homeSportEventParticipantId: idOf(input.home),
    awaySportEventParticipantId: idOf(input.away),
    isNeutralSite: true,
    scheduledDate: null,
    status: input.winner === undefined ? MatchStatus.SCHEDULED : MatchStatus.COMPLETED,
    winnerSide: input.winner ?? null,
    homeScore: null,
    awayScore: null,
    homeShootoutScore: null,
    awayShootoutScore: null, ending: MatchEnding.PLAYED,
    advancesToMatchId: input.advancesTo === undefined ? null : `match-${input.advancesTo}`,
    advancesToSide: input.advancesTo === undefined ? null : MatchSide.HOME,
    regionLabel: null,
    homeSpread: null,
    completedAt: null,
    periodScores: [],
    createdAt: new Date('2027-03-18T16:00:00.000Z'),
    updatedAt: new Date('2027-03-18T16:00:00.000Z'),
  })));
  return rows.map(({ entry, participant }) => ({
    entry,
    participant,
    valuation: null,
    standing: null,
    rounds: [],
    fieldResults: [],
    matches: matches.filter((match) => homeAwayOf(match).homeSportEventParticipantId === entry.id || homeAwayOf(match).awaySportEventParticipantId === entry.id),
    affiliatedWithSportLeague: true,
  }));
}

function scores(field: SportEventParticipantView[], scoring: ContestScoringSettings, coverage: ContestRoundCoverage = EVERY_ROUND): Record<string, number | null> {
  return Object.fromEntries(family.scoreField(field, TOURNAMENT, scoring, coverage).map((row) => [row.name, row.score]));
}

/** A contest covering only the given rounds of the field's bracket: the slot definitions its template would list. */
function coveringRounds(field: SportEventParticipantView[], rounds: number[]): ContestRoundCoverage {
  const matches = field.flatMap((row) => row.matches).filter((match) => rounds.includes(match.roundNumber));
  return { slotDefinitionIds: [...new Set(matches.map((match) => match.slot.slotDefinitionId))] };
}

const SEEDED = [
  { name: 'Duke', seed: 1 },
  { name: 'Vermont', seed: 4 },
  { name: 'Houston', seed: 2 },
  { name: 'Texas', seed: 3 },
];

describe('knockout round points — a slate of one-off games (#2225)', () => {
  it('scores a one-round slate\'s win 1 and its loss 0 at a round value of 1, each game its own final, and leaves a game still to play at 0', () => {
    const field = bracketField([{ name: 'Hoosiers' }, { name: 'Ducks' }, { name: 'Bulldogs' }, { name: 'Buckeyes' }, { name: 'Utes' }, { name: 'Tigers' }], [
      { matchNumber: 1, round: 1, home: 'Ducks', away: 'Hoosiers', winner: MatchSide.AWAY },
      { matchNumber: 2, round: 1, home: 'Buckeyes', away: 'Bulldogs', winner: MatchSide.HOME },
      { matchNumber: 3, round: 1, home: 'Tigers', away: 'Utes' },
    ]);

    expect(scores(field, knockout([1]))).toEqual({ Hoosiers: 1, Ducks: 0, Bulldogs: 0, Buckeyes: 1, Utes: 0, Tigers: 0 });
  });
});

describe('knockout round points — round values', () => {
  it('scores each win its round\'s value, summed over the rounds a team won', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.HOME, advancesTo: 3 },
      { matchNumber: 2, round: 1, home: 'Houston', away: 'Texas', winner: MatchSide.HOME, advancesTo: 3 },
      { matchNumber: 3, round: 2, home: 'Duke', away: 'Houston', winner: MatchSide.HOME },
    ]);

    expect(scores(field, knockout([1, 2]))).toEqual({ Duke: 3, Vermont: 0, Houston: 1, Texas: 0 });
  });

  it('leaves every team unscored until the bracket has a result, since nobody has won or lost yet', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', advancesTo: 3 },
      { matchNumber: 2, round: 1, home: 'Houston', away: 'Texas', advancesTo: 3 },
      { matchNumber: 3, round: 2, home: null, away: null },
    ]);

    expect(scores(field, knockout([1, 2]))).toEqual({ Duke: null, Vermont: null, Houston: null, Texas: null });
  });

  it('scores a team whose match is still to be played 0 once another match has a result', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.AWAY, advancesTo: 3 },
      { matchNumber: 2, round: 1, home: 'Houston', away: 'Texas', advancesTo: 3 },
    ]);

    expect(scores(field, knockout([1, 2]))).toEqual({ Duke: 0, Vermont: 1, Houston: 0, Texas: 0 });
  });

  it('leaves a team that won in a round with no value unscored rather than scoring it 0', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.HOME, advancesTo: 3 },
      { matchNumber: 3, round: 2, home: 'Duke', away: 'Houston', winner: MatchSide.HOME },
    ]);

    // Houston, placed straight into round 2, scores round 1's value for its bye; its loss adds nothing.
    expect(scores(field, knockout([1]))).toMatchObject({ Duke: null, Houston: 1 });
  });

  it('leaves every team unscored under another family\'s scoring definition', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.HOME },
    ]);

    expect(scores(field, { participantScoringDefinitionId: 'FINISH_POSITION_POINTS', config: { pointsTable: [5], didNotFinishPoints: 0 } }))
      .toEqual({ Duke: null, Vermont: null, Houston: null, Texas: null });
  });
});

describe('knockout round points — only the rounds the contest covers count', () => {
  // A play-in is the event's round 1 (#2184): Iowa and Utah play it for a place against Duke in
  // round 2, which a contest covering round 2 on scores as its first round.
  const PLAY_IN_FIELD = [
    { name: 'Duke', seed: 1 },
    { name: 'Houston', seed: 2 },
    { name: 'Texas', seed: 3 },
    { name: 'Iowa', seed: 4 },
    { name: 'Utah', seed: 4 },
  ];
  const PLAY_IN_BRACKET: MatchInput[] = [
    { matchNumber: 1, round: 1, home: 'Iowa', away: 'Utah', winner: MatchSide.HOME, advancesTo: 2 },
    { matchNumber: 2, round: 2, home: 'Duke', away: 'Iowa', winner: MatchSide.HOME, advancesTo: 4 },
    { matchNumber: 3, round: 2, home: 'Houston', away: 'Texas', winner: MatchSide.HOME, advancesTo: 4 },
    { matchNumber: 4, round: 3, home: 'Duke', away: 'Houston', winner: MatchSide.HOME },
  ];

  it('scores a first covered round win at the first round value and a play-in win at nothing, the play-in not counting as a bye', () => {
    const field = bracketField(PLAY_IN_FIELD, PLAY_IN_BRACKET);

    expect(scores(field, knockout([1, 2]), coveringRounds(field, [2, 3]))).toEqual({ Duke: 3, Houston: 1, Texas: 0, Iowa: 0, Utah: 0 });
  });

  it('counts only covered wins in a team\'s record, and still puts a play-in loser out', () => {
    const field = bracketField(PLAY_IN_FIELD, PLAY_IN_BRACKET);
    const records = Object.fromEntries(family.scoreField(field, TOURNAMENT, knockout([1, 2]), coveringRounds(field, [2, 3]))
      .map((row) => [row.name, row.detail]));

    expect(records).toMatchObject({
      Duke: { wins: 2, isAlive: true },
      Iowa: { wins: 0, isAlive: false },
      Utah: { wins: 0, isAlive: false },
    });
  });

  it('leaves every team unscored while only the play-in has a result', () => {
    const field = bracketField(PLAY_IN_FIELD, [
      PLAY_IN_BRACKET[0],
      { matchNumber: 2, round: 2, home: 'Duke', away: 'Iowa', advancesTo: 4 },
      { matchNumber: 3, round: 2, home: 'Houston', away: 'Texas', advancesTo: 4 },
    ]);

    expect(scores(field, knockout([1, 2]), coveringRounds(field, [2]))).toEqual({ Duke: null, Houston: null, Texas: null, Iowa: null, Utah: null });
  });
});

describe('knockout round points — a bye counts as a win', () => {
  // Duke and Houston are placed straight into round 2; the other four play round 1 for their places.
  const BYES = [
    { name: 'Duke', seed: 1 },
    { name: 'Houston', seed: 2 },
    { name: 'Texas', seed: 3 },
    { name: 'Vermont', seed: 4 },
    { name: 'Iowa', seed: 5 },
    { name: 'Utah', seed: 6 },
  ];
  const ROUND_ONE: MatchInput[] = [
    { matchNumber: 1, round: 1, home: 'Texas', away: 'Iowa', winner: MatchSide.HOME, advancesTo: 3 },
    { matchNumber: 2, round: 1, home: 'Vermont', away: 'Utah', winner: MatchSide.AWAY, advancesTo: 4 },
  ];
  const detailsOf = (field: SportEventParticipantView[], scoring: ContestScoringSettings) =>
    Object.fromEntries(family.scoreField(field, TOURNAMENT, scoring, EVERY_ROUND).map((row) => [row.name, row.detail]));

  it('scores a team on a bye the skipped round\'s value once every game of that round is decided, and counts the bye as a win', () => {
    const field = bracketField(BYES, [
      ...ROUND_ONE,
      { matchNumber: 3, round: 2, home: 'Duke', away: 'Texas', advancesTo: 5 },
      { matchNumber: 4, round: 2, home: 'Houston', away: 'Utah', advancesTo: 5 },
    ]);

    expect(scores(field, knockout([1, 2, 4]))).toEqual({ Duke: 1, Houston: 1, Texas: 1, Vermont: 0, Iowa: 0, Utah: 1 });
    expect(detailsOf(field, knockout([1, 2, 4]))).toMatchObject({
      Duke: { wins: 1, upsetBonusPoints: 0, isAlive: true },
      Houston: { wins: 1, upsetBonusPoints: 0, isAlive: true },
    });
  });

  it('scores a team on a bye nothing for the skipped round while any game of that round is still to be played', () => {
    const field = bracketField(BYES, [
      { ...ROUND_ONE[0] },
      { matchNumber: 2, round: 1, home: 'Vermont', away: 'Utah', advancesTo: 4 },
      { matchNumber: 3, round: 2, home: 'Duke', away: 'Texas', advancesTo: 5 },
      { matchNumber: 4, round: 2, home: 'Houston', away: null, advancesTo: 5 },
    ]);

    expect(scores(field, knockout([1, 2, 4]))).toMatchObject({ Duke: 0, Houston: 0, Texas: 1 });
    expect(detailsOf(field, knockout([1, 2, 4]))).toMatchObject({ Duke: { wins: 0 }, Houston: { wins: 0 } });
  });

  it('leaves a team on a bye unscored, like every team, until the bracket has a result', () => {
    const field = bracketField(BYES, [
      { matchNumber: 1, round: 1, home: 'Texas', away: 'Iowa', advancesTo: 3 },
      { matchNumber: 2, round: 1, home: 'Vermont', away: 'Utah', advancesTo: 4 },
      { matchNumber: 3, round: 2, home: 'Duke', away: null, advancesTo: 5 },
      { matchNumber: 4, round: 2, home: 'Houston', away: null, advancesTo: 5 },
    ]);

    expect(scores(field, knockout([1, 2, 4]))).toMatchObject({ Duke: null, Houston: null });
  });

  it('gives a bye no upset bonus, since nobody was beaten, while the bye team\'s later upset wins still earn theirs', () => {
    const field = bracketField(BYES, [
      ...ROUND_ONE,
      { matchNumber: 3, round: 2, home: 'Duke', away: 'Texas', winner: MatchSide.AWAY, advancesTo: 5 },
      { matchNumber: 4, round: 2, home: 'Houston', away: 'Utah', winner: MatchSide.HOME, advancesTo: 5 },
    ]);

    const details = detailsOf(field, knockout([1, 2, 4], SEED_DIFFERENCE));

    expect(scores(field, knockout([1, 2, 4], SEED_DIFFERENCE))).toMatchObject({ Duke: 1, Houston: 1 + 2, Texas: 1 + 2 + 2 });
    expect(details).toMatchObject({
      Duke: { wins: 1, upsetBonusPoints: 0, isAlive: false },
      Houston: { wins: 2, upsetBonusPoints: 0, isAlive: true },
    });
  });

  it('scores a team on a bye that loses its first game 1 under Straight up values, for the bye alone', () => {
    const field = bracketField(BYES, [
      ...ROUND_ONE,
      { matchNumber: 3, round: 2, home: 'Duke', away: 'Texas', winner: MatchSide.HOME, advancesTo: 5 },
      { matchNumber: 4, round: 2, home: 'Houston', away: 'Utah', winner: MatchSide.AWAY, advancesTo: 5 },
    ]);

    expect(scores(field, knockout([1, 1, 1]))).toMatchObject({ Duke: 2, Houston: 1, Utah: 2 });
    expect(detailsOf(field, knockout([1, 1, 1]))).toMatchObject({ Houston: { wins: 1, isAlive: false } });
  });

  it('scores a bye team that wins out every round\'s value, the skipped one included', () => {
    const field = bracketField(BYES, [
      ...ROUND_ONE,
      { matchNumber: 3, round: 2, home: 'Duke', away: 'Texas', winner: MatchSide.HOME, advancesTo: 5 },
      { matchNumber: 4, round: 2, home: 'Houston', away: 'Utah', winner: MatchSide.HOME, advancesTo: 5 },
      { matchNumber: 5, round: 3, home: 'Duke', away: 'Houston', winner: MatchSide.HOME },
    ]);

    expect(scores(field, knockout([1, 2, 4]))).toEqual({ Duke: 1 + 2 + 4, Houston: 1 + 2, Texas: 1, Vermont: 0, Iowa: 0, Utah: 1 });
  });

  it('scores both 1 seeds of an NFL-shaped playoff (14 teams, two byes) round 1\'s value once Wild Card weekend is played', () => {
    const teams = ['AFC', 'NFC'].flatMap((conference) => [1, 2, 3, 4, 5, 6, 7].map((seed) => ({ name: `${conference}-${String(seed)}`, seed })));
    const wildCard = ['AFC', 'NFC'].flatMap((conference, index): MatchInput[] => [
      { matchNumber: index * 3 + 1, round: 1, home: `${conference}-2`, away: `${conference}-7`, winner: MatchSide.HOME },
      { matchNumber: index * 3 + 2, round: 1, home: `${conference}-3`, away: `${conference}-6`, winner: MatchSide.AWAY },
      { matchNumber: index * 3 + 3, round: 1, home: `${conference}-4`, away: `${conference}-5`, winner: MatchSide.HOME },
    ]);
    const field = bracketField(teams, [
      ...wildCard,
      { matchNumber: 7, round: 2, home: 'AFC-1', away: null },
      { matchNumber: 9, round: 2, home: 'NFC-1', away: null },
    ]);

    const scored = scores(field, knockout([1, 2, 4, 8], SEED_DIFFERENCE));

    expect([scored['AFC-1'], scored['NFC-1']]).toEqual([1, 1]);
    expect([scored['AFC-2'], scored['AFC-6'], scored['AFC-4'], scored['AFC-7'], scored['AFC-3']]).toEqual([1, 1 + 3, 1, 0, 0]);
    expect(detailsOf(field, knockout([1, 2, 4, 8], SEED_DIFFERENCE))).toMatchObject({
      'AFC-1': { wins: 1, upsetBonusPoints: 0, isAlive: true },
      'NFC-1': { wins: 1, upsetBonusPoints: 0, isAlive: true },
    });
  });

  it('scores a field with no byes exactly as before: each team only for the games it won', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.AWAY, advancesTo: 3 },
      { matchNumber: 2, round: 1, home: 'Houston', away: 'Texas', winner: MatchSide.HOME, advancesTo: 3 },
      { matchNumber: 3, round: 2, home: 'Vermont', away: 'Houston', winner: MatchSide.AWAY },
    ]);

    expect(scores(field, knockout([1, 2]))).toEqual({ Duke: 0, Vermont: 1, Houston: 1 + 2, Texas: 0 });
  });
});

describe('knockout round points — upset bonus', () => {
  it('adds nothing for an upset with the bonus off', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.AWAY },
    ]);

    expect(scores(field, knockout([1, 2]))).toMatchObject({ Vermont: 1 });
  });

  it('adds the seed difference to a win by the worse seed with the bonus on', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.AWAY },
    ]);

    expect(scores(field, knockout([1, 2], SEED_DIFFERENCE))).toMatchObject({ Duke: 0, Vermont: 1 + 3 });
  });

  it('adds nothing when the better seed wins', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.HOME },
    ]);

    expect(scores(field, knockout([1, 2], SEED_DIFFERENCE))).toMatchObject({ Duke: 1 });
  });

  it('multiplies the seed difference by the multiplier', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.AWAY },
    ]);

    expect(scores(field, knockout([1, 2], { rule: UpsetBonusRule.SEED_DIFFERENCE, multiplier: 5 }))).toMatchObject({ Vermont: 1 + 3 * 5 });
  });

  it('counts an unseeded team as the field\'s worst seed, so its win over the best seed earns the full difference', () => {
    const field = bracketField(
      [{ name: 'Duke', seed: 1 }, { name: 'Houston', seed: 8 }, { name: 'Gonzaga' }],
      [{ matchNumber: 1, round: 1, home: 'Duke', away: 'Gonzaga', winner: MatchSide.AWAY }],
    );

    expect(scores(field, knockout([1, 2], SEED_DIFFERENCE))).toMatchObject({ Gonzaga: 1 + 7 });
  });

  it('gives no bonus for a win between equal seeds', () => {
    expect(upsetBonusFor(SEED_DIFFERENCE, 4, 4)).toBe(0);
  });

  it('shows the bonus part, wins and whether the team is alive as the pick\'s detail', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.AWAY, advancesTo: 3 },
      { matchNumber: 2, round: 1, home: 'Houston', away: 'Texas', winner: MatchSide.HOME, advancesTo: 3 },
      { matchNumber: 3, round: 2, home: 'Vermont', away: 'Houston' },
    ]);

    const details = Object.fromEntries(family.scoreField(field, TOURNAMENT, knockout([1, 2], SEED_DIFFERENCE), EVERY_ROUND).map((row) => [row.name, row.detail]));

    expect(details).toMatchObject({
      Vermont: { scoringFamily: ScoringFamily.HEAD_TO_HEAD, wins: 1, upsetBonusPoints: 3, isAlive: true },
      Duke: { scoringFamily: ScoringFamily.HEAD_TO_HEAD, wins: 0, upsetBonusPoints: 0, isAlive: false },
    });
  });

  it('scores a team withdrawn after the draw and replaced in its place nothing, and shows it out, as a first-round loss', () => {
    const field = bracketField(
      [{ name: 'Duke', seed: 1, withdrawn: true }, { name: 'Lucky Loser' }, { name: 'Vermont', seed: 4 }],
      [{ matchNumber: 1, round: 1, home: 'Lucky Loser', away: 'Vermont', winner: MatchSide.HOME }],
    );

    const rows = Object.fromEntries(family.scoreField(field, TOURNAMENT, knockout([1, 2]), EVERY_ROUND).map((row) => [row.name, row]));

    expect(rows['Duke']).toMatchObject({ score: 0, detail: { wins: 0, isAlive: false } });
    expect(rows['Lucky Loser']).toMatchObject({ score: 1, detail: { wins: 1, isAlive: true } });
  });

  it('keeps a team made inactive as withdrawn in the field grid alive while its game still names it, since nobody took its place', () => {
    const field = bracketField(
      [{ name: 'Duke', seed: 1, withdrawn: true }, { name: 'Vermont', seed: 4 }, { name: 'Houston', seed: 2 }, { name: 'Texas', seed: 3 }],
      [
        { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont' },
        { matchNumber: 2, round: 1, home: 'Houston', away: 'Texas', winner: MatchSide.HOME },
      ],
    );

    const rows = Object.fromEntries(family.scoreField(field, TOURNAMENT, knockout([1, 2]), EVERY_ROUND).map((row) => [row.name, row]));

    expect(rows['Duke']).toMatchObject({ detail: { wins: 0, isAlive: true } });
  });
});

describe('knockout round points — edges', () => {
  it('gives no upset bonus when no team in the field carries a seed', () => {
    const field = bracketField([{ name: 'Duke' }, { name: 'Vermont' }], [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.AWAY },
    ]);

    expect(scores(field, knockout([1], SEED_DIFFERENCE))).toEqual({ Duke: 0, Vermont: 1 });
  });

  it('gives a win over an empty side (a walkover) its round value and no upset bonus', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Vermont', away: null, winner: MatchSide.HOME },
    ]);

    expect(scores(field, knockout([1], SEED_DIFFERENCE))['Vermont']).toBe(1);
  });

  it('throws on an upset bonus rule it does not know rather than scoring it', () => {
    expect(() => upsetBonusFor({ rule: 'DOUBLE_OR_NOTHING' } as unknown as UpsetBonus, 4, 1)).toThrow();
  });

  it('scores a missed lineup 0 under knockout round points and leaves it unscored under another definition', () => {
    const golf: ContestScoringSettings = { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} } as unknown as ContestScoringSettings;

    expect(family.scoreMissedLineup([], TOURNAMENT, knockout([1]), 3)).toBe(0);
    expect(family.scoreMissedLineup([], TOURNAMENT, golf, 3)).toBeNull();
  });
});

// A soccer tournament's sweepstake covers its group matchdays and its knockout (#2241): the
// matchdays are WEEK slots, where a team plays on after a loss, so only the knockout scores.
describe('knockout round points — a tournament with a group stage (#2241)', () => {
  const SEMIFINAL = roundSlot(SlotKind.SEMIFINAL);
  const FINAL = roundSlot(SlotKind.FINAL);
  const THIRD_PLACE = roundSlot(SlotKind.THIRD_PLACE);
  /** Two matchdays of a group of five, then a semifinal round, a third-place play-off and the final; Erie goes out in the group. */
  function groupStageField(): SportEventParticipantView[] {
    return bracketField([{ name: 'Argentina' }, { name: 'Brazil' }, { name: 'Chile' }, { name: 'Denmark' }, { name: 'Erie' }], [
      { matchNumber: 1, round: 1, slot: weekRoundSlot(1), home: 'Argentina', away: 'Brazil', winner: MatchSide.AWAY },
      { matchNumber: 2, round: 1, slot: weekRoundSlot(1), home: 'Chile', away: 'Erie', winner: MatchSide.HOME },
      { matchNumber: 3, round: 2, slot: weekRoundSlot(2), home: 'Erie', away: 'Denmark', winner: MatchSide.AWAY },
      { matchNumber: 4, round: 2, slot: weekRoundSlot(2), home: 'Argentina', away: 'Chile' },
      { matchNumber: 5, round: 3, slot: SEMIFINAL, home: 'Argentina', away: 'Denmark', winner: MatchSide.HOME, advancesTo: 8 },
      { matchNumber: 6, round: 3, slot: SEMIFINAL, home: 'Brazil', away: 'Chile', winner: MatchSide.AWAY, advancesTo: 8 },
      { matchNumber: 7, round: 4, slot: THIRD_PLACE, home: 'Denmark', away: 'Brazil', winner: MatchSide.HOME },
      { matchNumber: 8, round: 5, slot: FINAL, home: 'Argentina', away: 'Chile', winner: MatchSide.HOME },
    ]);
  }

  it('scores the knockout rounds by their values from the first knockout round, a group matchday win and the third-place play-off scoring nothing', () => {
    expect(scores(groupStageField(), knockout([1, 2]))).toEqual({ Argentina: 3, Brazil: 0, Chile: 1, Denmark: 0, Erie: 0 });
  });

  it('keeps a team that lost a group matchday in the running until it loses a knockout match, and puts out a team left out of the knockout', () => {
    const field = groupStageField().map((row) => ({ ...row, matches: row.matches.filter((match) => match.roundNumber <= 3) }));
    const records = Object.fromEntries(family.scoreField(field, TOURNAMENT, knockout([1, 2]), EVERY_ROUND).map((row) => [row.name, row.detail]));

    expect(records).toMatchObject({
      Argentina: { wins: 1, isAlive: true },
      Brazil: { wins: 0, isAlive: false },
      Chile: { wins: 1, isAlive: true },
      Denmark: { wins: 0, isAlive: false },
      Erie: { wins: 0, isAlive: false },
    });
  });

  it('scores no team while only the group stage has results, as no knockout round is decided', () => {
    const field = groupStageField().map((row) => ({ ...row, matches: row.matches.filter((match) => match.roundNumber <= 2) }));

    expect(scores(field, knockout([1, 2]))).toEqual({ Argentina: null, Brazil: null, Chile: null, Denmark: null, Erie: null });
  });
});
