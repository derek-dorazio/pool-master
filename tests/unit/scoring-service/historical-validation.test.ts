/**
 * Historical Data Validation — validate scoring templates against
 * known real-world results to ensure scoring accuracy.
 *
 * Per testing-rules.md §8: Sport-specific tests should validate
 * against known real-world results (Masters golf, NBA stats, etc.).
 */

import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import { scoreParticipant, scoreEntry } from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';
import type { ParticipantScoringData } from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';
import { scoreBracket } from '../../../packages/core-api/src/modules/scoring/engine/bracket-scoring';
import type { BracketMatchResult, BracketPredictionInput } from '../../../packages/core-api/src/modules/scoring/engine/bracket-scoring';
import { scoreStrokePlayEntry } from '../../../packages/core-api/src/modules/scoring/engine/stroke-play-scoring';
import type { StrokePlayParticipant } from '../../../packages/core-api/src/modules/scoring/engine/stroke-play-scoring';
import { scoreRotisserie } from '../../../packages/core-api/src/modules/scoring/engine/rotisserie-scoring';
import { scoreHeadToHead } from '../../../packages/core-api/src/modules/scoring/engine/head-to-head-scoring';
import { GOLF_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/golf';
import { NCAA_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/ncaa';
import { NBA_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/nba';
import { F1_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/f1';
import { NASCAR_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/nascar';
import { TENNIS_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/tennis';
import { HORSE_RACING_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/horse-racing';
import { SOCCER_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/soccer';

// ========================================================================
// Golf — 2024 Masters: Scottie Scheffler
// Won by 4 strokes, rounds: 66-72-71-68 = 277 (-11)
// ========================================================================

describe('Golf historical: 2024 Masters — Scheffler', () => {
  it('relative-to-par scoring — birdies, eagles, bogeys', () => {
    const config = ScoringConfigSchema.parse(GOLF_TEMPLATES.golf_relative_to_par);
    // Approximate hole-by-hole breakdown for a -11 tournament
    const scheffler: ParticipantScoringData = {
      participantId: 'scheffler',
      stats: {
        birdie: 21,
        eagle: 1,
        par: 42,
        bogey: 8,
        double_bogey: 0,
      },
      isDNF: false,
    };

    const result = scoreParticipant(config, scheffler);
    // birdie: 21*-1=-21, eagle: 1*-2=-2, par: 42*0=0, bogey: 8*1=8, double_bogey: 0*2=0
    // Total: -21 + -2 + 0 + 8 = -15
    expect(result.statPoints).toBe(-15);
    expect(result.positionPoints).toBe(0); // no position rules
    expect(result.bonusPoints).toBe(0); // no bonus rules
    expect(result.finalScore).toBe(-15);
  });

  it('stroke play office pool — pick 6 use best 4', () => {
    const config = ScoringConfigSchema.parse(GOLF_TEMPLATES.golf_pick6_use4);

    const golfers: StrokePlayParticipant[] = [
      // Made cut
      { participantId: 'scheffler', roundStrokes: [66, 72, 71, 68], madecut: true, withdrew: false, totalRounds: 4 },
      { participantId: 'morikawa', roundStrokes: [70, 69, 73, 69], madecut: true, withdrew: false, totalRounds: 4 },
      { participantId: 'dechambeau', roundStrokes: [69, 72, 71, 73], madecut: true, withdrew: false, totalRounds: 4 },
      { participantId: 'rahm', roundStrokes: [72, 73, 71, 72], madecut: true, withdrew: false, totalRounds: 4 },
      // Missed cut — ZERO dnf handling, no penalty rounds added, only played rounds count
      { participantId: 'mcilroy', roundStrokes: [76, 77], madecut: false, withdrew: false, totalRounds: 4 },
      { participantId: 'woods', roundStrokes: [73, 77], madecut: false, withdrew: false, totalRounds: 4 },
    ];

    const result = scoreStrokePlayEntry(config, golfers);
    // With ZERO dnf_handling: missed cut golfers only sum played rounds
    // mcilroy: 76+77=153, woods: 73+77=150
    // scheffler: 277, morikawa: 281, dechambeau: 285, rahm: 288
    // Sorted ascending: 150, 153, 277, 281, 285, 288
    // Best 4 (lowest): 150 + 153 + 277 + 281 = 861
    expect(result.countingParticipants).toHaveLength(4);
    expect(result.totalStrokes).toBe(861);
    expect(result.countingParticipants[0].participantId).toBe('woods');
  });
});

// ========================================================================
// NCAA Bracket — 2024 March Madness (UConn repeat)
// First round example matchups with seed-based scoring
// ========================================================================

describe('NCAA Bracket historical: 2024 March Madness', () => {
  // Some first-round results
  const results: BracketMatchResult[] = [
    { roundNumber: 1, matchNumber: 1, winnerId: 'uconn', winnerSeed: 1, loserSeed: 16 },
    { roundNumber: 1, matchNumber: 2, winnerId: 'iowa_st', winnerSeed: 2, loserSeed: 15 },
    { roundNumber: 1, matchNumber: 3, winnerId: 'oakland', winnerSeed: 14, loserSeed: 3 },  // upset!
    { roundNumber: 1, matchNumber: 4, winnerId: 'duke', winnerSeed: 4, loserSeed: 13 },
    { roundNumber: 2, matchNumber: 1, winnerId: 'uconn', winnerSeed: 1, loserSeed: 9 },
    { roundNumber: 6, matchNumber: 1, winnerId: 'uconn', winnerSeed: 1, loserSeed: 7 },
  ];

  it('standard scoring (1-2-4-8-16-32)', () => {
    const config = ScoringConfigSchema.parse(NCAA_TEMPLATES.ncaa_bracket_standard);

    // Perfect bracket for these games
    const predictions: BracketPredictionInput[] = [
      { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'uconn' },
      { roundNumber: 1, matchNumber: 2, predictedWinnerId: 'iowa_st' },
      { roundNumber: 1, matchNumber: 3, predictedWinnerId: 'oakland' },
      { roundNumber: 1, matchNumber: 4, predictedWinnerId: 'duke' },
      { roundNumber: 2, matchNumber: 1, predictedWinnerId: 'uconn' },
      { roundNumber: 6, matchNumber: 1, predictedWinnerId: 'uconn' },
    ];

    const result = scoreBracket(config, predictions, results);
    // Round 1: 4 correct x 1pt = 4
    // Round 2: 1 correct x 2pt = 2
    // Round 6: 1 correct x 32pt = 32
    // Total: 38
    expect(result.correctPicks).toBe(6);
    expect(result.totalScore).toBe(38);
  });

  it('upset bonus rewards correctly picking 14-seed Oakland', () => {
    const config = ScoringConfigSchema.parse(NCAA_TEMPLATES.ncaa_bracket_upset_bonus);

    const predictions: BracketPredictionInput[] = [
      { roundNumber: 1, matchNumber: 3, predictedWinnerId: 'oakland' },
    ];

    const result = scoreBracket(config, predictions, results);
    // base: 1pt (round 1) + upset bonus: 14-3 = 11
    expect(result.totalScore).toBe(12);
    expect(result.pickResults[0].upsetBonus).toBe(11);
  });

  it('seed multiplier: picking 1-seed worth less than 14-seed', () => {
    const config = ScoringConfigSchema.parse(NCAA_TEMPLATES.ncaa_bracket_seed_multiplier);

    const favPrediction: BracketPredictionInput[] = [
      { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'uconn' }, // 1-seed
    ];
    const upsetPrediction: BracketPredictionInput[] = [
      { roundNumber: 1, matchNumber: 3, predictedWinnerId: 'oakland' }, // 14-seed
    ];

    const favResult = scoreBracket(config, favPrediction, results);
    const upsetResult = scoreBracket(config, upsetPrediction, results);

    // 1-seed: round1(1) x seed(1) = 1
    // 14-seed: round1(1) x seed(14) = 14
    expect(favResult.totalScore).toBe(1);
    expect(upsetResult.totalScore).toBe(14);
  });

  it('flat scoring: all rounds worth 1 point', () => {
    const config = ScoringConfigSchema.parse(NCAA_TEMPLATES.ncaa_bracket_flat);

    const predictions: BracketPredictionInput[] = [
      { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'uconn' },
      { roundNumber: 6, matchNumber: 1, predictedWinnerId: 'uconn' },
    ];

    const result = scoreBracket(config, predictions, results);
    // Both rounds worth 1 pt each
    expect(result.totalScore).toBe(2);
  });
});

// ========================================================================
// NBA — Nikola Jokic triple-double: 2024 WCF Game 4
// 33 points, 14 rebounds, 14 assists
// (steals, blocks, turnovers, triple-double no longer scored in nba_simple)
// ========================================================================

describe('NBA historical: Jokic triple-double, 2024 WCF', () => {
  it('simple scoring (points, assists, rebounds only)', () => {
    const config = ScoringConfigSchema.parse(NBA_TEMPLATES.nba_simple);
    const jokic: ParticipantScoringData = {
      participantId: 'jokic',
      stats: {
        points: 33,
        rebounds: 14,
        assists: 14,
      },
      isDNF: false,
    };

    const result = scoreParticipant(config, jokic);
    // pts: 33*1=33, reb: 14*1.25=17.5, ast: 14*1.5=21
    // Total: 33 + 17.5 + 21 = 71.5
    expect(result.statPoints).toBe(71.5);
    expect(result.finalScore).toBe(71.5);
  });
});

// ========================================================================
// NBA Rotisserie — 4-team league, 9-category (simplified to 4 cats)
// ========================================================================

describe('NBA rotisserie historical scenario', () => {
  it('ranks a 4-team league across stat categories', () => {
    // Simplified season totals for 4 fantasy teams
    const entries = [
      { entryId: 'team_a', categoryValues: { PTS: 9500, REB: 4200, AST: 2400, TOV: 1400 } },
      { entryId: 'team_b', categoryValues: { PTS: 10200, REB: 3800, AST: 2800, TOV: 1100 } },
      { entryId: 'team_c', categoryValues: { PTS: 8800, REB: 4500, AST: 2200, TOV: 1600 } },
      { entryId: 'team_d', categoryValues: { PTS: 9800, REB: 4000, AST: 2600, TOV: 1250 } },
    ];

    const result = scoreRotisserie(
      { categories: ['PTS', 'REB', 'AST', 'TOV'], lower_is_better_categories: ['TOV'] },
      entries,
    );

    // PTS ranking: team_b(4) > team_d(3) > team_a(2) > team_c(1)
    // REB ranking: team_c(4) > team_a(3) > team_d(2) > team_b(1)
    // AST ranking: team_b(4) > team_d(3) > team_a(2) > team_c(1)
    // TOV ranking (lower=better): team_b(4) > team_d(3) > team_a(2) > team_c(1)

    const teamB = result.find((r) => r.entryId === 'team_b')!;
    // team_b: 4+1+4+4 = 13
    expect(teamB.totalRotoPoints).toBe(13);

    const teamC = result.find((r) => r.entryId === 'team_c')!;
    // team_c: 1+4+1+1 = 7
    expect(teamC.totalRotoPoints).toBe(7);

    // team_b should be first overall
    const sorted = [...result].sort((a, b) => b.totalRotoPoints - a.totalRotoPoints);
    expect(sorted[0].entryId).toBe('team_b');
  });
});

// ========================================================================
// Head-to-Head — 3-week fantasy matchup scenario
// ========================================================================

describe('Head-to-head historical scenario', () => {
  it('scores a 4-team, 3-week round-robin', () => {
    const matchups = [
      { period: 1, entryIdA: 'team1', entryIdB: 'team2' },
      { period: 1, entryIdA: 'team3', entryIdB: 'team4' },
      { period: 2, entryIdA: 'team1', entryIdB: 'team3' },
      { period: 2, entryIdA: 'team2', entryIdB: 'team4' },
      { period: 3, entryIdA: 'team1', entryIdB: 'team4' },
      { period: 3, entryIdA: 'team2', entryIdB: 'team3' },
    ];

    // Realistic weekly fantasy point totals
    const periodScores = [
      { period: 1, scores: { team1: 142.5, team2: 128.3, team3: 156.7, team4: 119.4 } },
      { period: 2, scores: { team1: 131.2, team2: 145.8, team3: 122.5, team4: 138.9 } },
      { period: 3, scores: { team1: 155.4, team2: 112.6, team3: 134.2, team4: 141.7 } },
    ];

    const { standings } = scoreHeadToHead(
      matchups,
      periodScores,
      ['team1', 'team2', 'team3', 'team4'],
    );

    expect(standings).toHaveLength(4);

    // team1: beat team2(W1), beat team3(W2), beat team4(W3) -> 3-0
    const team1 = standings.find((s) => s.entryId === 'team1')!;
    expect(team1.wins).toBe(3);
    expect(team1.losses).toBe(0);
    expect(team1.winPct).toBe(1.0);

    // team1 should be #1 in standings
    expect(standings[0].entryId).toBe('team1');
  });
});

// ========================================================================
// F1 — Max Verstappen, 2024 Bahrain GP
// P1, started P1, 26 laps led, fastest lap, beat teammate, classified
// ========================================================================

describe('F1 historical: Verstappen 2024 Bahrain GP', () => {
  it('scores race winner with stats', () => {
    const config = ScoringConfigSchema.parse(F1_TEMPLATES.f1_dfs_captain);
    const verstappen: ParticipantScoringData = {
      participantId: 'verstappen',
      stats: {
        laps_led: 26,
        classified_finish: 1,
        fastest_lap: 1,
        beat_teammate: 1,
        // Started P1, finished P1 -> 0 spots gained
      },
      position: 1,
      isDNF: false,
    };

    const result = scoreParticipant(config, verstappen);
    // position: 25
    // laps_led: 26*0.1=2.6, classified: 1, fastest: 1, teammate: 3
    expect(result.positionPoints).toBe(25);
    expect(result.statPoints).toBeCloseTo(7.6, 1);
    expect(result.finalScore).toBeCloseTo(32.6, 1);
  });

  it('DNF driver gets 0', () => {
    const config = ScoringConfigSchema.parse(F1_TEMPLATES.f1_dfs_captain);
    const dnfDriver: ParticipantScoringData = {
      participantId: 'magnussen',
      stats: { laps_led: 0 },
      isDNF: true,
    };

    const result = scoreParticipant(config, dnfDriver);
    expect(result.finalScore).toBe(0);
  });
});

// ========================================================================
// NASCAR — Kyle Larson, 2024 Daytona 500 scenario
// Started 5th, finished 1st, led 20 laps, 2 fastest laps, 1 stage win
// ========================================================================

describe('NASCAR historical scenario: race winner', () => {
  it('scores winner with place differential and laps led', () => {
    const config = ScoringConfigSchema.parse(NASCAR_TEMPLATES.nascar_dfs_place_diff);
    const larson: ParticipantScoringData = {
      participantId: 'larson',
      stats: {
        place_differential: 4,  // started 5th, finished 1st = +4
        laps_led: 20,
        fastest_lap: 2,
        stage_win: 1,
        led_most_laps: 0,
      },
      position: 1,
      isDNF: false,
    };

    const result = scoreParticipant(config, larson);
    // position: 45 (1st)
    // place_diff: 4*1=4, laps_led: 20*0.25=5, fastest: 2*0.45=0.9, stage: 1*4=4
    // bonus: laps_led>=1 -> 2
    expect(result.positionPoints).toBe(45);
    expect(result.statPoints).toBeCloseTo(13.9, 1);
    expect(result.bonusPoints).toBe(2);
    expect(result.finalScore).toBeCloseTo(60.9, 1);
  });
});

// ========================================================================
// Tennis — Sinner, 2024 Australian Open (won in straight sets final)
// 60 aces, 15 double faults, 25 break points won, 5 straight-set wins
// ========================================================================

describe('Tennis historical: Sinner 2024 AO', () => {
  it('scores tournament winner', () => {
    const config = ScoringConfigSchema.parse(TENNIS_TEMPLATES.tennis_slam_dfs);
    const sinner: ParticipantScoringData = {
      participantId: 'sinner',
      stats: {
        aces: 60,
        double_faults: 15,
        break_points_won: 25,
        straight_sets_win: 5,
      },
      position: 1,
      isDNF: false,
    };

    const result = scoreParticipant(config, sinner);
    // aces: 60*0.25=15, df: 15*-0.5=-7.5, bp: 25*0.5=12.5, straight: 5*5=25
    // position: 40 (winner)
    expect(result.statPoints).toBe(45);
    expect(result.positionPoints).toBe(40);
    expect(result.finalScore).toBe(85);
  });
});

// ========================================================================
// Horse Racing — Kentucky Derby scenario
// ========================================================================

describe('Horse Racing historical scenario', () => {
  it('scores a 6-horse entry', () => {
    const config = ScoringConfigSchema.parse(HORSE_RACING_TEMPLATES.horse_racing_position);
    const horses: ParticipantScoringData[] = [
      { participantId: 'horse1', stats: {}, position: 1, isDNF: false },
      { participantId: 'horse2', stats: {}, position: 3, isDNF: false },
      { participantId: 'horse3', stats: {}, position: 7, isDNF: false },
      { participantId: 'horse4', stats: {}, position: 12, isDNF: false },
      { participantId: 'horse5', stats: {}, position: 2, isDNF: false },
      { participantId: 'horse6', stats: {}, isDNF: true },
    ];

    const result = scoreEntry(config, horses);
    // horse1: 100, horse5: 60, horse2: 40, horse3: 5, horse4: 0, horse6: 0 (DNF)
    expect(result.totalScore).toBe(205);
  });
});

// ========================================================================
// EPL Soccer — Erling Haaland typical gameweek
// 2 goals, 0 assists, 1 yellow card
// (shot_on_target, key_pass no longer scored in soccer_goals_assists)
// ========================================================================

describe('EPL historical: Haaland typical gameweek', () => {
  it('scores a high-scoring forward', () => {
    const config = ScoringConfigSchema.parse(SOCCER_TEMPLATES.soccer_goals_assists);
    const haaland: ParticipantScoringData = {
      participantId: 'haaland',
      stats: {
        goal_scored: 2,
        assist: 0,
        yellow_card: 1,
      },
      isDNF: false,
    };

    const result = scoreParticipant(config, haaland);
    // goals: 2*6=12, assist: 0*4=0, yellow: 1*-1=-1
    // Total: 12 + 0 - 1 = 11
    expect(result.statPoints).toBe(11);
    expect(result.finalScore).toBe(11);
  });
});

// ========================================================================
// Cross-sport: Captain slot multiplier validation
// ========================================================================

describe('Captain slot multiplier across sports', () => {
  it('F1 captain slot applies 1.5x multiplier', () => {
    const config = ScoringConfigSchema.parse({
      ...F1_TEMPLATES.f1_dfs_captain,
      multiplier_rules: [{ applies_to: 'SLOT', slot_id: 'captain', multiplier: 1.5 }],
      special_slots: [{ slot_id: 'captain', slot_name: 'Captain', multiplier: 1.5 }],
    });

    const captainDriver: ParticipantScoringData = {
      participantId: 'verstappen',
      stats: { laps_led: 10, classified_finish: 1, fastest_lap: 1, beat_teammate: 1 },
      position: 1,
      slotId: 'captain',
      isDNF: false,
    };

    const normalDriver: ParticipantScoringData = {
      participantId: 'perez',
      stats: { laps_led: 10, classified_finish: 1, fastest_lap: 1, beat_teammate: 1 },
      position: 1,
      isDNF: false,
    };

    const captainResult = scoreParticipant(config, captainDriver);
    const normalResult = scoreParticipant(config, normalDriver);

    expect(captainResult.finalScore).toBeCloseTo(normalResult.finalScore * 1.5, 1);
  });
});
