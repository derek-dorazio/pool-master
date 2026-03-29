import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import { scoreBracket } from '../../../packages/core-api/src/modules/scoring/engine/bracket-scoring';
import type {
  BracketMatchResult,
  BracketPredictionInput,
} from '../../../packages/core-api/src/modules/scoring/engine/bracket-scoring';
import { scoreRotisserie } from '../../../packages/core-api/src/modules/scoring/engine/rotisserie-scoring';
import type { RotisserieEntryStats } from '../../../packages/core-api/src/modules/scoring/engine/rotisserie-scoring';
import {
  evaluateMatchup,
  calculateRecords,
  scoreHeadToHead,
} from '../../../packages/core-api/src/modules/scoring/engine/head-to-head-scoring';
import type { Matchup, PeriodScores } from '../../../packages/core-api/src/modules/scoring/engine/head-to-head-scoring';
import {
  scoreStrokePlayParticipant,
  scoreStrokePlayEntry,
} from '../../../packages/core-api/src/modules/scoring/engine/stroke-play-scoring';
import type { StrokePlayParticipant } from '../../../packages/core-api/src/modules/scoring/engine/stroke-play-scoring';

// ========================================================================
// 03-021: Bracket Scoring
// ========================================================================

describe('Bracket scoring', () => {
  const standardConfig = ScoringConfigSchema.parse({
    sport: 'NCAA_BASKETBALL',
    scoring_type: 'BRACKET',
    bracket_round_rules: [
      { round: 1, points_per_correct: 1 },
      { round: 2, points_per_correct: 2 },
      { round: 3, points_per_correct: 4 },
      { round: 4, points_per_correct: 8 },
      { round: 5, points_per_correct: 16 },
      { round: 6, points_per_correct: 32 },
    ],
  });

  const results: BracketMatchResult[] = [
    { roundNumber: 1, matchNumber: 1, winnerId: 'duke', winnerSeed: 1, loserSeed: 16 },
    { roundNumber: 1, matchNumber: 2, winnerId: 'uconn', winnerSeed: 4, loserSeed: 13 },
    { roundNumber: 1, matchNumber: 3, winnerId: 'fairleigh', winnerSeed: 16, loserSeed: 1 },
    { roundNumber: 2, matchNumber: 1, winnerId: 'duke', winnerSeed: 1, loserSeed: 4 },
  ];

  it('scores correct picks with round-based points', () => {
    const predictions: BracketPredictionInput[] = [
      { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'duke' },
      { roundNumber: 1, matchNumber: 2, predictedWinnerId: 'uconn' },
      { roundNumber: 2, matchNumber: 1, predictedWinnerId: 'duke' },
    ];

    const result = scoreBracket(standardConfig, predictions, results);
    expect(result.correctPicks).toBe(3);
    expect(result.totalPicks).toBe(3);
    // Round 1: 1+1=2, Round 2: 2 → total 4
    expect(result.totalScore).toBe(4);
  });

  it('scores incorrect picks as 0', () => {
    const predictions: BracketPredictionInput[] = [
      { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'wrong_team' },
    ];

    const result = scoreBracket(standardConfig, predictions, results);
    expect(result.correctPicks).toBe(0);
    expect(result.totalScore).toBe(0);
  });

  it('handles unplayed matches gracefully', () => {
    const predictions: BracketPredictionInput[] = [
      { roundNumber: 6, matchNumber: 1, predictedWinnerId: 'duke' },
    ];

    const result = scoreBracket(standardConfig, predictions, results);
    expect(result.correctPicks).toBe(0);
    expect(result.totalScore).toBe(0);
  });

  it('applies SEED_DIFFERENCE upset bonus', () => {
    const upsetConfig = ScoringConfigSchema.parse({
      ...standardConfig,
      upset_bonus_config: { type: 'SEED_DIFFERENCE', apply_round_multiplier: false },
    });

    // Predict the 16-seed upset correctly
    const predictions: BracketPredictionInput[] = [
      { roundNumber: 1, matchNumber: 3, predictedWinnerId: 'fairleigh' },
    ];

    const result = scoreBracket(upsetConfig, predictions, results);
    expect(result.correctPicks).toBe(1);
    // base: 1 (round 1) + upset bonus: 16-1=15 → total 16
    expect(result.totalScore).toBe(16);
    expect(result.pickResults[0].upsetBonus).toBe(15);
  });

  it('no upset bonus for favorites winning', () => {
    const upsetConfig = ScoringConfigSchema.parse({
      ...standardConfig,
      upset_bonus_config: { type: 'SEED_DIFFERENCE', apply_round_multiplier: false },
    });

    const predictions: BracketPredictionInput[] = [
      { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'duke' }, // 1-seed wins, no upset
    ];

    const result = scoreBracket(upsetConfig, predictions, results);
    expect(result.pickResults[0].upsetBonus).toBe(0);
    expect(result.totalScore).toBe(1);
  });

  it('applies SEED_MULTIPLIER scoring', () => {
    const seedMultConfig = ScoringConfigSchema.parse({
      ...standardConfig,
      upset_bonus_config: { type: 'SEED_MULTIPLIER', apply_round_multiplier: true },
    });

    const predictions: BracketPredictionInput[] = [
      { roundNumber: 1, matchNumber: 3, predictedWinnerId: 'fairleigh' }, // 16-seed
    ];

    const result = scoreBracket(seedMultConfig, predictions, results);
    // round 1 points_per_correct(1) × seed(16) = 16
    expect(result.totalScore).toBe(16);
  });

  it('SEED_MULTIPLIER: 1-seed worth less than higher seeds', () => {
    const seedMultConfig = ScoringConfigSchema.parse({
      ...standardConfig,
      upset_bonus_config: { type: 'SEED_MULTIPLIER', apply_round_multiplier: true },
    });

    const predictions: BracketPredictionInput[] = [
      { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'duke' }, // 1-seed
    ];

    const result = scoreBracket(seedMultConfig, predictions, results);
    // round 1(1) × seed(1) = 1
    expect(result.totalScore).toBe(1);
  });
});

// ========================================================================
// 03-022: Rotisserie Scoring
// ========================================================================

describe('Rotisserie scoring', () => {
  const entries: RotisserieEntryStats[] = [
    { entryId: 'team1', categoryValues: { PTS: 1000, REB: 500, AST: 300, TOV: 150 } },
    { entryId: 'team2', categoryValues: { PTS: 1200, REB: 450, AST: 350, TOV: 100 } },
    { entryId: 'team3', categoryValues: { PTS: 900, REB: 600, AST: 280, TOV: 200 } },
    { entryId: 'team4', categoryValues: { PTS: 1100, REB: 480, AST: 320, TOV: 120 } },
  ];

  it('ranks entries across categories (higher is better)', () => {
    const result = scoreRotisserie(
      { categories: ['PTS', 'REB', 'AST'] },
      entries,
    );

    expect(result).toHaveLength(4);

    // PTS: team2(4) > team4(3) > team1(2) > team3(1)
    const team2 = result.find((r) => r.entryId === 'team2')!;
    expect(team2.categoryRanks['PTS']).toBe(4);

    const team3 = result.find((r) => r.entryId === 'team3')!;
    expect(team3.categoryRanks['PTS']).toBe(1);
  });

  it('handles lower_is_better categories (e.g. turnovers)', () => {
    const result = scoreRotisserie(
      {
        categories: ['PTS', 'TOV'],
        lower_is_better_categories: ['TOV'],
      },
      entries,
    );

    // TOV lower is better: team2(100)=4pts, team4(120)=3pts, team1(150)=2pts, team3(200)=1pt
    const team2 = result.find((r) => r.entryId === 'team2')!;
    expect(team2.categoryRanks['TOV']).toBe(4); // best (lowest TOV)

    const team3 = result.find((r) => r.entryId === 'team3')!;
    expect(team3.categoryRanks['TOV']).toBe(1); // worst (highest TOV)
  });

  it('handles ties by averaging rank points', () => {
    const tiedEntries: RotisserieEntryStats[] = [
      { entryId: 'a', categoryValues: { PTS: 100 } },
      { entryId: 'b', categoryValues: { PTS: 100 } },
      { entryId: 'c', categoryValues: { PTS: 50 } },
    ];

    const result = scoreRotisserie({ categories: ['PTS'] }, tiedEntries);

    // a and b tied for 1st: average of 3 and 2 = 2.5 each
    const a = result.find((r) => r.entryId === 'a')!;
    const b = result.find((r) => r.entryId === 'b')!;
    const c = result.find((r) => r.entryId === 'c')!;

    expect(a.categoryRanks['PTS']).toBe(2.5);
    expect(b.categoryRanks['PTS']).toBe(2.5);
    expect(c.categoryRanks['PTS']).toBe(1);
  });

  it('sums category rank points into total', () => {
    const result = scoreRotisserie(
      { categories: ['PTS', 'REB', 'AST'] },
      entries,
    );

    for (const entry of result) {
      const catSum = Object.values(entry.categoryRanks).reduce((a, b) => a + b, 0);
      expect(entry.totalRotoPoints).toBe(catSum);
    }
  });

  it('returns empty array for no entries', () => {
    expect(scoreRotisserie({ categories: ['PTS'] }, [])).toEqual([]);
  });
});

// ========================================================================
// 03-023: Head-to-Head Scoring
// ========================================================================

describe('Head-to-head scoring', () => {
  describe('evaluateMatchup', () => {
    it('determines winner correctly', () => {
      const matchup: Matchup = { period: 1, entryIdA: 'a', entryIdB: 'b' };
      const scores: PeriodScores = { period: 1, scores: { a: 120, b: 95 } };

      const result = evaluateMatchup(matchup, scores);
      expect(result.winnerId).toBe('a');
      expect(result.scoreA).toBe(120);
      expect(result.scoreB).toBe(95);
    });

    it('returns null winner for tie', () => {
      const matchup: Matchup = { period: 1, entryIdA: 'a', entryIdB: 'b' };
      const scores: PeriodScores = { period: 1, scores: { a: 100, b: 100 } };

      const result = evaluateMatchup(matchup, scores);
      expect(result.winnerId).toBeNull();
    });

    it('handles missing scores as 0', () => {
      const matchup: Matchup = { period: 1, entryIdA: 'a', entryIdB: 'b' };
      const scores: PeriodScores = { period: 1, scores: { a: 50 } };

      const result = evaluateMatchup(matchup, scores);
      expect(result.winnerId).toBe('a');
      expect(result.scoreB).toBe(0);
    });
  });

  describe('calculateRecords', () => {
    it('accumulates wins/losses/ties correctly', () => {
      const results = [
        { period: 1, entryIdA: 'a', entryIdB: 'b', scoreA: 100, scoreB: 90, winnerId: 'a' },
        { period: 2, entryIdA: 'a', entryIdB: 'b', scoreA: 80, scoreB: 110, winnerId: 'b' },
        { period: 3, entryIdA: 'a', entryIdB: 'b', scoreA: 95, scoreB: 95, winnerId: null },
      ];

      const records = calculateRecords(results, ['a', 'b']);

      const recA = records.find((r) => r.entryId === 'a')!;
      expect(recA.wins).toBe(1);
      expect(recA.losses).toBe(1);
      expect(recA.ties).toBe(1);
      expect(recA.pointsFor).toBe(275);
      expect(recA.pointsAgainst).toBe(295);

      const recB = records.find((r) => r.entryId === 'b')!;
      expect(recB.wins).toBe(1);
      expect(recB.losses).toBe(1);
      expect(recB.ties).toBe(1);
    });

    it('calculates win percentage with ties as half-win', () => {
      const results = [
        { period: 1, entryIdA: 'a', entryIdB: 'b', scoreA: 100, scoreB: 90, winnerId: 'a' },
        { period: 2, entryIdA: 'a', entryIdB: 'b', scoreA: 95, scoreB: 95, winnerId: null },
      ];

      const records = calculateRecords(results, ['a', 'b']);
      const recA = records.find((r) => r.entryId === 'a')!;
      // 1 win + 0.5 tie = 1.5 / 2 games = 0.75
      expect(recA.winPct).toBe(0.75);
    });

    it('sorts by win% then points for', () => {
      const results = [
        { period: 1, entryIdA: 'a', entryIdB: 'b', scoreA: 50, scoreB: 100, winnerId: 'b' },
        { period: 1, entryIdA: 'c', entryIdB: 'd', scoreA: 120, scoreB: 80, winnerId: 'c' },
      ];

      const records = calculateRecords(results, ['a', 'b', 'c', 'd']);
      // c and b both have 1 win. c has 120 PF, b has 100 PF → c first
      expect(records[0].entryId).toBe('c');
      expect(records[1].entryId).toBe('b');
    });
  });

  describe('scoreHeadToHead', () => {
    it('scores a full 3-week season', () => {
      const matchups: Matchup[] = [
        { period: 1, entryIdA: 'a', entryIdB: 'b' },
        { period: 1, entryIdA: 'c', entryIdB: 'd' },
        { period: 2, entryIdA: 'a', entryIdB: 'c' },
        { period: 2, entryIdA: 'b', entryIdB: 'd' },
        { period: 3, entryIdA: 'a', entryIdB: 'd' },
        { period: 3, entryIdA: 'b', entryIdB: 'c' },
      ];

      const periodScores: PeriodScores[] = [
        { period: 1, scores: { a: 100, b: 90, c: 110, d: 80 } },
        { period: 2, scores: { a: 95, b: 105, c: 85, d: 100 } },
        { period: 3, scores: { a: 120, b: 88, c: 92, d: 75 } },
      ];

      const { standings, matchupResults } = scoreHeadToHead(
        matchups,
        periodScores,
        ['a', 'b', 'c', 'd'],
      );

      expect(matchupResults).toHaveLength(6);
      expect(standings).toHaveLength(4);
      // Each team played 3 games
      for (const rec of standings) {
        expect(rec.wins + rec.losses + rec.ties).toBe(3);
      }
    });
  });
});

// ========================================================================
// 03-024: Stroke Play Scoring
// ========================================================================

describe('Stroke play scoring', () => {
  describe('scoreStrokePlayParticipant', () => {
    it('scores a golfer who made the cut', () => {
      const golfer: StrokePlayParticipant = {
        participantId: 'g1',
        roundStrokes: [70, 68, 72, 69],
        madecut: true,
        withdrew: false,
        totalRounds: 4,
      };

      const result = scoreStrokePlayParticipant(golfer, 80, 'MISSED_CUT_SCORE');
      expect(result.totalStrokes).toBe(279);
      expect(result.missedCutRounds).toBe(0);
      expect(result.excluded).toBe(false);
    });

    it('applies missed cut penalty for unplayed rounds', () => {
      const golfer: StrokePlayParticipant = {
        participantId: 'g2',
        roundStrokes: [75, 76],
        madecut: false,
        withdrew: false,
        totalRounds: 4,
      };

      const result = scoreStrokePlayParticipant(golfer, 80, 'MISSED_CUT_SCORE');
      // 75 + 76 + 80 + 80 = 311
      expect(result.totalStrokes).toBe(311);
      expect(result.missedCutRounds).toBe(2);
      expect(result.roundStrokes).toEqual([75, 76, 80, 80]);
    });

    it('EXCLUDE: marks golfer as excluded on missed cut', () => {
      const golfer: StrokePlayParticipant = {
        participantId: 'g3',
        roundStrokes: [78, 79],
        madecut: false,
        withdrew: false,
        totalRounds: 4,
      };

      const result = scoreStrokePlayParticipant(golfer, 80, 'EXCLUDE');
      expect(result.excluded).toBe(true);
      expect(result.totalStrokes).toBe(0);
    });

    it('handles withdrawal', () => {
      const golfer: StrokePlayParticipant = {
        participantId: 'g4',
        roundStrokes: [72],
        madecut: false,
        withdrew: true,
        totalRounds: 4,
      };

      const result = scoreStrokePlayParticipant(golfer, 80, 'MISSED_CUT_SCORE');
      // 72 + 80 + 80 + 80 = 312
      expect(result.totalStrokes).toBe(312);
      expect(result.missedCutRounds).toBe(3);
    });
  });

  describe('scoreStrokePlayEntry', () => {
    const config = ScoringConfigSchema.parse({
      sport: 'GOLF',
      scoring_type: 'STROKE_PLAY',
      missed_event_score: 80,
      dnf_handling: 'MISSED_CUT_SCORE',
      counting_method: 'BEST_N',
      best_n: 4,
      lower_is_better: true,
    });

    it('picks best 4 of 6 golfers', () => {
      const golfers: StrokePlayParticipant[] = [
        { participantId: 'g1', roundStrokes: [70, 68, 72, 69], madecut: true, withdrew: false, totalRounds: 4 },
        { participantId: 'g2', roundStrokes: [72, 71, 70, 71], madecut: true, withdrew: false, totalRounds: 4 },
        { participantId: 'g3', roundStrokes: [74, 73, 75, 74], madecut: true, withdrew: false, totalRounds: 4 },
        { participantId: 'g4', roundStrokes: [69, 70, 68, 70], madecut: true, withdrew: false, totalRounds: 4 },
        { participantId: 'g5', roundStrokes: [76, 77], madecut: false, withdrew: false, totalRounds: 4 },
        { participantId: 'g6', roundStrokes: [71, 70, 73, 72], madecut: true, withdrew: false, totalRounds: 4 },
      ];

      const result = scoreStrokePlayEntry(config, golfers);
      // g4: 277, g1: 279, g2: 284, g6: 286, g3: 296, g5: 313 (75+76+80+80)
      // Best 4: 277 + 279 + 284 + 286 = 1126
      expect(result.countingParticipants).toHaveLength(4);
      expect(result.totalStrokes).toBe(1126);
      expect(result.countingParticipants[0].participantId).toBe('g4'); // lowest
    });

    it('handles all golfers missing cut with EXCLUDE', () => {
      const excludeConfig = ScoringConfigSchema.parse({
        ...config,
        dnf_handling: 'EXCLUDE',
      });

      const golfers: StrokePlayParticipant[] = [
        { participantId: 'g1', roundStrokes: [80, 82], madecut: false, withdrew: false, totalRounds: 4 },
        { participantId: 'g2', roundStrokes: [79, 81], madecut: false, withdrew: false, totalRounds: 4 },
      ];

      const result = scoreStrokePlayEntry(excludeConfig, golfers);
      expect(result.countingParticipants).toHaveLength(0);
      expect(result.totalStrokes).toBe(0);
    });

    it('uses ALL counting method when configured', () => {
      const allConfig = ScoringConfigSchema.parse({
        ...config,
        counting_method: 'ALL',
      });

      const golfers: StrokePlayParticipant[] = [
        { participantId: 'g1', roundStrokes: [70, 68, 72, 69], madecut: true, withdrew: false, totalRounds: 4 },
        { participantId: 'g2', roundStrokes: [72, 71, 70, 71], madecut: true, withdrew: false, totalRounds: 4 },
      ];

      const result = scoreStrokePlayEntry(allConfig, golfers);
      // g1: 279, g2: 284 → total 563
      expect(result.totalStrokes).toBe(563);
      expect(result.countingParticipants).toHaveLength(2);
    });
  });
});
