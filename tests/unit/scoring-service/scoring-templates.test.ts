import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import { SCORING_TEMPLATES, getTemplate, listTemplates } from '../../../packages/scoring-service/src/templates/registry';
import { NFL_TEMPLATES } from '../../../packages/scoring-service/src/templates/nfl';
import { GOLF_TEMPLATES } from '../../../packages/scoring-service/src/templates/golf';
import { F1_TEMPLATES } from '../../../packages/scoring-service/src/templates/f1';
import { NASCAR_TEMPLATES } from '../../../packages/scoring-service/src/templates/nascar';
import { NCAA_TEMPLATES } from '../../../packages/scoring-service/src/templates/ncaa';
import { NBA_TEMPLATES } from '../../../packages/scoring-service/src/templates/nba';
import { TENNIS_TEMPLATES } from '../../../packages/scoring-service/src/templates/tennis';
import { HORSE_RACING_TEMPLATES } from '../../../packages/scoring-service/src/templates/horse-racing';
import { SOCCER_TEMPLATES } from '../../../packages/scoring-service/src/templates/soccer';
import { scoreParticipant, scoreEntry } from '../../../packages/scoring-service/src/engine/scoring-engine';
import type { ParticipantScoringData } from '../../../packages/scoring-service/src/engine/scoring-engine';

// ========================================================================
// All templates must pass Zod validation
// ========================================================================

describe('All scoring templates pass schema validation', () => {
  const templateEntries = Object.entries(SCORING_TEMPLATES);

  it('registry contains all expected templates', () => {
    expect(templateEntries.length).toBeGreaterThanOrEqual(15);
  });

  it.each(templateEntries)('%s parses via ScoringConfigSchema', (key, config) => {
    expect(() => ScoringConfigSchema.parse(config)).not.toThrow();
  });
});

// ========================================================================
// Registry
// ========================================================================

describe('Template registry', () => {
  it('getTemplate returns config for valid key', () => {
    const config = getTemplate('nfl_ppr');
    expect(config).toBeDefined();
    expect(config!.sport).toBe('NFL');
  });

  it('getTemplate returns undefined for invalid key', () => {
    expect(getTemplate('nonexistent')).toBeUndefined();
  });

  it('listTemplates returns all templates with sport', () => {
    const list = listTemplates();
    expect(list.length).toBe(Object.keys(SCORING_TEMPLATES).length);
    expect(list.every((t) => t.key && t.sport)).toBe(true);
  });
});

// ========================================================================
// 03-008: NFL Templates
// ========================================================================

describe('NFL templates', () => {
  it('standard has no reception stat', () => {
    const std = NFL_TEMPLATES.nfl_standard_nonppr;
    const hasReception = std.stat_rules.some((r) => r.stat_key === 'reception');
    expect(hasReception).toBe(false);
  });

  it('PPR awards 1 pt per reception', () => {
    const ppr = NFL_TEMPLATES.nfl_ppr;
    const reception = ppr.stat_rules.find((r) => r.stat_key === 'reception');
    expect(reception).toBeDefined();
    expect(reception!.points_per_unit).toBe(1);
  });

  it('half-PPR awards 0.5 pts per reception', () => {
    const halfPpr = NFL_TEMPLATES.nfl_half_ppr;
    const reception = halfPpr.stat_rules.find((r) => r.stat_key === 'reception');
    expect(reception).toBeDefined();
    expect(reception!.points_per_unit).toBe(0.5);
  });

  it('scores a QB correctly with standard scoring', () => {
    const config = ScoringConfigSchema.parse(NFL_TEMPLATES.nfl_standard_nonppr);
    const qb: ParticipantScoringData = {
      participantId: 'mahomes',
      stats: {
        passing_yards: 300,
        passing_td: 3,
        interception_thrown: 1,
        rushing_yards: 30,
      },
      isDNF: false,
    };
    const result = scoreParticipant(config, qb);
    // passing: 300*0.04=12, td: 3*4=12, int: -2, rushing: 30*0.1=3, bonus: 3 (300yd)
    expect(result.statPoints).toBe(25);
    expect(result.bonusPoints).toBe(3);
    expect(result.finalScore).toBe(28);
  });

  it('PPR scores receptions', () => {
    const config = ScoringConfigSchema.parse(NFL_TEMPLATES.nfl_ppr);
    const wr: ParticipantScoringData = {
      participantId: 'hill',
      stats: { reception: 8, receiving_yards: 120, receiving_td: 1 },
      isDNF: false,
    };
    const result = scoreParticipant(config, wr);
    // receptions: 8*1=8, yards: 120*0.1=12, td: 6, bonus: 3 (100+ receiving)
    expect(result.statPoints).toBe(26);
    expect(result.bonusPoints).toBe(3);
    expect(result.finalScore).toBe(29);
  });
});

// ========================================================================
// 03-009: Golf Templates
// ========================================================================

describe('Golf templates', () => {
  it('DFS template awards birdie and position points', () => {
    const config = ScoringConfigSchema.parse(GOLF_TEMPLATES.golf_dfs_standard);
    const golfer: ParticipantScoringData = {
      participantId: 'scheffler',
      stats: { birdie: 18, par: 40, bogey: 10, eagle: 2, bogey_free_round: 1 },
      position: 1,
      isDNF: false,
    };
    const result = scoreParticipant(config, golfer);
    // birdie: 18*3=54, par: 40*0.5=20, bogey: 10*-0.5=-5, eagle: 2*5=10
    expect(result.statPoints).toBe(79);
    expect(result.positionPoints).toBe(30); // 1st place
    // bogey_free_round bonus: 3
    expect(result.bonusPoints).toBe(3);
  });

  it('stroke play uses BEST_N and lower_is_better', () => {
    const config = ScoringConfigSchema.parse(GOLF_TEMPLATES.golf_stroke_pick6_use4);
    expect(config.counting_method).toBe('BEST_N');
    expect(config.best_n).toBe(4);
    expect(config.lower_is_better).toBe(true);
    expect(config.dnf_handling).toBe('MISSED_CUT_SCORE');
    expect(config.missed_event_score).toBe(80);
  });

  it('stroke play scores a roster with missed cut', () => {
    const config = ScoringConfigSchema.parse(GOLF_TEMPLATES.golf_stroke_pick6_use4);
    const golfers: ParticipantScoringData[] = [
      { participantId: 'g1', stats: { total_strokes: 280 }, isDNF: false },
      { participantId: 'g2', stats: { total_strokes: 275 }, isDNF: false },
      { participantId: 'g3', stats: { total_strokes: 290 }, isDNF: false },
      { participantId: 'g4', stats: { total_strokes: 285 }, isDNF: false },
      { participantId: 'g5', stats: { total_strokes: 140 }, isDNF: false, isMissedCut: true },
      { participantId: 'g6', stats: { total_strokes: 282 }, isDNF: false },
    ];
    const result = scoreEntry(config, golfers);
    // g5 missed cut → 80 strokes (missed_event_score)
    // Best 4 (lowest): 80(g5), 275(g2), 280(g1), 282(g6) = 917
    // Wait - g5 isMissedCut=true so handleDNF applies: score=80
    // Sorted ascending: 80, 275, 280, 282, 285, 290
    // Best 4 lowest: 80 + 275 + 280 + 282 = 917
    expect(result.totalScore).toBe(917);
    expect(result.countingParticipantIds).toHaveLength(4);
  });
});

// ========================================================================
// 03-010: F1 Template
// ========================================================================

describe('F1 template', () => {
  it('scores position + stats + bonuses + penalties', () => {
    const config = ScoringConfigSchema.parse(F1_TEMPLATES.f1_dfs_captain);
    const driver: ParticipantScoringData = {
      participantId: 'verstappen',
      stats: {
        laps_led: 30,
        classified_finish: 1,
        fastest_lap: 1,
        beat_teammate: 1,
        spots_gained: 3,
      },
      position: 1,
      isDNF: false,
    };
    const result = scoreParticipant(config, driver);
    // position: 25
    // laps_led: 30*0.1=3, classified: 1, fastest: 1, teammate: 3 → stat=8
    // spots_gained 3 → bonus: 2 (3-4 range)
    expect(result.positionPoints).toBe(25);
    expect(result.statPoints).toBe(8);
    expect(result.bonusPoints).toBe(2);
    expect(result.finalScore).toBe(35);
  });

  it('applies penalty for spots lost', () => {
    const config = ScoringConfigSchema.parse(F1_TEMPLATES.f1_dfs_captain);
    const driver: ParticipantScoringData = {
      participantId: 'perez',
      stats: { classified_finish: 1, spots_lost_5_9: 1 },
      position: 15,
      isDNF: false,
    };
    const result = scoreParticipant(config, driver);
    expect(result.penaltyPoints).toBe(-3);
  });

  it('DNF driver scores 0', () => {
    const config = ScoringConfigSchema.parse(F1_TEMPLATES.f1_dfs_captain);
    const driver: ParticipantScoringData = {
      participantId: 'dnf_driver',
      stats: { laps_led: 10 },
      position: undefined,
      isDNF: true,
    };
    const result = scoreParticipant(config, driver);
    expect(result.finalScore).toBe(0);
  });
});

// ========================================================================
// 03-011: NASCAR Template
// ========================================================================

describe('NASCAR template', () => {
  it('scores finish position and stats', () => {
    const config = ScoringConfigSchema.parse(NASCAR_TEMPLATES.nascar_dfs_place_diff);
    const driver: ParticipantScoringData = {
      participantId: 'larson',
      stats: {
        place_differential: 10,
        laps_led: 50,
        fastest_lap: 3,
        stage_win: 1,
        led_most_laps: 1,
      },
      position: 1,
      isDNF: false,
    };
    const result = scoreParticipant(config, driver);
    // position: 45
    // place_diff: 10, laps_led: 50*0.25=12.5, fastest: 3*0.45=1.35, stage: 4, led_most: 2
    // bonus: laps_led>=1 → 2
    expect(result.positionPoints).toBe(45);
    expect(result.bonusPoints).toBe(2);
  });
});

// ========================================================================
// 03-012: NCAA Bracket Templates
// ========================================================================

describe('NCAA bracket templates', () => {
  it('standard has 6 rounds with doubling points', () => {
    const config = NCAA_TEMPLATES.ncaa_bracket_standard;
    expect(config.bracket_round_rules).toHaveLength(6);
    expect(config.bracket_round_rules[0].points_per_correct).toBe(1);
    expect(config.bracket_round_rules[5].points_per_correct).toBe(32);
  });

  it('standard has no upset bonus', () => {
    expect(NCAA_TEMPLATES.ncaa_bracket_standard.upset_bonus_config).toBeNull();
  });

  it('upset bonus uses SEED_DIFFERENCE', () => {
    expect(NCAA_TEMPLATES.ncaa_bracket_upset_bonus.upset_bonus_config?.type).toBe('SEED_DIFFERENCE');
  });

  it('seed multiplier uses SEED_MULTIPLIER with round multiplier', () => {
    const config = NCAA_TEMPLATES.ncaa_bracket_seed_multiplier;
    expect(config.upset_bonus_config?.type).toBe('SEED_MULTIPLIER');
    expect(config.upset_bonus_config?.apply_round_multiplier).toBe(true);
  });

  it('flat scoring awards 1 pt per correct pick in every round', () => {
    const config = NCAA_TEMPLATES.ncaa_bracket_flat;
    expect(config.bracket_round_rules.every((r) => r.points_per_correct === 1)).toBe(true);
  });

  it('standard has championship tiebreaker', () => {
    expect(NCAA_TEMPLATES.ncaa_bracket_standard.tiebreaker_config?.primary).toBe(
      'CHAMPIONSHIP_SCORE_PREDICTION',
    );
  });
});

// ========================================================================
// 03-013: NBA Template
// ========================================================================

describe('NBA template', () => {
  it('points league scores a stat line', () => {
    const config = ScoringConfigSchema.parse(NBA_TEMPLATES.nba_points_league);
    const player: ParticipantScoringData = {
      participantId: 'jokic',
      stats: {
        points: 30,
        rebounds: 12,
        assists: 10,
        steals: 2,
        blocks: 1,
        three_pointer_made: 3,
        turnover: 4,
        triple_double: 1,
      },
      isDNF: false,
    };
    const result = scoreParticipant(config, player);
    // pts: 30, reb: 12*1.25=15, ast: 10*1.5=15, stl: 2*2=4, blk: 1*2=2
    // 3pm: 3*0.5=1.5, to: 4*-1=-4, triple_double: 3
    expect(result.statPoints).toBe(66.5);
  });
});

// ========================================================================
// 03-014: Tennis Template
// ========================================================================

describe('Tennis template', () => {
  it('scores tournament winner with stats', () => {
    const config = ScoringConfigSchema.parse(TENNIS_TEMPLATES.tennis_slam_dfs);
    const player: ParticipantScoringData = {
      participantId: 'sinner',
      stats: { aces: 40, double_faults: 8, break_points_won: 15, straight_sets_win: 3 },
      position: 1,
      isDNF: false,
    };
    const result = scoreParticipant(config, player);
    // position: 40 (winner)
    // aces: 40*0.25=10, df: 8*-0.5=-4, bp: 15*0.5=7.5, straight: 3*5=15
    expect(result.positionPoints).toBe(40);
    expect(result.statPoints).toBe(28.5);
  });

  it('quarterfinal exit gets correct position points', () => {
    const config = ScoringConfigSchema.parse(TENNIS_TEMPLATES.tennis_slam_dfs);
    const player: ParticipantScoringData = {
      participantId: 'qf_loser',
      stats: {},
      position: 7,
      isDNF: false,
    };
    const result = scoreParticipant(config, player);
    expect(result.positionPoints).toBe(20); // position 5-8 range
  });
});

// ========================================================================
// 03-015: Horse Racing Template
// ========================================================================

describe('Horse racing template', () => {
  it('awards position-only points', () => {
    const config = ScoringConfigSchema.parse(HORSE_RACING_TEMPLATES.horse_racing_position);
    expect(config.stat_rules).toHaveLength(0);

    const winner: ParticipantScoringData = {
      participantId: 'horse1',
      stats: {},
      position: 1,
      isDNF: false,
    };
    expect(scoreParticipant(config, winner).finalScore).toBe(100);

    const third: ParticipantScoringData = {
      participantId: 'horse3',
      stats: {},
      position: 3,
      isDNF: false,
    };
    expect(scoreParticipant(config, third).finalScore).toBe(40);

    const seventh: ParticipantScoringData = {
      participantId: 'horse7',
      stats: {},
      position: 7,
      isDNF: false,
    };
    expect(scoreParticipant(config, seventh).finalScore).toBe(5);
  });

  it('unplaced horse scores 0', () => {
    const config = ScoringConfigSchema.parse(HORSE_RACING_TEMPLATES.horse_racing_position);
    const unplaced: ParticipantScoringData = {
      participantId: 'horse15',
      stats: {},
      position: 15,
      isDNF: false,
    };
    expect(scoreParticipant(config, unplaced).finalScore).toBe(0);
  });
});

// ========================================================================
// 03-016: Soccer/EPL Template
// ========================================================================

describe('Soccer/EPL template', () => {
  it('scores a forward with goals and assists', () => {
    const config = ScoringConfigSchema.parse(SOCCER_TEMPLATES.epl_dfs_standard);
    const forward: ParticipantScoringData = {
      participantId: 'haaland',
      stats: {
        goal_scored: 2,
        assist: 1,
        shot_on_target: 4,
        yellow_card: 1,
      },
      isDNF: false,
    };
    const result = scoreParticipant(config, forward);
    // goals: 2*6=12, assist: 4, sot: 4*0.5=2, yellow: -1
    expect(result.statPoints).toBe(17);
  });

  it('scores a goalkeeper with clean sheet and saves', () => {
    const config = ScoringConfigSchema.parse(SOCCER_TEMPLATES.epl_dfs_standard);
    const gk: ParticipantScoringData = {
      participantId: 'raya',
      stats: {
        clean_sheet_gk: 1,
        save: 5,
        penalty_save: 1,
      },
      isDNF: false,
    };
    const result = scoreParticipant(config, gk);
    // clean_sheet: 6, saves: 5*1=5, pen_save: 5
    expect(result.statPoints).toBe(16);
  });
});
