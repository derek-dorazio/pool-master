import { PlanCap, PlanFeature } from '@poolmaster/shared/domain';
import type { LeaguePlanUsageResponse, OpenContestUsageDto, YearSportLeagueUsageDto } from '@/lib/api';
import type { ComparedPlan } from './plan-comparison';

/** How many open contests a warning names before "and N more" (#972). */
export const NAMED_CONTEST_LIMIT = 3;

/** What a move to another plan would stop or hide, worked out before the commissioner confirms. */
export interface PlanChangeEffects {
  /** Open contests holding more entries than the plan takes, fullest first. */
  contestsOverEntries: OpenContestUsageDto[];
  /** The plan's entries per contest, when some open contest is over it. */
  entriesLimit: number | null;
  /** The open championship year using the most sports leagues, when it already uses more than the plan allows. */
  sportLeaguesOver: { championshipYear: number; sportLeagueIds: readonly string[]; limit: number } | null;
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
  const busiest = busiestYear(usage);
  return {
    contestsOverEntries,
    entriesLimit: contestsOverEntries.length ? entriesLimit : null,
    sportLeaguesOver: sportLeaguesLimit !== null && busiest !== null && busiest.sportLeagueIds.length > sportLeaguesLimit
      ? { championshipYear: busiest.championshipYear, sportLeagueIds: busiest.sportLeagueIds, limit: sportLeaguesLimit }
      : null,
    hiddenFeatures: Object.values(PlanFeature)
      .filter((feature) => current.features.includes(feature) && !target.features.includes(feature)),
  };
}

/**
 * The most a league uses of each cap now: the sports leagues of its busiest open championship
 * year, and its fullest open contest.
 */
export function buildCapUsage(usage: LeaguePlanUsageResponse): Readonly<Record<PlanCap, number>> {
  return {
    [PlanCap.ENTRIES_PER_CONTEST]: Math.max(0, ...usage.openContests.map((contest) => contest.entryCount)),
    [PlanCap.SPORTS_LEAGUES_PER_YEAR]: busiestYear(usage)?.sportLeagueIds.length ?? 0,
  };
}

/** The open championship year whose contests use the most sports leagues; the earlier on a tie. */
function busiestYear(usage: LeaguePlanUsageResponse): YearSportLeagueUsageDto | null {
  return usage.years.reduce<YearSportLeagueUsageDto | null>(
    (busiest, year) => (busiest === null || year.sportLeagueIds.length > busiest.sportLeagueIds.length ? year : busiest),
    null,
  );
}
