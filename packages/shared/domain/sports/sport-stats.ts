/**
 * The component stats a sport's composite is made of (#934), one shared enum across the sports
 * that have one, so a stat line's key is one Postgres enum. Each sport's composite names the
 * stats it counts (`SportComposite.stats`).
 */
export const SportStat = {
  // Baseball: Box Score.
  TOTAL_BASES: 'TOTAL_BASES',
  RUNS: 'RUNS',
  RUNS_BATTED_IN: 'RUNS_BATTED_IN',
  WALKS: 'WALKS',
  STOLEN_BASES: 'STOLEN_BASES',
  // Basketball: Triple Threat.
  POINTS: 'POINTS',
  REBOUNDS: 'REBOUNDS',
  /** Basketball's and hockey's: a pass that set up a score. */
  ASSISTS: 'ASSISTS',
  // Hockey: Power Play.
  GOALS: 'GOALS',
  SHOTS_ON_GOAL: 'SHOTS_ON_GOAL',
  // American football: Redzone.
  PASSING_TOUCHDOWNS: 'PASSING_TOUCHDOWNS',
  RUSHING_TOUCHDOWNS: 'RUSHING_TOUCHDOWNS',
  RECEIVING_TOUCHDOWNS: 'RECEIVING_TOUCHDOWNS',
  RECEPTIONS: 'RECEPTIONS',
  PASSING_YARDS: 'PASSING_YARDS',
  RUSHING_YARDS: 'RUSHING_YARDS',
  RECEIVING_YARDS: 'RECEIVING_YARDS',
} as const;
export type SportStat = (typeof SportStat)[keyof typeof SportStat];

/** The largest count of one stat a stat line stores for one game, and, for yards, the most lost. */
export const SPORT_STAT_VALUE_MAX = 9999;

/**
 * The stats a player can end a game below zero in: yards, which a run for a loss, a catch
 * behind the line or a pass lost to sacks takes away. Every other stat is a count.
 */
const SIGNED_SPORT_STATS: ReadonlySet<SportStat> = new Set([SportStat.PASSING_YARDS, SportStat.RUSHING_YARDS, SportStat.RECEIVING_YARDS]);

/** The lowest value a stat line stores for the stat in one game: 0 for a count. */
export function sportStatValueMin(stat: SportStat): number {
  return SIGNED_SPORT_STATS.has(stat) ? -SPORT_STAT_VALUE_MAX : 0;
}

/** One player's stats in one game, by stat. A stat with no value counts 0. */
export type StatLine<Stat extends SportStat = SportStat> = Readonly<Partial<Record<Stat, number>>>;

/**
 * A sport's one named composite score (#932, `plans/championship-stat-pools.md` §2): a fixed
 * formula of whole-number stats, so a player scores one whole number a game. Nobody configures
 * it; every stat pool in the sport scores by it.
 */
export interface SportComposite<Stat extends SportStat = SportStat> {
  /** The composite's name as screens say it: "Box Score". */
  name: string;
  /** The stats it counts, in the order a box score lists them. */
  stats: readonly [Stat, ...Stat[]];
  /** How many games an event of the sport's stat pool is scheduled for: 7 for a best-of-seven series. */
  defaultGames: number;
  /** One game's composite from the player's line for it. */
  score(line: StatLine<Stat>): number;
}

/** A stat's value on a line, 0 when the line has none. */
export function statValue<Stat extends SportStat>(line: StatLine<Stat>, stat: Stat): number {
  return line[stat] ?? 0;
}
