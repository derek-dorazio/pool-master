import { PlanCap, PlanFeature } from '@poolmaster/shared/domain';
import type { LeaguePlanUsageResponse, OpenContestUsageDto } from '@/lib/api';
import type { ComparedPlan } from './plan-comparison';

/** How many open contests a warning names before "and N more" (#972). */
export const NAMED_CONTEST_LIMIT = 3;

/** What a move to another plan would stop or hide, worked out before the commissioner confirms. */
export interface PlanChangeEffects {
  /** Open contests holding more entries than the plan takes, fullest first. */
  contestsOverEntries: OpenContestUsageDto[];
  /** The plan's entries per contest, when some open contest is over it. */
  entriesLimit: number | null;
  /** This year's sports leagues, when the league already uses more than the plan allows. */
  sportLeaguesOver: { used: number; limit: number } | null;
  /** Features the league has now and the plan lacks: hidden, never deleted, on that plan. */
  hiddenFeatures: PlanFeature[];
}

/**
 * What moving from `current` to `target` would do to this league (#972), from the plans' caps
 * and features and what the league uses now, never from the plans' names. A higher plan stops
 * and hides nothing, so this reads empty for it.
 */
export function buildPlanChangeEffects(
  current: ComparedPlan,
  target: ComparedPlan,
  usage: LeaguePlanUsageResponse,
): PlanChangeEffects {
  const entriesLimit = target.caps[PlanCap.ENTRIES_PER_CONTEST];
  const contestsOverEntries = entriesLimit === null
    ? []
    : usage.openContests
      .filter((contest) => contest.entryCount > entriesLimit)
      .sort((left, right) => right.entryCount - left.entryCount);
  const sportLeaguesLimit = target.caps[PlanCap.SPORTS_LEAGUES_PER_YEAR];
  const sportLeaguesUsed = usage.sportLeagueIds.length;
  return {
    contestsOverEntries,
    entriesLimit: contestsOverEntries.length ? entriesLimit : null,
    sportLeaguesOver: sportLeaguesLimit !== null && sportLeaguesUsed > sportLeaguesLimit
      ? { used: sportLeaguesUsed, limit: sportLeaguesLimit }
      : null,
    hiddenFeatures: Object.values(PlanFeature)
      .filter((feature) => current.features.includes(feature) && !target.features.includes(feature)),
  };
}

/** The most a league uses of each cap now: this year's sports leagues, and its fullest open contest. */
export function buildCapUsage(usage: LeaguePlanUsageResponse): Readonly<Record<PlanCap, number>> {
  return {
    [PlanCap.ENTRIES_PER_CONTEST]: Math.max(0, ...usage.openContests.map((contest) => contest.entryCount)),
    [PlanCap.SPORTS_LEAGUES_PER_YEAR]: usage.sportLeagueIds.length,
  };
}
