import { useQuery } from '@tanstack/react-query';
import { getContest, type ContestDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** One contest by id (#1161), as the single-contest read returns it. */
export function useContestQuery(contestId: string) {
  return useQuery({
    queryKey: QueryKeys.contests.detail(contestId),
    queryFn: async (): Promise<ContestDto> => {
      const response = await getContest({ path: { contestId } });

      if (!response.data?.contest) {
        throwApiError(response.error, 'Contest detail response is missing data.');
      }

      return response.data.contest;
    },
    enabled: Boolean(contestId),
    retry: false,
  });
}
