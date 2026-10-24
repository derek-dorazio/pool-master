import { SportStat } from '@poolmaster/shared/domain';

/**
 * How screens name each stat a composite counts (#935): a column heading short enough for a box
 * score, and the stat in words for a field label. The admin stat grid and the stat pool
 * leaderboard read the same names.
 */
export const SPORT_STAT_LABELS: Readonly<Record<SportStat, { short: string; long: string }>> = {
  [SportStat.TOTAL_BASES]: { short: 'TB', long: 'Total bases' },
  [SportStat.RUNS]: { short: 'R', long: 'Runs' },
  [SportStat.RUNS_BATTED_IN]: { short: 'RBI', long: 'Runs batted in' },
  [SportStat.WALKS]: { short: 'BB', long: 'Walks' },
  [SportStat.STOLEN_BASES]: { short: 'SB', long: 'Stolen bases' },
  [SportStat.POINTS]: { short: 'PTS', long: 'Points' },
  [SportStat.REBOUNDS]: { short: 'REB', long: 'Rebounds' },
  [SportStat.ASSISTS]: { short: 'AST', long: 'Assists' },
  [SportStat.GOALS]: { short: 'G', long: 'Goals' },
  [SportStat.SHOTS_ON_GOAL]: { short: 'SOG', long: 'Shots on goal' },
  [SportStat.PASSING_TOUCHDOWNS]: { short: 'Pass TD', long: 'Passing touchdowns' },
  [SportStat.RUSHING_TOUCHDOWNS]: { short: 'Rush TD', long: 'Rushing touchdowns' },
  [SportStat.RECEIVING_TOUCHDOWNS]: { short: 'Rec TD', long: 'Receiving touchdowns' },
  [SportStat.RECEPTIONS]: { short: 'Rec', long: 'Receptions' },
  [SportStat.PASSING_YARDS]: { short: 'Pass Yds', long: 'Passing yards' },
  [SportStat.RUSHING_YARDS]: { short: 'Rush Yds', long: 'Rushing yards' },
  [SportStat.RECEIVING_YARDS]: { short: 'Rec Yds', long: 'Receiving yards' },
};
