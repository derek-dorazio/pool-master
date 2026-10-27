import { Sport } from '@poolmaster/shared/domain';
import { STAT_POOL_CONTEST_TYPE } from '@/features/contests/scoring-family-ui/stat-pool-copy';

/**
 * The Clutch Card page's words (#1066), at `/play/clutch-card`: the contest type's own landing
 * page, beside the event pages. The contest type's name and each sport's formula are the app's
 * (`STAT_POOL_CONTEST_TYPE`, `STAT_POOL_FORMULAS`), so a rename or a formula change reaches here.
 */

/** One title round on the calendar, by the name of the sport league its Clutch Card is played on. */
export interface ClutchCardRound {
  /** The stat pool sport league's name; the round shows as available while that league exists. */
  sportLeague: string;
  sport: Sport;
}

/** The page's own menu, in section order: each jumps to its section. */
export const CLUTCH_CARD_SECTIONS = [
  { id: 'card-types', label: 'Card types' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'how-it-plays', label: 'How it plays' },
  { id: 'questions', label: 'Questions' },
] as const;

export type ClutchCardSectionId = (typeof CLUTCH_CARD_SECTIONS)[number]['id'];

export const CLUTCH_CARD_PAGE = {
  hero: {
    badge: 'New',
    eyebrow: 'A new kind of pool for championship games',
    /** The two lines of the headline; the second shows in gold. */
    tagline: ['The biggest stars on the biggest stage.', 'Who will come in clutch?'] as const,
    hook: 'Championship games hit different. Now your pool does too. Back the stars you trust on the biggest stage, then sweat every bucket, goal and touchdown until the trophy goes up.',
    start: `Start a ${STAT_POOL_CONTEST_TYPE} pool`,
    seeTheCards: 'See the cards',
    note: 'For your office, family or group chat. Picks take two minutes.',
  },
  howItPlays: {
    eyebrow: 'How it plays',
    title: 'One title round. A few stars. Every game counts.',
    intro: `Brackets ask who wins. A ${STAT_POOL_CONTEST_TYPE} asks who shows up. You pick players from both teams, and their stat lines are your score.`,
    steps: [
      { title: 'Pick your stars', body: 'Before the first game, choose stars from the teams still playing. Picks close at the opening tip, puck drop, pitch or kickoff.' },
      { title: 'Root for every score', body: 'Every bucket, hit, goal and catch your stars make lands on your card, live, from the first game to the last.' },
      { title: 'The best card wins', body: 'Your best stars\' points add up on a live leaderboard. When the title is decided, the top card takes the bragging rights.' },
    ],
    modes: [
      { title: 'Tiered', body: 'One star from each tier, from the headliners down to the role players.' },
      { title: 'Budget', body: 'Every star has a price. Build the best card that fits under the cap.' },
      { title: 'Quick pick', body: 'Don\'t follow every roster? The commissioner deals everyone a random card in one tap, and every card still has a shot.' },
    ],
  },
  cardTypes: {
    eyebrow: 'Card types',
    title: `Every sport has its own ${STAT_POOL_CONTEST_TYPE}`,
    intro: 'Each sport scores one fixed formula, so nobody has to learn a rulebook. Bigger games, bigger numbers.',
    /** The line under each built stat line, by sport; the name and formula are the app's. */
    lines: {
      [Sport.BASEBALL]: 'A homer with two on is a big night. So is a walk, a steal and a run.',
      [Sport.BASKETBALL]: 'The stuff of triple-doubles. Men\'s, women\'s and college.',
      [Sport.HOCKEY]: 'Skaters only. Shooters keep scoring even when the goalie stands tall.',
      [Sport.AMERICAN_FOOTBALL]: 'Passing, rushing and receiving yards all count. Pro and college.',
      [Sport.SOCCER]: 'Outfield players. For the knockout rounds of the biggest tournaments.',
    } as Readonly<Partial<Record<Sport, string>>>,
  },
  calendar: {
    eyebrow: 'Championship calendar',
    title: 'A title round almost every month',
    intro: `Each round is its own ${STAT_POOL_CONTEST_TYPE}, so a new one opens as soon as its teams are set.`,
    months: [
      { month: 'January', rounds: [
        { sportLeague: 'CFP Semifinals', sport: Sport.AMERICAN_FOOTBALL },
        { sportLeague: 'CFP National Championship', sport: Sport.AMERICAN_FOOTBALL },
        { sportLeague: 'Championship Weekend', sport: Sport.AMERICAN_FOOTBALL },
      ] },
      { month: 'February', rounds: [{ sportLeague: 'Super Bowl', sport: Sport.AMERICAN_FOOTBALL }] },
      { month: 'April', rounds: [
        { sportLeague: 'Men\'s Final Four', sport: Sport.BASKETBALL },
        { sportLeague: 'Men\'s National Championship', sport: Sport.BASKETBALL },
        { sportLeague: 'Women\'s Final Four', sport: Sport.BASKETBALL },
        { sportLeague: 'Men\'s Frozen Four', sport: Sport.HOCKEY },
        { sportLeague: 'Men\'s National Championship', sport: Sport.HOCKEY },
      ] },
      { month: 'May', rounds: [
        { sportLeague: 'NBA Conference Finals', sport: Sport.BASKETBALL },
        { sportLeague: 'NHL Conference Finals', sport: Sport.HOCKEY },
        { sportLeague: 'Champions League Semifinals', sport: Sport.SOCCER },
        { sportLeague: 'Champions League Final', sport: Sport.SOCCER },
      ] },
      { month: 'June', rounds: [
        { sportLeague: 'NBA Finals', sport: Sport.BASKETBALL },
        { sportLeague: 'Stanley Cup Final', sport: Sport.HOCKEY },
      ] },
      { month: 'July', rounds: [
        { sportLeague: 'Women\'s World Cup Semifinals', sport: Sport.SOCCER },
        { sportLeague: 'Women\'s World Cup Final', sport: Sport.SOCCER },
      ] },
      { month: 'Sept – Oct', rounds: [
        { sportLeague: 'WNBA Semifinals', sport: Sport.BASKETBALL },
        { sportLeague: 'WNBA Finals', sport: Sport.BASKETBALL },
        { sportLeague: 'League Championship Series', sport: Sport.BASEBALL },
        { sportLeague: 'World Series', sport: Sport.BASEBALL },
      ] },
    ] as readonly { month: string; rounds: readonly ClutchCardRound[] }[],
    legend: { available: 'Available now', coming: 'Coming soon' },
  },
  why: {
    eyebrow: 'Why groups love it',
    title: 'Built for the games everybody watches',
    points: [
      { title: 'Live to the last whistle', body: 'A blowout doesn\'t end your night. Your stars keep piling up points in garbage time, and the card behind you is one big quarter away.' },
      { title: 'Easy for the casual fan', body: 'With quick pick, the commissioner deals every card in one tap. Nobody needs to study a season of box scores to join in.' },
      { title: 'Deep for the diehard', body: 'Tiers and budgets reward knowing who gets the minutes, the touches and the power-play time.' },
      { title: 'A pool type you won\'t find anywhere else', body: 'Run it next to your bracket or squares. It\'s a second way into the same game, for the same group.' },
    ],
  },
  faq: {
    eyebrow: 'Questions',
    title: 'The short answers',
    items: [
      { question: 'When do picks close?', answer: 'At the start of the first game of the round. Picks stay hidden until then, so nobody copies anybody.' },
      { question: 'What if a star sits out a game?', answer: 'They score nothing for that game. That is why many setups count only your best stars, so one quiet night doesn\'t sink your card.' },
      { question: 'Does a series that ends early hurt my card?', answer: 'Everyone\'s stars play the same games, so a sweep is short for the whole group. The leaderboard settles when the title is decided.' },
      { question: 'Who can join?', answer: 'Anyone the commissioner invites. Each pool runs in your own private league, for your office, family or friends.' },
    ],
  },
  closing: { title: 'The next title round is coming. Who are your stars?' },
  footer: 'Not affiliated with any sports league.',
} as const;

/** The hero's example card: made-up positions and numbers, never a real star or team. */
export const CLUTCH_CARD_EXAMPLE = {
  name: 'NBA Finals Stars',
  status: 'Game 4 live',
  note: 'Example card.',
  sport: Sport.BASKETBALL,
  games: ['G1', 'G2', 'G3', 'G4'],
  stars: [
    { tier: 'T1', position: 'Forward', team: 'Home team', scores: [41, 36, 44, 19] },
    { tier: 'T2', position: 'Guard', team: 'Away team', scores: [33, 29, 38, 12] },
    { tier: 'T3', position: 'Center', team: 'Home team', scores: [24, 31, 18, 9] },
    { tier: 'T4', position: 'Guard', team: 'Away team', scores: [15, 22, 29, 6] },
    { tier: 'T5', position: 'Forward', team: 'Away team', scores: [8, 11, 6, 2] },
  ],
  counted: 4,
  rank: '2nd of 23 cards',
} as const;
