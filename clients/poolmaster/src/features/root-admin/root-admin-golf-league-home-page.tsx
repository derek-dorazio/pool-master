import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { listParticipantLeagueAffiliations } from '@/lib/api';
import { AsyncPage } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { ParticipantLeagueAffiliationDto } from '@/lib/api';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { GolfTourDangerZone, GolfTourDetailsSection, GolfTourHeading } from './golf-league-details-section';
import { GolfLeagueRosterGridCard } from './golf-league-roster-grid-card';
import { GolfLeagueRosterUploadCard } from './golf-league-roster-upload-card';
import { GolfTourCalendarCard } from './golf-tour-calendar-card';
import { useGolfSportLeaguesQuery } from './use-golf-catalog';

/**
 * /manage/golf/leagues/:leagueId, a tour's page. Owns the tour and roster queries and the
 * layout: identity heading, details with one Edit, the tournament calendar by event year
 * (plans/147), the rankings upload, the roster grid, and the danger zone last.
 */
export function RootAdminGolfLeagueHomePage() {
  const { leagueId = '' } = useParams<{ leagueId: string }>();

  useManagePageOwnsHeading();
  useManageBreadcrumbOverride('leagues', 'Tours');

  const leaguesQuery = useGolfSportLeaguesQuery();

  const rosterQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.leagueRoster(leagueId),
    queryFn: async (): Promise<ParticipantLeagueAffiliationDto[]> => {
      const response = await listParticipantLeagueAffiliations({ path: { sportLeagueId: leagueId } });
      if (!response.data?.affiliations) {
        throwApiError(response.error, 'Golf tour roster response is missing data.');
      }
      return response.data.affiliations;
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
        <div className="space-y-8">
          <GolfTourHeading tour={league} />
          <GolfTourDetailsSection tour={league} />
          <GolfTourCalendarCard tour={league} />
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
          <GolfTourDangerZone tour={league} />
        </div>
      ) : null}
    </AsyncPage>
  );
}
