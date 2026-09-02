import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { adminGetGolfLeagueRoster, adminListGolfLeagues } from '@/lib/api';
import { AsyncPage } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type {
  AdminGetGolfLeagueRosterResponses,
  AdminListGolfLeaguesResponses,
} from '@/lib/api';
import { useManageBreadcrumbOverride } from './root-admin-manage-layout';
import { GolfLeagueDetailsCard } from './golf-league-details-card';
import { GolfLeagueRosterGridCard } from './golf-league-roster-grid-card';
import { GolfLeagueRosterUploadCard } from './golf-league-roster-upload-card';

type GolfLeague = AdminListGolfLeaguesResponses[200]['leagues'][number];
export type GolfLeagueRosterEntry =
  AdminGetGolfLeagueRosterResponses[200]['entries'][number];

/**
 * plans/124 §6.3 — /manage/golf/leagues/:leagueId "Tour Home". Owns the tour +
 * roster queries and the block layout; details editing, the roster grid, and the
 * bulk-upload flow are each their own card (the page would otherwise cross the
 * 400-line / 5-mutation decomposition threshold).
 */
export function RootAdminGolfLeagueHomePage() {
  const { leagueId = '' } = useParams<{ leagueId: string }>();

  useManageBreadcrumbOverride('leagues', 'Tours');

  const leaguesQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tours,
    queryFn: async (): Promise<GolfLeague[]> => {
      const response = await adminListGolfLeagues();
      if (!response.data?.leagues) {
        throw response.error ?? new Error('Golf tour list response is missing data.');
      }
      return response.data.leagues;
    },
    retry: false,
  });

  const rosterQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.leagueRoster(leagueId),
    queryFn: async (): Promise<GolfLeagueRosterEntry[]> => {
      const response = await adminGetGolfLeagueRoster({ path: { leagueId } });
      if (!response.data?.entries) {
        throw response.error ?? new Error('Golf tour roster response is missing data.');
      }
      return response.data.entries;
    },
    enabled: leagueId !== '',
    retry: false,
  });

  const league = useMemo(
    () => leaguesQuery.data?.find((candidate) => candidate.id === leagueId),
    [leaguesQuery.data, leagueId],
  );

  useManageBreadcrumbOverride(leagueId || undefined, league?.name);

  const pageState = leaguesQuery.isLoading
    ? 'loading'
    : leaguesQuery.isError
      ? 'error'
      : !league
        ? 'empty'
        : 'ready';

  return (
    <AsyncPage
      emptyBody="This golf tour does not exist or has been removed."
      emptyTitle="Tour not found"
      errorBody={extractErrorMessage(leaguesQuery.error, {
        fallback: 'We could not load this golf tour right now.',
      })}
      loadingBody="Loading golf tour..."
      state={pageState}
      testId="root-admin-golf-league-home-page"
    >
      {league ? (
        <div className="space-y-6">
          <GolfLeagueDetailsCard league={league} />
          <GolfLeagueRosterUploadCard leagueId={league.id} />
          <GolfLeagueRosterGridCard
            entries={rosterQuery.data ?? []}
            leagueId={league.id}
            rosterError={
              rosterQuery.isError
                ? extractErrorMessage(rosterQuery.error, {
                    fallback: 'We could not load this tour’s roster right now.',
                  })
                : null
            }
            rosterLoading={rosterQuery.isLoading}
          />
        </div>
      ) : null}
    </AsyncPage>
  );
}
