import type { SelectionType } from '@poolmaster/shared/domain';

/** How one way to play goes, on the How to Play page: a line on its card, then three steps. */
export interface FormatGuide {
  summary: string;
  steps: readonly [string, string, string];
}

/**
 * Each way to play's guide on the How to Play page (#878). A `Record` over the selection types,
 * so a new way to play gains its guide with its definition, as a sport gains its line in
 * `SPORT_BLURBS`.
 */
export const FORMAT_GUIDES: Record<SelectionType, FormatGuide> = {
  TIERED: {
    summary: 'The field is split into tiers. Take a favorite and a long shot.',
    steps: [
      'The field is ranked into tiers, with the favorites in the first.',
      'Pick from every tier, so every entry has a contender and a dark horse.',
      'Your picks’ finishes add up on the live leaderboard.',
    ],
  },
  BUDGET_PICK: {
    summary: 'Every pick has a price. Build your lineup under the cap.',
    steps: [
      'Each player or team has a price, and the best cost the most.',
      'Spend your budget however you like: one star, or a lineup of bargains.',
      'The best total score wins.',
    ],
  },
  RANDOM_DRAW: {
    summary: 'No homework. Your picks are drawn for you.',
    steps: [
      'Join the contest. There is nothing to research.',
      'When the commissioner runs the draw, every entry is dealt its picks at random.',
      'Cheer on whoever you got.',
    ],
  },
  PICK_EM: {
    summary: 'Pick the winner of every game on the slate.',
    steps: [
      'Each week, pick a winner in every game.',
      'Change a pick any time before its game kicks off.',
      'Whoever gets the most picks right wins the week.',
    ],
  },
  BRACKET: {
    summary: 'Fill in the whole tournament before it starts.',
    steps: [
      'Pick every game, from the first round to the final.',
      'Later rounds are worth more, and some contests add a bonus for upsets.',
      'Watch your bracket hold up, round by round.',
    ],
  },
  SURVIVOR: {
    summary: 'One pick a round. Lose and you’re out.',
    steps: [
      'Each round, pick one team to win.',
      'You can’t pick the same team twice.',
      'A loss knocks you out, and the last entry standing wins.',
    ],
  },
  SQUARES: {
    summary: 'Claim squares on a 10 × 10 grid for the big game.',
    steps: [
      'Claim your squares on the grid.',
      'Once the grid is full, the numbers for each row and column are drawn.',
      'The last digit of each team’s score picks the winning square.',
    ],
  },
};
