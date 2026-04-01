import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import { SCORING_TEMPLATES, getTemplate, listTemplates } from '../../../packages/core-api/src/modules/scoring/templates/registry';
import { GOLF_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/golf';
import { F1_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/f1';
import { NASCAR_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/nascar';
import { NCAA_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/ncaa';
import { NBA_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/nba';
import { TENNIS_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/tennis';
import { HORSE_RACING_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/horse-racing';
import { SOCCER_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/soccer';
import { scoreParticipant, scoreEntry } from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';
import type { ParticipantScoringData } from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';

// ========================================================================
// All templates must pass Zod validation
// ========================================================================

describe('All scoring templates pass schema validation', () => {
  const templateEntries = Object.entries(SCORING_TEMPLATES);

  it('registry contains all expected templates', () => {
    // NFL(0) + Golf(2) + F1(1) + NASCAR(1) + NCAA(4) + NBA(1) + Tennis(1) + Horse Racing(1) + Soccer(1) = 12
    expect(templateEntries.length).toBeGreaterThanOrEqual(12);
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
    const config = getTemplate('golf_relative_to_par');
    expect(config).toBeDefined();
    expect(config!.sport).toBe('GOLF');
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
// 03-009: Golf Templates
// ========================================================================

describe('Golf templates', () => {
  it('relative-to-par template scores birdies negative and bogeys positive', () => {
    const config = ScoringConfigSchema.parse(GOLF_TEMPLATES.golf_relative_to_par);
    const golfer: ParticipantScoringData = {
      participantId: 'scheffler',
      stats: { birdie: 18, par: 40, bogey: 10, eagle: 2 },
      isDNF: false,
    };
    const result = scoreParticipant(config, golfer);
    // birdie: 18*-1=-18, par: 40*0=0, bogey: 10*1=10, eagle: 2*-2=-4
    expect(result.statPoints).toBe(-12);
    expect(result.positionPoints).toBe(0); // no position rules
    expect(result.bonusPoints).toBe(0); // no bonus rules
  });

  it('stroke play uses BEST_N and lower_is_better', () => {
    const config = ScoringConfigSchema.parse(GOLF_TEMPLATES.golf_pick6_use4);
    expect(config.counting_method).toBe('BEST_N');
    expect(config.best_n).toBe(4);
    expect(config.lower_is_better).toBe(true);
    expect(config.dnf_handling).toBe('ZERO');
  });

  it('stroke play scores a roster with relative-to-par stats', () => {
    const config = ScoringConfigSchema.parse(GOLF_TEMPLATES.golf_pick6_use4);
    const golfers: ParticipantScoringData[] = [
      // Good golfer: lots of birdies, few bogeys -> low (negative) score
      { participantId: 'g1', stats: { birdie: 15, par: 45, bogey: 8, eagle: 1 }, isDNF: false },
      // Great golfer: most birdies
      { participantId: 'g2', stats: { birdie: 20, par: 40, bogey: 6, eagle: 2 }, isDNF: false },
      // Average golfer
      { participantId: 'g3', stats: { birdie: 10, par: 48, bogey: 12, eagle: 0 }, isDNF: false },
      // Decent golfer
      { participantId: 'g4', stats: { birdie: 12, par: 46, bogey: 10, eagle: 1 }, isDNF: false },
      // Missed cut (ZERO dnf handling -> score 0)
      { participantId: 'g5', stats: { birdie: 5, par: 20, bogey: 8 }, isDNF: false, isMissedCut: true },
      // Solid golfer
      { participantId: 'g6', stats: { birdie: 14, par: 44, bogey: 9, eagle: 1 }, isDNF: false },
    ];
    const result = scoreEntry(config, golfers);
    // g1: 15*-1 + 45*0 + 8*1 + 1*-2 = -15+8-2 = -9
    // g2: 20*-1 + 40*0 + 6*1 + 2*-2 = -20+6-4 = -18
    // g3: 10*-1 + 48*0 + 12*1 + 0 = -10+12 = 2
    // g4: 12*-1 + 46*0 + 10*1 + 1*-2 = -12+10-2 = -4
    // g5: missed cut -> ZERO dnf handling -> score 0
    // g6: 14*-1 + 44*0 + 9*1 + 1*-2 = -14+9-2 = -7
    // lower_is_better: sorted ascending: -18(g2), -9(g1), -7(g6), -4(g4), 0(g5), 2(g3)
    // Best 4 (lowest): -18 + -9 + -7 + -4 = -38
    expect(result.totalScore).toBe(-38);
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
    // laps_led: 30*0.1=3, classified: 1, fastest: 1, teammate: 3 -> stat=8
    // spots_gained 3 -> bonus: 2 (3-4 range)
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
    // bonus: laps_led>=1 -> 2
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
  it('nba_simple has 3 stat rules (points, assists, rebounds)', () => {
    const config = ScoringConfigSchema.parse(NBA_TEMPLATES.nba_simple);
    expect(config.stat_rules).toHaveLength(3);
  });

  it('simple scoring scores a stat line', () => {
    const config = ScoringConfigSchema.parse(NBA_TEMPLATES.nba_simple);
    const player: ParticipantScoringData = {
      participantId: 'jokic',
      stats: {
        points: 30,
        rebounds: 12,
        assists: 10,
      },
      isDNF: false,
    };
    const result = scoreParticipant(config, player);
    // pts: 30*1=30, reb: 12*1.25=15, ast: 10*1.5=15
    // Total: 30 + 15 + 15 = 60
    expect(result.statPoints).toBe(60);
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
  it('soccer_goals_assists has 5 stat rules (goals, assists, yellow, red, own goal)', () => {
    const config = ScoringConfigSchema.parse(SOCCER_TEMPLATES.soccer_goals_assists);
    expect(config.stat_rules).toHaveLength(5);
  });

  it('scores a forward with goals and assists', () => {
    const config = ScoringConfigSchema.parse(SOCCER_TEMPLATES.soccer_goals_assists);
    const forward: ParticipantScoringData = {
      participantId: 'haaland',
      stats: {
        goal_scored: 2,
        assist: 1,
        yellow_card: 1,
      },
      isDNF: false,
    };
    const result = scoreParticipant(config, forward);
    // goals: 2*6=12, assist: 1*4=4, yellow: 1*-1=-1
    // Total: 12 + 4 - 1 = 15
    expect(result.statPoints).toBe(15);
  });
});
