import type { ReactNode } from "react";
import { ErrorState, LinkButton, LoadingState } from "@/features/shared/ui";
import { getLeagueLoadErrorCopy } from "./league-load-error";

type LeagueContextQuery<TLeague> = {
  data?: TLeague | null;
  error: unknown;
  isError: boolean;
  isLoading: boolean;
};

type LeagueContextGuardOptions = {
  loadingBody?: ReactNode;
};

type LeagueContextGuardResult<TLeague> =
  | {
      element: null;
      league: TLeague;
      state: "ready";
    }
  | {
      element: ReactNode;
      league: null;
      state: "blocked";
    };

export function useLeagueContextGuard<TLeague>(
  query: LeagueContextQuery<TLeague>,
  options: LeagueContextGuardOptions = {},
): LeagueContextGuardResult<TLeague> {
  if (query.isLoading) {
    return {
      element: <LoadingState body={options.loadingBody ?? "Loading league..."} />,
      league: null,
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
      league: null,
      state: "blocked",
    };
  }

  return {
    element: null,
    league: query.data,
    state: "ready",
  };
}
