import { useQuery } from '@tanstack/react-query';
import { ContestStatus } from '@poolmaster/shared/domain';
import { getSquaresBoard, type ContestDto, type SquaresBoardResponse } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { CONTEST_POLL_INTERVAL_MS, shouldPollContestEntries } from './contest-status';

/** The squares board read, polled while boxes are being claimed and while the game is played. */
export function useSquaresBoardQuery(contest: Pick<ContestDto, 'id' | 'status'>) {
  return useQuery({
    queryKey: QueryKeys.contests.squaresBoard(contest.id),
    queryFn: async (): Promise<SquaresBoardResponse> => {
      const response = await getSquaresBoard({ path: { contestId: contest.id } });
      if (!response.data) {
        throwApiError(response.error, 'Squares board response is missing data.');
      }
      return response.data;
    },
    retry: false,
    refetchInterval: contest.status === ContestStatus.OPEN || shouldPollContestEntries(contest.status)
      ? CONTEST_POLL_INTERVAL_MS
      : false,
  });
}
