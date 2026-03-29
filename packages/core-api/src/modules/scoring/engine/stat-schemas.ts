/**
 * Sport Stat Schemas — defines the valid stat keys per sport.
 * Used to validate that a ScoringConfig only references stat keys
 * that exist in the sport's schema.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const STAT_SCHEMAS: Record<string, string[]> = {
  NFL: [
    'passing_yards', 'passing_td', 'interception_thrown', 'rushing_yards', 'rushing_td',
    'receiving_yards', 'receiving_td', 'reception', 'fumble_lost', 'fg_made_0_39',
    'fg_made_40_49', 'fg_made_50_plus', 'fg_missed', 'pat_made', 'pat_missed', 'sack',
    'defensive_td', 'interception_caught', 'fumble_recovery', 'safety',
    'passing_2pt_conversion', 'rushing_2pt_conversion', 'receiving_2pt_conversion',
  ],

  NBA: [
    'points', 'rebounds', 'assists', 'steals', 'blocks', 'three_pointer_made',
    'turnover', 'field_goal_made', 'field_goal_attempted', 'free_throw_made',
    'double_double', 'triple_double',
  ],

  GOLF: [
    'hole_in_one', 'albatross', 'eagle', 'birdie', 'par', 'bogey',
    'double_bogey', 'triple_bogey_or_worse', 'round_score', 'total_strokes',
    'position', 'made_cut', 'missed_cut', 'withdrew', 'bogey_free_round',
    'consecutive_birdies',
  ],

  F1: [
    'finish_position', 'grid_position', 'spots_gained', 'classified_finish',
    'laps_led', 'fastest_lap', 'beat_teammate', 'dnf', 'grid_penalty',
    'spots_lost_3_4', 'spots_lost_5_9', 'spots_lost_10_plus',
  ],

  NASCAR: [
    'finish_position', 'start_position', 'place_differential', 'laps_led',
    'fastest_lap', 'stage_win', 'led_most_laps', 'dnf',
  ],

  TENNIS: [
    'wins', 'losses', 'round_reached', 'aces', 'double_faults',
    'break_points_won', 'straight_sets_win', 'position',
  ],

  SOCCER: [
    'goal_scored', 'assist', 'shot_on_target', 'key_pass', 'clean_sheet',
    'clean_sheet_gk', 'clean_sheet_def', 'save', 'penalty_save', 'tackle',
    'interception', 'yellow_card', 'red_card', 'own_goal', 'penalty_missed',
    'minutes_played',
  ],

  HORSE_RACING: ['finish_position', 'dnf', 'scratched'],

  NCAA_BASKETBALL: ['round_reached', 'games_won', 'seed'],

  MLB: [
    'at_bats', 'runs', 'hits', 'home_runs', 'rbi', 'stolen_bases',
    'walks', 'strikeouts', 'batting_average', 'on_base_pct',
    'innings_pitched', 'wins', 'losses', 'earned_runs', 'era',
    'strikeouts_pitched', 'walks_pitched', 'saves', 'quality_start',
  ],

  UFC: [
    'ko_tko', 'submission', 'decision', 'round1_finish', 'round1_ko',
    'fight_win', 'fight_loss', 'performance_bonus',
  ],
};

export interface StatValidationError {
  field: 'stat_rules' | 'bonus_rules' | 'penalty_rules';
  stat_key: string;
  message: string;
}

/**
 * Validate that all stat_keys referenced in a ScoringConfig
 * are valid for the config's sport.
 *
 * Returns an empty array if all keys are valid.
 */
export function validateStatKeys(config: ScoringConfig): StatValidationError[] {
  const schema = STAT_SCHEMAS[config.sport];
  if (!schema) {
    // Unknown sport — skip validation (custom sport)
    return [];
  }

  const errors: StatValidationError[] = [];
  const validKeys = new Set(schema);

  for (const rule of config.stat_rules) {
    if (!validKeys.has(rule.stat_key)) {
      errors.push({
        field: 'stat_rules',
        stat_key: rule.stat_key,
        message: `Unknown stat key "${rule.stat_key}" for sport "${config.sport}"`,
      });
    }
  }

  for (const rule of config.bonus_rules) {
    if (!validKeys.has(rule.trigger.stat_key)) {
      errors.push({
        field: 'bonus_rules',
        stat_key: rule.trigger.stat_key,
        message: `Unknown bonus trigger stat key "${rule.trigger.stat_key}" for sport "${config.sport}"`,
      });
    }
  }

  for (const rule of config.penalty_rules) {
    if (!validKeys.has(rule.trigger)) {
      errors.push({
        field: 'penalty_rules',
        stat_key: rule.trigger,
        message: `Unknown penalty trigger "${rule.trigger}" for sport "${config.sport}"`,
      });
    }
  }

  return errors;
}

/** Get the valid stat keys for a sport, or undefined if unknown. */
export function getStatSchema(sport: string): string[] | undefined {
  return STAT_SCHEMAS[sport];
}

/** List all sports with defined stat schemas. */
export function listSports(): string[] {
  return Object.keys(STAT_SCHEMAS);
}
