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
import { capitalize } from './manage-navigation';
import { useGolfSportLeaguesQuery } from './use-golf-catalog';
import { useManagedSport } from './use-managed-sport';

/**
 * /manage/sports/:sport/leagues/:leagueId, a sport league's page (a golf tour, a racing circuit).
 * Owns the league and roster queries and the layout: identity heading, details with one Edit,
 * the event calendar by event year, the rankings upload, the roster grid, and the danger zone
 * last.
 */
export function RootAdminGolfLeagueHomePage() {
  const { leagueId = '' } = useParams<{ leagueId: string }>();
  const { sport, definition } = useManagedSport();
  const { sportLeague } = definition.vocabulary;

  useManagePageOwnsHeading();

  const leaguesQuery = useGolfSportLeaguesQuery(sport);

  const rosterQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.leagueRoster(leagueId),
    queryFn: async (): Promise<ParticipantLeagueAffiliationDto[]> => {
      const response = await listParticipantLeagueAffiliations({ path: { sportLeagueId: leagueId } });
      if (!response.data?.affiliations) {
        throwApiError(response.error, 'Sport league roster response is missing data.');
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
      emptyBody={`This ${sportLeague.one} does not exist or has been removed.`}
      emptyTitle={`${capitalize(sportLeague.one)} not found`}
      errorBody={extractErrorMessage(leaguesQuery.error, {
        fallback: `We could not load this ${sportLeague.one} right now.`,
      })}
      loadingBody={`Loading ${sportLeague.one}...`}
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
                    fallback: `We could not load this ${sportLeague.one}’s roster right now.`,
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
