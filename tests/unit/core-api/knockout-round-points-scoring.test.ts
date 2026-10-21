import {
  MatchEnding,
  MatchSide,
  MatchStatus,
  ScoringFamily,
  Sport,
  SportEventStatus,
  UpsetBonusRule,
  type ContestScoringSettings,
  type SportEventMatch,
  type UpsetBonus,
} from '@poolmaster/shared/domain';
import { getScoringFamilyModule } from '../../../packages/core-api/src/modules/scoring-families';
import { upsetBonusFor } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/score-team';
import type { FieldScoringEvent } from '../../../packages/core-api/src/modules/scoring-families/scoring-family-module';
import type { SportEventParticipantView } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// Knockout round points (#699): what each team scores from the bracket's results under a
// contest's round values and upset bonus, and when a team is left unscored.

const family = getScoringFamilyModule(ScoringFamily.HEAD_TO_HEAD);
const TOURNAMENT: FieldScoringEvent = { sport: Sport.BASKETBALL, rounds: 2, roundsPar: undefined, status: SportEventStatus.IN_PROGRESS };
const NO_BONUS: UpsetBonus = { rule: UpsetBonusRule.NONE };
const SEED_DIFFERENCE: UpsetBonus = { rule: UpsetBonusRule.SEED_DIFFERENCE, multiplier: 1 };

function knockout(roundValues: number[], upsetBonus: UpsetBonus = NO_BONUS): ContestScoringSettings {
  return { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues, upsetBonus } };
}

interface TeamInput {
  name: string;
  seed?: number;
}

interface MatchInput {
  matchNumber: number;
  round: number;
  home: string | null;
  away: string | null;
  winner?: MatchSide;
  /** The match number and side its winner advances to. */
  advancesTo?: number;
}

/** The field of teams, each row carrying the bracket matches it is in, as the field read attaches them. */
function bracketField(teams: TeamInput[], matchInputs: MatchInput[]): SportEventParticipantView[] {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.BASKETBALL);
  const event = store.addEvent({ sport: Sport.BASKETBALL, rounds: 2 });
  const rows = teams.map(({ name, seed }) => {
    const participant = store.addParticipant(sport.id, name, { participantType: 'TEAM' });
    const entry = store.addToField(event.id, participant.id, seed === undefined ? {} : { seedNumber: seed });
    return { name, entry, participant };
  });
  const idOf = (name: string | null) => (name === null ? null : rows.find((row) => row.name === name)?.entry.id ?? null);
  const matches: SportEventMatch[] = matchInputs.map((input) => ({
    id: `match-${input.matchNumber}`,
    sportEventId: event.id,
    roundNumber: input.round,
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
    periodScores: [],
    createdAt: new Date('2027-03-18T16:00:00.000Z'),
    updatedAt: new Date('2027-03-18T16:00:00.000Z'),
  }));
  return rows.map(({ entry, participant }) => ({
    entry,
    participant,
    valuation: null,
    standing: null,
    rounds: [],
    raceResult: null,
    matches: matches.filter((match) => match.homeSportEventParticipantId === entry.id || match.awaySportEventParticipantId === entry.id),
    affiliatedWithSportLeague: true,
  }));
}

function scores(field: SportEventParticipantView[], scoring: ContestScoringSettings): Record<string, number | null> {
  return Object.fromEntries(family.scoreField(field, TOURNAMENT, scoring).map((row) => [row.name, row.score]));
}

const SEEDED = [
  { name: 'Duke', seed: 1 },
  { name: 'Vermont', seed: 4 },
  { name: 'Houston', seed: 2 },
  { name: 'Texas', seed: 3 },
];

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

  it('scores a team placed straight into a later round (a bye) nothing for the round it skipped', () => {
    const field = bracketField(
      [{ name: 'Duke', seed: 1 }, { name: 'Vermont', seed: 4 }, { name: 'Houston', seed: 2 }],
      [
        { matchNumber: 1, round: 1, home: 'Vermont', away: 'Houston', winner: MatchSide.AWAY, advancesTo: 2 },
        { matchNumber: 2, round: 2, home: 'Duke', away: 'Houston', winner: MatchSide.HOME },
      ],
    );

    expect(scores(field, knockout([1, 2]))).toEqual({ Duke: 2, Vermont: 0, Houston: 1 });
  });

  it('leaves a team that won in a round with no value unscored rather than scoring it 0', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.HOME, advancesTo: 3 },
      { matchNumber: 3, round: 2, home: 'Duke', away: 'Houston', winner: MatchSide.HOME },
    ]);

    expect(scores(field, knockout([1]))).toMatchObject({ Duke: null, Houston: 0 });
  });

  it('leaves every team unscored under another family\'s scoring definition', () => {
    const field = bracketField(SEEDED, [
      { matchNumber: 1, round: 1, home: 'Duke', away: 'Vermont', winner: MatchSide.HOME },
    ]);

    expect(scores(field, { participantScoringDefinitionId: 'FINISH_POSITION_POINTS', config: { pointsTable: [5], didNotFinishPoints: 0 } }))
      .toEqual({ Duke: null, Vermont: null, Houston: null, Texas: null });
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

    const details = Object.fromEntries(family.scoreField(field, TOURNAMENT, knockout([1, 2], SEED_DIFFERENCE)).map((row) => [row.name, row.detail]));

    expect(details).toMatchObject({
      Vermont: { scoringFamily: ScoringFamily.HEAD_TO_HEAD, wins: 1, upsetBonusPoints: 3, isAlive: true },
      Duke: { scoringFamily: ScoringFamily.HEAD_TO_HEAD, wins: 0, upsetBonusPoints: 0, isAlive: false },
    });
  });
});
