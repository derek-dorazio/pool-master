import type { ReactNode } from "react";
import { ErrorState, LinkButton, LoadingState } from "@/features/shared/ui";
import { getLeagueLoadErrorCopy } from "./league-load-error";

/**
 * #202 — generic over the query's DATA rather than over a league.
 *
 * It was `TLeague`, and its payload field was `league`, which stopped being true when the
 * league-context call started returning the league together with the viewer's edges. What this
 * hook actually does is resolve a query into "ready" or "show this blocking element"; which
 * entity it carries is the caller's business.
 */
type LeagueContextQuery<TData> = {
  data?: TData | null;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
};

type LeagueContextGuardOptions = {
  loadingBody?: ReactNode;
};

type LeagueContextGuardResult<TData> =
  | {
      element: null;
      data: TData;
      state: "ready";
    }
  | {
      element: ReactNode;
      data: null;
      state: "blocked";
    };

export function useLeagueContextGuard<TData>(
  query: LeagueContextQuery<TData>,
  options: LeagueContextGuardOptions = {},
): LeagueContextGuardResult<TData> {
  if (query.isLoading) {
    return {
      element: <LoadingState body={options.loadingBody ?? "Loading league..."} />,
      data: null,
      state: "blocked",
    };
  }

  if (query.isError || !query.data) {
    const copy = getLeagueLoadErrorCopy(query.error);

    return {
      element: (
        <ErrorState
          action={(
            <LinkButton to="/welcome" variant="subtle">
              Back to welcome
            </LinkButton>
          )}
          body={copy.body}
          title={copy.title}
        />
      ),
      data: null,
      state: "blocked",
    };
  }

  return {
    element: null,
    data: query.data,
    state: "ready",
  };
}
