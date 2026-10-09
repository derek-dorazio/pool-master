import { useQueries } from '@tanstack/react-query';
import { listContestEntries, type ContestEntryDto, type ContestEntryListResponse } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** One contest's entries, read through the key every page shares for them. */
export async function fetchContestEntries(contestId: string): Promise<ContestEntryListResponse> {
  const response = await listContestEntries({ path: { contestId } });

  if (!response.data) {
    throwApiError(response.error, 'Contest entries response is missing data.');
  }

  return response.data;
}

export type MyContestEntries = {
  /** The viewer's team's entries in each contest that has finished loading, by contest id. */
  entriesByContestId: ReadonlyMap<string, ContestEntryDto[]>;
  isError: boolean;
  isLoading: boolean;
};

/**
 * The viewer's team's entries in each of `contestIds`: each contest's entry list, filtered to
 * the team. Without a team there is nothing to read.
 */
export function useMyContestEntries(contestIds: readonly string[], squadId: string | null): MyContestEntries {
  return useQueries({
    queries: contestIds.map((contestId) => ({
      queryKey: QueryKeys.contestEntries.byContest(contestId),
      queryFn: () => fetchContestEntries(contestId),
      enabled: Boolean(squadId),
      retry: false,
    })),
    combine: (results) => {
      const entriesByContestId = new Map<string, ContestEntryDto[]>();
      results.forEach((result, index) => {
        const contestId = contestIds[index];
        if (result.data && contestId) {
          entriesByContestId.set(
            contestId,
            result.data.entries.filter((entry) => entry.squadId === squadId),
          );
        }
      });
      return {
        entriesByContestId,
        isError: results.some((result) => result.isError),
        isLoading: Boolean(squadId) && results.some((result) => result.isLoading),
      };
    },
  });
}
