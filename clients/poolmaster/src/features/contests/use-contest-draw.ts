import { useQuery } from '@tanstack/react-query';
import { getSelectionState, type SelectionStateResponse } from '@/lib/api';
import { throwApiError, type ErrorCodeMessages } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * Copy for the refusals Run draw can meet. The codes are the contract; the server's own sentences
 * are a fallback for anything not listed.
 */
export const CONTEST_DRAW_CODE_MESSAGES: ErrorCodeMessages = {
  CONTEST_DRAW_ALREADY_RUN: 'This contest has already been drawn. The draw is final.',
  CONTEST_DRAW_ENTRIES_CHANGED:
    'Someone entered or left while the draw was running, so nothing was dealt. Run the draw again.',
  CONTEST_DRAW_FIELD_TOO_SMALL:
    'The field isn’t big enough to deal every entry its share, so nothing was dealt.',
  CONTEST_DRAW_NOT_OPEN: 'The draw can only run while the contest is open for entries.',
  CONTEST_DRAW_NO_ENTRIES: 'No one has entered yet. The draw needs at least one entry to deal to.',
  CONTEST_EVENT_ALREADY_STARTED: 'The event has already started, so it’s too late to run the draw.',
  CONTEST_NOT_RANDOM_DRAW: 'This contest isn’t a random draw, so there is no draw to run.',
};

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
