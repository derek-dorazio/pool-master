import { SportStat } from '@poolmaster/shared/domain';

/**
 * How screens name each stat a composite counts (#935): a column heading short enough for a box
 * score, the stat in words for a field label, and the unit after a number in a player's stat
 * line ("15 pts · 6 reb", #1747), one and many. The admin stat grid and the stat pool
 * leaderboard read the same names.
 */
export const SPORT_STAT_LABELS: Readonly<Record<SportStat, { short: string; long: string; unit: { one: string; many: string } }>> = {
  [SportStat.TOTAL_BASES]: { short: 'TB', long: 'Total bases', unit: { one: 'TB', many: 'TB' } },
  [SportStat.RUNS]: { short: 'R', long: 'Runs', unit: { one: 'run', many: 'runs' } },
  [SportStat.RUNS_BATTED_IN]: { short: 'RBI', long: 'Runs batted in', unit: { one: 'RBI', many: 'RBI' } },
  [SportStat.WALKS]: { short: 'BB', long: 'Walks', unit: { one: 'walk', many: 'walks' } },
  [SportStat.STOLEN_BASES]: { short: 'SB', long: 'Stolen bases', unit: { one: 'steal', many: 'steals' } },
  [SportStat.POINTS]: { short: 'PTS', long: 'Points', unit: { one: 'pt', many: 'pts' } },
  [SportStat.REBOUNDS]: { short: 'REB', long: 'Rebounds', unit: { one: 'reb', many: 'reb' } },
  [SportStat.ASSISTS]: { short: 'AST', long: 'Assists', unit: { one: 'ast', many: 'ast' } },
  [SportStat.GOALS]: { short: 'G', long: 'Goals', unit: { one: 'goal', many: 'goals' } },
  [SportStat.SHOTS_ON_GOAL]: { short: 'SOG', long: 'Shots on goal', unit: { one: 'shot on goal', many: 'shots on goal' } },
  [SportStat.SHOTS_ON_TARGET]: { short: 'SOT', long: 'Shots on target', unit: { one: 'shot on target', many: 'shots on target' } },
  [SportStat.PASSING_TOUCHDOWNS]: { short: 'Pass TD', long: 'Passing touchdowns', unit: { one: 'pass TD', many: 'pass TD' } },
  [SportStat.RUSHING_TOUCHDOWNS]: { short: 'Rush TD', long: 'Rushing touchdowns', unit: { one: 'rush TD', many: 'rush TD' } },
  [SportStat.RECEIVING_TOUCHDOWNS]: { short: 'Rec TD', long: 'Receiving touchdowns', unit: { one: 'rec TD', many: 'rec TD' } },
  [SportStat.RECEPTIONS]: { short: 'Rec', long: 'Receptions', unit: { one: 'rec', many: 'rec' } },
  [SportStat.PASSING_YARDS]: { short: 'Pass Yds', long: 'Passing yards', unit: { one: 'pass yd', many: 'pass yds' } },
  [SportStat.RUSHING_YARDS]: { short: 'Rush Yds', long: 'Rushing yards', unit: { one: 'rush yd', many: 'rush yds' } },
  [SportStat.RECEIVING_YARDS]: { short: 'Rec Yds', long: 'Receiving yards', unit: { one: 'rec yd', many: 'rec yds' } },
};
