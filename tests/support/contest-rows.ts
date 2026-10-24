import type { ContestCreate, ContestRepository } from '@poolmaster/shared/db';
import type { Contest } from '@poolmaster/shared/domain';

/**
 * A contest written with no plan limit on its season's sports leagues (#947), for fixtures whose
 * subject is not the plan.
 */
export async function createContestRow(contests: Pick<ContestRepository, 'create'>, contest: ContestCreate): Promise<Contest> {
  const result = await contests.create(contest, { sportLeaguesPerYear: null });
  if (result.status !== 'created') throw new Error(`seed: contest refused (${result.status})`);
  return result.contest;
}
