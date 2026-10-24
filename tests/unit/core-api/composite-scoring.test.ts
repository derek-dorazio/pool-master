import {
  ParticipantRoundStatus,
  ScoringFamily,
  Sport,
  SportEventStatus,
  type SportEventParticipantStatLine,
  type SportStat,
} from '@poolmaster/shared/domain';
import { getScoringFamilyModule } from '../../../packages/core-api/src/modules/scoring-families';
import type { FieldScoringEvent } from '../../../packages/core-api/src/modules/scoring-families/scoring-family-module';
import type { SportEventParticipantView } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// The composite family's scoring rules (#934): a stat pool player's games, each the sport's
// composite of their stat lines, summed; a game not played scores 0, and nothing is scored
// before the first game's lines are in.

const family = getScoringFamilyModule(ScoringFamily.COMPOSITE);
const WORLD_SERIES: FieldScoringEvent = { sport: Sport.BASEBALL, scoringFamily: ScoringFamily.COMPOSITE, rounds: 7, roundsPar: undefined, status: SportEventStatus.IN_PROGRESS };
const COMPOSITE_TOTAL = { participantScoringDefinitionId: 'COMPOSITE_TOTAL', config: {} } as const;

type Games = Record<number, Partial<Record<SportStat, number>>>;

function field(players: Record<string, Games>): SportEventParticipantView[] {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.BASEBALL);
  const event = store.addEvent({ sport: Sport.BASEBALL });
  return Object.entries(players).map(([name, games]) => {
    const participant = store.addParticipant(sport.id, name);
    const entry = store.addToField(event.id, participant.id);
    const rounds = Object.entries(games).map(([roundNumber, stats]) => {
      const roundId = store.id('participant-round');
      const statLines: SportEventParticipantStatLine[] = Object.entries(stats).map(([stat, value]) => ({
        id: store.id('stat-line'),
        participantRoundId: roundId,
        stat: stat as SportStat,
        value,
        createdAt: new Date('2025-10-25T03:00:00.000Z'),
        updatedAt: new Date(`2025-10-2${4 + Number(roundNumber)}T03:00:00.000Z`),
      }));
      return {
        round: { id: roundId, sportEventParticipantId: entry.id, sportEventRoundId: `round-${roundNumber}`, roundNumber: Number(roundNumber), status: ParticipantRoundStatus.COMPLETED, completedAt: null, createdAt: new Date(), updatedAt: new Date() },
        golf: null,
        statLines,
      };
    });
    return { entry, participant, valuation: null, standing: null, rounds, raceResult: null, matches: [], affiliatedWithSportLeague: true };
  });
}

describe('composite — a stat pool player\'s score', () => {
  it('sums each game\'s Box Score, listing each game played in round order', () => {
    const [ace] = family.scoreField(field({
      Ace: { 2: { WALKS: 1, STOLEN_BASES: 1 }, 1: { TOTAL_BASES: 4, RUNS: 1, RUNS_BATTED_IN: 2 } },
    }), WORLD_SERIES, COMPOSITE_TOTAL);

    expect([ace.score, ace.detail]).toEqual([9, {
      scoringFamily: ScoringFamily.COMPOSITE,
      gameScores: [{ roundNumber: 1, score: 7 }, { roundNumber: 2, score: 2 }],
    }]);
    expect(ace.asOf).toEqual(new Date('2025-10-26T03:00:00.000Z'));
  });

  it('scores a player with no line 0 once any game\'s lines are in, as a game not played', () => {
    const scores = family.scoreField(field({ Ace: { 1: { RUNS: 1 } }, Bench: {} }), WORLD_SERIES, COMPOSITE_TOTAL);

    expect(scores.map((row) => [row.name, row.score, row.asOf])).toEqual([['Ace', 1, expect.any(Date)], ['Bench', 0, null]]);
  });

  it('leaves every player unscored before the first game\'s lines are in', () => {
    expect(family.scoreField(field({ Ace: {}, Blaze: {} }), WORLD_SERIES, COMPOSITE_TOTAL).map((row) => row.score)).toEqual([null, null]);
  });

  it('scores each counting pick of a missed lineup 0, as a player who played no game', () => {
    expect(family.scoreMissedLineup([], WORLD_SERIES, COMPOSITE_TOTAL, 4)).toBe(0);
  });

  it('accepts no live scores until a stat provider is chosen', () => {
    expect(family.liveScores).toBeNull();
  });

  it('refuses to score an event whose sport has no composite', () => {
    expect(() => family.scoreField([], { ...WORLD_SERIES, sport: Sport.GOLF }, COMPOSITE_TOTAL)).toThrow();
  });
});
