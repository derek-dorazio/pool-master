/**
 * Selection Config Templates — pre-built selection configurations per sport per contest type.
 *
 * Reduces commissioner setup time by providing sensible defaults for common pool formats.
 * Templates cover all 9 supported sports with ~20 templates total.
 */

import type { Sport, SelectionType } from '@poolmaster/shared/domain';

export interface SelectionTemplate {
  id: string;
  name: string;
  description: string;
  sport: Sport;
  contestType: string;
  selectionType: SelectionType;
  config: Record<string, unknown>;
}

export const SELECTION_TEMPLATES: SelectionTemplate[] = [
  // --- Golf ---
  {
    id: 'golf-snake-4rd',
    name: 'Golf Snake Draft (4 rounds)',
    description: 'Classic snake draft with 4 rounds for golf tournaments. Each manager drafts 4 golfers.',
    sport: 'GOLF',
    contestType: 'SINGLE_EVENT',
    selectionType: 'SNAKE_DRAFT',
    config: { rounds: 4, timePerPickSeconds: 120, draftMode: 'ASYNC' },
  },
  {
    id: 'golf-tiered-6pick4',
    name: 'Golf 6-Tier Pick (Use Best 4)',
    description: 'Pick one golfer from each of 6 tiers. Best 4 of 6 scores count. Classic Masters pool format.',
    sport: 'GOLF',
    contestType: 'SINGLE_EVENT',
    selectionType: 'TIERED',
    config: {
      tierCount: 6,
      picksPerTier: 1,
      bestBallN: 4,
      isExclusive: false,
      tierAssignmentMethod: 'ODDS',
    },
  },
  {
    id: 'golf-budget-50k',
    name: 'Golf Budget $50K',
    description: 'Build a 6-golfer roster under a $50,000 salary cap. DraftKings-style format.',
    sport: 'GOLF',
    contestType: 'SINGLE_EVENT',
    selectionType: 'BUDGET_PICK',
    config: { budget: 5000000, rosterSize: 6, pricingMethod: 'ODDS', isExclusive: false },
  },

  // --- NFL (team-based only — player fantasy deferred) ---
  {
    id: 'nfl-survivor',
    name: 'NFL Survivor Pool',
    description: 'Pick one team per week to win. Survive or go home. Each team usable only once.',
    sport: 'NFL',
    contestType: 'SINGLE_EVENT',
    selectionType: 'PICK_EM',
    config: { picksPerPeriod: 1, oneEntityPerSeason: true, strikesBeforeElimination: 0 },
  },
  {
    id: 'nfl-pickem-confidence',
    name: 'NFL Confidence Pick\'em',
    description: 'Pick winners for all games each week. Assign confidence points to weight your picks.',
    sport: 'NFL',
    contestType: 'SINGLE_EVENT',
    selectionType: 'PICK_EM',
    config: { confidenceWeighted: true, picksPerPeriod: 16 },
  },

  // --- NCAA Basketball ---
  {
    id: 'ncaa-bracket-64',
    name: 'NCAA Bracket (Full 64)',
    description: 'Full March Madness bracket. Pick winners for all 63 games with round multipliers.',
    sport: 'NCAA_BASKETBALL',
    contestType: 'SINGLE_EVENT',
    selectionType: 'BRACKET_PICK_EM',
    config: { roundValues: [1, 2, 4, 8, 16, 32], startRound: 'ROUND_OF_64' },
  },
  {
    id: 'ncaa-pick8',
    name: 'NCAA Pick 8 Teams',
    description: 'Pick 8 teams for the tournament. Points for each win by your teams.',
    sport: 'NCAA_BASKETBALL',
    contestType: 'SINGLE_EVENT',
    selectionType: 'OPEN_SELECTION',
    config: { pickCount: 8, isExclusive: false },
  },
  {
    id: 'ncaa-tiered-seed',
    name: 'NCAA Seed-Based Tiers',
    description: 'Pick teams from seed-based tiers. One from each seed group (1-4, 5-8, 9-12, 13-16).',
    sport: 'NCAA_BASKETBALL',
    contestType: 'SINGLE_EVENT',
    selectionType: 'TIERED',
    config: {
      tierCount: 4,
      picksPerTier: 1,
      isExclusive: false,
      tierAssignmentMethod: 'SEED',
    },
  },

  // --- NBA (season-long fantasy removed — playoffs only) ---
  {
    id: 'nba-playoff-tiers',
    name: 'NBA Playoff Tiers',
    description: 'Pick one team from each tier for the NBA playoffs. Points for wins and series advances.',
    sport: 'NBA',
    contestType: 'SINGLE_EVENT',
    selectionType: 'TIERED',
    config: { tierCount: 4, picksPerTier: 1, isExclusive: false, tierAssignmentMethod: 'SEED' },
  },

  // --- F1 ---
  {
    id: 'f1-budget-weekly',
    name: 'F1 Budget Cap (Race Weekend)',
    description: 'Build a driver lineup under salary cap for a single Grand Prix.',
    sport: 'F1',
    contestType: 'SINGLE_EVENT',
    selectionType: 'BUDGET_PICK',
    config: { budget: 10000000, rosterSize: 5, pricingMethod: 'WORLD_RANKING', isExclusive: false },
  },
  // f1-season-snake removed — season-long fantasy deferred

  // --- Tennis ---
  {
    id: 'tennis-slam-budget',
    name: 'Grand Slam Salary Cap',
    description: 'Build a player lineup under salary cap for a Grand Slam tournament.',
    sport: 'TENNIS',
    contestType: 'SINGLE_EVENT',
    selectionType: 'BUDGET_PICK',
    config: { budget: 5000000, rosterSize: 8, pricingMethod: 'WORLD_RANKING', isExclusive: false },
  },
  {
    id: 'tennis-slam-bracket',
    name: 'Grand Slam Bracket',
    description: 'Predict the draw bracket for a Grand Slam. Points for correct round predictions.',
    sport: 'TENNIS',
    contestType: 'SINGLE_EVENT',
    selectionType: 'BRACKET_PICK_EM',
    config: { roundValues: [1, 2, 4, 8, 16, 32, 64], startRound: 'ROUND_OF_128' },
  },

  // --- Soccer (season-long fantasy removed — tournament pools only) ---
  {
    id: 'soccer-ucl-bracket',
    name: 'Champions League Bracket',
    description: 'Predict the UCL knockout bracket. Bonus for exact score predictions.',
    sport: 'SOCCER',
    contestType: 'SINGLE_EVENT',
    selectionType: 'BRACKET_PICK_EM',
    config: { roundValues: [2, 4, 8, 16], correctScoreBonus: 3 },
  },

  // --- NASCAR ---
  {
    id: 'nascar-snake-4rd',
    name: 'NASCAR Snake Draft (4 rounds)',
    description: 'Draft 4 drivers for a race. Best 3 of 4 scores count.',
    sport: 'NASCAR',
    contestType: 'SINGLE_EVENT',
    selectionType: 'SNAKE_DRAFT',
    config: { rounds: 4, timePerPickSeconds: 120, draftMode: 'ASYNC', bestBallN: 3 },
  },
  {
    id: 'nascar-season-survivor',
    name: 'NASCAR Season Survivor',
    description: 'Pick one driver per race to finish in the top 10. Eliminated if they don\'t.',
    sport: 'NASCAR',
    contestType: 'SINGLE_EVENT',
    selectionType: 'PICK_EM',
    config: { picksPerPeriod: 1, oneEntityPerSeason: true, strikesBeforeElimination: 1 },
  },

  // --- Horse Racing ---
  {
    id: 'hr-tiered-odds',
    name: 'Horse Racing Odds Tiers',
    description: 'Pick horses from odds-based tiers. One from each group for the big race.',
    sport: 'HORSE_RACING',
    contestType: 'SINGLE_EVENT',
    selectionType: 'TIERED',
    config: { tierCount: 4, picksPerTier: 1, isExclusive: false, tierAssignmentMethod: 'ODDS' },
  },
  {
    id: 'hr-budget-derby',
    name: 'Derby Budget Pool',
    description: 'Build a stable under salary cap for the Kentucky Derby or similar.',
    sport: 'HORSE_RACING',
    contestType: 'SINGLE_EVENT',
    selectionType: 'BUDGET_PICK',
    config: { budget: 2000000, rosterSize: 4, pricingMethod: 'ODDS', isExclusive: false },
  },
];

/**
 * Get all templates for a specific sport.
 */
export function getTemplatesForSport(sport: Sport): SelectionTemplate[] {
  return SELECTION_TEMPLATES.filter((t) => t.sport === sport);
}

/**
 * Get templates for a specific sport and contest type combination.
 */
export function getTemplatesForContestType(
  sport: Sport,
  contestType: string,
): SelectionTemplate[] {
  return SELECTION_TEMPLATES.filter(
    (t) => t.sport === sport && t.contestType === contestType,
  );
}

/**
 * Get a single template by ID.
 */
export function getTemplateById(id: string): SelectionTemplate | undefined {
  return SELECTION_TEMPLATES.find((t) => t.id === id);
}
