import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getContest, type ContestDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { contestRefetchInterval, refreshOnContestStatusChange } from './contest-status';

async function fetchContest(contestId: string): Promise<ContestDto> {
  const response = await getContest({ path: { contestId } });

  if (!response.data?.contest) {
    throwApiError(response.error, 'Contest detail response is missing data.');
  }

  return response.data.contest;
}

/** One contest by id (#1161), as the single-contest read returns it. */
export function useContestQuery(contestId: string) {
  return useQuery({
    queryKey: QueryKeys.contests.detail(contestId),
    queryFn: () => fetchContest(contestId),
    enabled: Boolean(contestId),
    retry: false,
  });
}

/**
 * One contest by id, read again until it is final (#362), for a page that shows a live read
 * under it. When the contest's status changes, `dependentKey` names that read, which is then
 * read again at once: its own poll starts at go-live and reads the final standings at settlement.
 */
export function useLiveContestQuery(contestId: string, dependentKey: (contest: ContestDto) => QueryKey) {
  const queryClient = useQueryClient();
  const contestKey = QueryKeys.contests.detail(contestId);
  return useQuery({
    queryKey: contestKey,
    queryFn: async () => {
      const contest = await fetchContest(contestId);
      refreshOnContestStatusChange(queryClient, contestKey, contest.status, dependentKey(contest));
      return contest;
    },
    enabled: Boolean(contestId),
    retry: false,
    refetchInterval: (query) => contestRefetchInterval(query.state.data?.status),
  });
}
