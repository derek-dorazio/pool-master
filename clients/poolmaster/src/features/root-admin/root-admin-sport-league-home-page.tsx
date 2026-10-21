import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { listParticipantLeagueAffiliations } from '@/lib/api';
import { AsyncPage } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { ParticipantLeagueAffiliationDto } from '@/lib/api';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { SportLeagueDangerZone, SportLeagueDetailsSection, SportLeagueHeading } from './sport-league-details-section';
import { SportLeagueRosterGridCard } from './sport-league-roster-grid-card';
import { SportLeagueRosterUploadCard } from './sport-league-roster-upload-card';
import { SportLeagueCalendarCard } from './sport-league-calendar-card';
import { capitalize } from './manage-navigation';
import { useSportLeagueNoun, useSportLeaguesQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';

/**
 * /manage/sports/:sport/leagues/:leagueId, a sport league's page (a golf tour, a racing circuit).
 * Owns the league and roster queries and the layout: identity heading, details with one Edit,
 * the event calendar by event year, the rankings upload, the roster grid, and the danger zone
 * last.
 */
export function RootAdminSportLeagueHomePage() {
  const { leagueId = '' } = useParams<{ leagueId: string }>();
  const { sport } = useManagedSport();
  const sportLeagueNoun = useSportLeagueNoun(sport, leagueId);

  useManagePageOwnsHeading();

  const leaguesQuery = useSportLeaguesQuery(sport);

  const rosterQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.leagueRoster(leagueId),
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
      emptyBody={`This ${sportLeagueNoun.one} does not exist or has been removed.`}
      emptyTitle={`${capitalize(sportLeagueNoun.one)} not found`}
      errorBody={extractErrorMessage(leaguesQuery.error, {
        fallback: `We could not load this ${sportLeagueNoun.one} right now.`,
      })}
      loadingBody={`Loading ${sportLeagueNoun.one}...`}
      state={pageState}
      testId="root-admin-sport-league-home-page"
    >
      {league ? (
        <div className="space-y-8">
          <SportLeagueHeading sportLeague={league} />
          <SportLeagueDetailsSection sportLeague={league} />
          <SportLeagueCalendarCard sportLeague={league} />
          <SportLeagueRosterUploadCard leagueId={league.id} />
          <SportLeagueRosterGridCard
            entries={rosterQuery.data ?? []}
            leagueId={league.id}
            rosterError={
              rosterQuery.isError
                ? extractErrorMessage(rosterQuery.error, {
                    fallback: `We could not load this ${sportLeagueNoun.one}’s roster right now.`,
                  })
                : null
            }
            rosterLoading={rosterQuery.isLoading}
          />
          <SportLeagueDangerZone sportLeague={league} />
        </div>
      ) : null}
    </AsyncPage>
  );
}
