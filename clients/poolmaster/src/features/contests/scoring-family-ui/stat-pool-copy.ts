import { ScoringFamily, Sport, type SportDefinition, type SportNoun } from '@poolmaster/shared/domain';

/**
 * The words a championship stat pool goes by on screen (#936): the contest type's name, what its
 * players are called in copy, and each sport's composite formula in words. Kept here alone so the
 * name can change in one place (#995). The composite names themselves (Box Score, Triple Threat,
 * Power Play, Redzone) are the sport definitions'.
 */
export const STAT_POOL_CONTEST_TYPE = 'Clutch Card';

/** What copy calls the players on a Clutch Card. Screens that list them keep the sport's word. */
export const STAT_POOL_STARS: SportNoun = { one: 'star', many: 'stars' };

/** How a Clutch Card goes, on How to Play: a line, then three steps, as each way to play's guide. */
export const STAT_POOL_GUIDE: { summary: string; steps: readonly [string, string, string] } = {
  summary: 'Pick stars for the title round. Every game is a round, and each star scores one stat in it.',
  steps: [
    'Pick your stars before the first game: from tiers, under a budget, or by quick pick.',
    'In every game, each star scores their sport’s stat, as a golfer scores each round of a golf pool.',
    'Your best stars’ points add up, and the most when the title round ends wins.',
  ],
};

/**
 * How each sport's composite is counted, in words, for a sport with a stat pool; null for every
 * other. A `Record` over the sports, so a sport that gains a composite needs its formula here.
 */
export const STAT_POOL_FORMULAS: Readonly<Record<Sport, string | null>> = {
  [Sport.GOLF]: null,
  [Sport.HORSE_RACING]: null,
  [Sport.AUTO_RACING]: null,
  [Sport.CYCLING]: null,
  [Sport.RUNNING]: null,
  [Sport.BASKETBALL]: 'points + rebounds + assists',
  [Sport.AMERICAN_FOOTBALL]: '6 × touchdowns + receptions + passing, rushing and receiving yards ÷ 10, rounded down',
  [Sport.HOCKEY]: '2 × goals + assists + shots on goal',
  [Sport.BASEBALL]: 'total bases + runs + RBI + walks + stolen bases',
  [Sport.SOCCER]: null,
  [Sport.TENNIS]: null,
};

/**
 * "Box Score: total bases + runs + RBI + walks + stolen bases, each game." How a stat pool scores,
 * for Create contest and How to Play; null for a definition that is not a stat pool's.
 */
export function statPoolScoringLine(definition: Pick<SportDefinition, 'sport' | 'scoringFamily' | 'composite'>): string | null {
  const formula = STAT_POOL_FORMULAS[definition.sport];
  if (definition.scoringFamily !== ScoringFamily.COMPOSITE || definition.composite === null || formula === null) {
    return null;
  }
  return `${definition.composite.name}: ${formula}, each game.`;
}
