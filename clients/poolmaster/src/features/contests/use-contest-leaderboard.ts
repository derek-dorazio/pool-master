import { useQuery } from '@tanstack/react-query';
import type { ContestStatus } from '@poolmaster/shared/domain';
import {
  getBracketLeaderboard,
  getContestLeaderboard,
  getPickEmLeaderboard,
  getSurvivorLeaderboard,
  type BracketLeaderboardResponse,
  type ContestLeaderboardResponse,
  type PickEmLeaderboardResponse,
  type SurvivorLeaderboardResponse,
} from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { CONTEST_POLL_INTERVAL_MS, shouldPollContestEntries } from './contest-status';

/**
 * A contest's leaderboard (#112), polled on the contest board's cadence while the contest is
 * live, so standings move without a reload and stop at settlement. `sportEventId` picks which of
 * the contest's events its picks are shown for (#713); without it the server shows the latest
 * one whose picks are revealed.
 */
export function useContestLeaderboardQuery(
  contestId: string,
  status: ContestStatus | null | undefined,
  options: { enabled?: boolean; sportEventId?: string | null } = {},
) {
  const sportEventId = options.sportEventId ?? undefined;
  return useQuery({
    queryKey: QueryKeys.contests.leaderboard(contestId, sportEventId),
    queryFn: async (): Promise<ContestLeaderboardResponse> => {
      const response = await getContestLeaderboard({
        path: { contestId },
        query: sportEventId ? { sportEventId } : undefined,
      });

      if (!response.data) {
        throwApiError(response.error, 'Contest leaderboard response is missing data.');
      }

      return response.data;
    },
    enabled: Boolean(contestId) && (options.enabled ?? true),
    retry: false,
    refetchInterval: shouldPollContestEntries(status) ? CONTEST_POLL_INTERVAL_MS : false,
  });
}

/**
 * A bracket contest's leaderboard (#721), on the same cadence as the roster board: a bracket's
 * standings are their own read, since its entries are picks of games rather than a lineup.
 */
export function useBracketLeaderboardQuery(
  contestId: string,
  status: ContestStatus | null | undefined,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: QueryKeys.contests.bracketLeaderboard(contestId),
    queryFn: async (): Promise<BracketLeaderboardResponse> => {
      const response = await getBracketLeaderboard({ path: { contestId } });
      if (!response.data) {
        throwApiError(response.error, 'Bracket leaderboard response is missing data.');
      }
      return response.data;
    },
    enabled: Boolean(contestId) && (options.enabled ?? true),
    retry: false,
    refetchInterval: shouldPollContestEntries(status) ? CONTEST_POLL_INTERVAL_MS : false,
  });
}

/**
 * A pick'em contest's season leaderboard (#718): every week's points and places in one read, on
 * the same cadence, so a week under way moves as its games are played.
 */
export function usePickEmLeaderboardQuery(contestId: string, status: ContestStatus | null | undefined) {
  return useQuery({
    queryKey: QueryKeys.contests.pickEmLeaderboard(contestId),
    queryFn: async (): Promise<PickEmLeaderboardResponse> => {
      const response = await getPickEmLeaderboard({ path: { contestId } });
      if (!response.data) {
        throwApiError(response.error, 'Pick\'em leaderboard response is missing data.');
      }
      return response.data;
    },
    enabled: Boolean(contestId),
    retry: false,
    refetchInterval: shouldPollContestEntries(status) ? CONTEST_POLL_INTERVAL_MS : false,
  });
}

/**
 * A survivor contest's leaderboard (#719): who is still in and when each entry went out, on the
 * same cadence, so a week under way moves as its games are played.
 */
export function useSurvivorLeaderboardQuery(contestId: string, status: ContestStatus | null | undefined) {
  return useQuery({
    queryKey: QueryKeys.contests.survivorLeaderboard(contestId),
    queryFn: async (): Promise<SurvivorLeaderboardResponse> => {
      const response = await getSurvivorLeaderboard({ path: { contestId } });
      if (!response.data) {
        throwApiError(response.error, 'Survivor leaderboard response is missing data.');
      }
      return response.data;
    },
    enabled: Boolean(contestId),
    retry: false,
    refetchInterval: shouldPollContestEntries(status) ? CONTEST_POLL_INTERVAL_MS : false,
  });
}
