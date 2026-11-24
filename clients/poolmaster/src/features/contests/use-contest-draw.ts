import { useQuery } from '@tanstack/react-query';
import { getSelectionState, type SelectionStateResponse } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * The contest's room as anyone in the league sees it, read for the draw: whether it has run
 * (`drawnAt`) and how many golfers it deals each entry (`rosterSize`). No entry is named, so the
 * commissioner need not have one.
 */
export function useContestDrawState(contestId: string) {
  return useQuery({
    queryKey: QueryKeys.selectionStates.detail(contestId, null),
    queryFn: async (): Promise<SelectionStateResponse> => {
      const response = await getSelectionState({ path: { contestId } });
      if (!response.data) {
        throwApiError(response.error, 'Selection state response is missing data.');
      }
      return response.data;
    },
    enabled: Boolean(contestId),
    retry: false,
  });
}
