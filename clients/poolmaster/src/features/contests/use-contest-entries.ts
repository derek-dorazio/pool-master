import { useQuery } from '@tanstack/react-query';
import {
  getContestEntry,
  listContestEntries,
  listMyContestEntries,
  type ContestEntryDetailResponse,
  type ContestEntryDto,
  type ContestEntryListResponse,
} from '@/lib/api';
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

/**
 * What an entry write can change (#1197): the contest's entries, the contest's entry counts and
 * the viewer's entry ids on the contest read, and the viewer's entries across their league.
 */
export function entryWriteKeys(contestId: string) {
  return [
    QueryKeys.contestEntries.byContest(contestId),
    QueryKeys.contests.detail(contestId),
    QueryKeys.contestEntries.allMine,
  ];
}

/** One entry with its picks, as its viewer may see them, and whether the contest's picks are revealed. */
export function useContestEntryQuery(contestId: string, entryId: string) {
  return useQuery({
    queryKey: QueryKeys.contestEntries.detail(contestId, entryId),
    queryFn: async (): Promise<ContestEntryDetailResponse> => {
      const response = await getContestEntry({ path: { contestId, entryId } });
      if (!response.data) {
        throwApiError(response.error, 'Contest entry response is missing data.');
      }
      return response.data;
    },
    enabled: Boolean(contestId && entryId),
    retry: false,
  });
}

export type MyContestEntries = {
  /** The viewer's team's entries in each of the league's open and live contests, by contest id. */
  entriesByContestId: ReadonlyMap<string, ContestEntryDto[]>;
  isError: boolean;
  isLoading: boolean;
};

/**
 * The viewer's team's entries across the league's open and live contests, in one read however
 * many there are (#1197). The server answers for the viewer's own team, never another's: `enabled`
 * only says whether to read, false for a viewer without a team, who has nothing to read.
 */
export function useMyContestEntries(leagueId: string, enabled: boolean): MyContestEntries {
  const query = useQuery({
    queryKey: QueryKeys.contestEntries.mine(leagueId),
    queryFn: async (): Promise<ContestEntryDto[]> => {
      const response = await listMyContestEntries({ path: { id: leagueId } });
      if (!response.data) {
        throwApiError(response.error, 'My contest entries response is missing data.');
      }
      return response.data.entries;
    },
    enabled: enabled && Boolean(leagueId),
    retry: false,
    select: groupByContest,
  });
  return {
    entriesByContestId: query.data ?? EMPTY,
    isError: query.isError,
    isLoading: query.isLoading,
  };
}

const EMPTY: ReadonlyMap<string, ContestEntryDto[]> = new Map();

function groupByContest(entries: ContestEntryDto[]): ReadonlyMap<string, ContestEntryDto[]> {
  const byContest = new Map<string, ContestEntryDto[]>();
  for (const entry of entries) {
    byContest.set(entry.contestId, [...(byContest.get(entry.contestId) ?? []), entry]);
  }
  return byContest;
}
