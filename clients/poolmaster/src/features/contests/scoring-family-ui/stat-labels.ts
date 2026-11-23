import { SportStat } from '@poolmaster/shared/domain';
import { displayString, type DisplayStringKey } from '@poolmaster/shared/display-strings';

/**
 * The display-string key of each stat's count with its unit (#1958): "1 run", "15 pts". A
 * `Record` over the stats, so a new stat without its unit fails the type check.
 */
const SPORT_STAT_UNIT_KEYS: Readonly<Record<SportStat, Extract<DisplayStringKey, `word.statUnit${string}`>>> = {
  [SportStat.TOTAL_BASES]: 'word.statUnitTotalBases',
  [SportStat.RUNS]: 'word.statUnitRuns',
  [SportStat.RUNS_BATTED_IN]: 'word.statUnitRunsBattedIn',
  [SportStat.WALKS]: 'word.statUnitWalks',
  [SportStat.STOLEN_BASES]: 'word.statUnitStolenBases',
  [SportStat.POINTS]: 'word.statUnitPoints',
  [SportStat.REBOUNDS]: 'word.statUnitRebounds',
  [SportStat.ASSISTS]: 'word.statUnitAssists',
  [SportStat.GOALS]: 'word.statUnitGoals',
  [SportStat.SHOTS_ON_GOAL]: 'word.statUnitShotsOnGoal',
  [SportStat.SHOTS_ON_TARGET]: 'word.statUnitShotsOnTarget',
  [SportStat.PASSING_TOUCHDOWNS]: 'word.statUnitPassingTouchdowns',
  [SportStat.RUSHING_TOUCHDOWNS]: 'word.statUnitRushingTouchdowns',
  [SportStat.RECEIVING_TOUCHDOWNS]: 'word.statUnitReceivingTouchdowns',
  [SportStat.RECEPTIONS]: 'word.statUnitReceptions',
  [SportStat.PASSING_YARDS]: 'word.statUnitPassingYards',
  [SportStat.RUSHING_YARDS]: 'word.statUnitRushingYards',
  [SportStat.RECEIVING_YARDS]: 'word.statUnitReceivingYards',
};

/** A stat's count with its unit, as a player's stat line shows it (#1747): "15 pts", "1 run". */
export function formatSportStatCount(stat: SportStat, value: number): string {
  return displayString(SPORT_STAT_UNIT_KEYS[stat], { count: value });
}
