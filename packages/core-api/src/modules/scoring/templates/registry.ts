/**
 * Template Registry — aggregates all sport templates into a single lookup.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';
import { GOLF_TEMPLATES } from './golf';
import { F1_TEMPLATES } from './f1';
import { NASCAR_TEMPLATES } from './nascar';
import { NCAA_TEMPLATES } from './ncaa';
import { NBA_TEMPLATES } from './nba';
import { TENNIS_TEMPLATES } from './tennis';
import { HORSE_RACING_TEMPLATES } from './horse-racing';
import { SOCCER_TEMPLATES } from './soccer';

export const SCORING_TEMPLATES: Record<string, ScoringConfig> = {
  ...GOLF_TEMPLATES,
  ...F1_TEMPLATES,
  ...NASCAR_TEMPLATES,
  ...NCAA_TEMPLATES,
  ...NBA_TEMPLATES,
  ...TENNIS_TEMPLATES,
  ...HORSE_RACING_TEMPLATES,
  ...SOCCER_TEMPLATES,
};

/** Get a template by key. Returns undefined if not found. */
export function getTemplate(key: string): ScoringConfig | undefined {
  return SCORING_TEMPLATES[key];
}

/** List all available template keys grouped by sport. */
export function listTemplates(): Array<{ key: string; sport: string }> {
  return Object.entries(SCORING_TEMPLATES).map(([key, config]) => ({
    key,
    sport: config.sport,
  }));
}
