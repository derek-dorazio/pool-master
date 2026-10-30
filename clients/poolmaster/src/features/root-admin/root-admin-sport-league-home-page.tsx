import { useQuery } from '@tanstack/react-query';
import { listParticipantLeagueAffiliations } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { ParticipantLeagueAffiliationDto, SportLeagueDto } from '@/lib/api';
import { useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { SportLeagueDangerZone, SportLeagueDetailsSection, SportLeagueHeading } from './sport-league-details-section';
import { SportLeagueRosterGridCard } from './sport-league-roster-grid-card';
import { SportLeagueRosterUploadCard } from './sport-league-roster-upload-card';
import { SportLeagueCalendarCard } from './sport-league-calendar-card';
import { useSportLeagueNoun } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';
import { SportLeaguePage } from './sport-league-page';

/**
 * /manage/sports/:sport/leagues/:leagueId, a sport league's page (a golf tour, a racing circuit).
 * Owns the league and roster queries and the layout: identity heading, details with one Edit,
 * the event calendar by event year, the rankings upload, the roster grid, and the danger zone
 * last.
 */
export function RootAdminSportLeagueHomePage() {
  useManagePageOwnsHeading();

  return (
    <SportLeaguePage testId="root-admin-sport-league-home-page">
      {(sportLeague) => <SportLeagueHome sportLeague={sportLeague} />}
    </SportLeaguePage>
  );
}

function SportLeagueHome({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const { sport } = useManagedSport();
  const sportLeagueNoun = useSportLeagueNoun(sport, sportLeague.id);
  const rosterQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.leagueRoster(sportLeague.id),
    queryFn: async (): Promise<ParticipantLeagueAffiliationDto[]> => {
      const response = await listParticipantLeagueAffiliations({ path: { sportLeagueId: sportLeague.id } });
      if (!response.data?.affiliations) {
        throwApiError(response.error, 'Sport league roster response is missing data.');
      }
      return response.data.affiliations;
    },
    retry: false,
  });

  return (
    <div className="space-y-8">
      <SportLeagueHeading sportLeague={sportLeague} />
      <SportLeagueDetailsSection sportLeague={sportLeague} />
      <SportLeagueCalendarCard sportLeague={sportLeague} />
      <SportLeagueRosterUploadCard leagueId={sportLeague.id} />
      <SportLeagueRosterGridCard
        entries={rosterQuery.data ?? []}
        leagueId={sportLeague.id}
        rosterError={
          rosterQuery.isError
            ? extractErrorMessage(rosterQuery.error, {
                fallback: `We could not load this ${sportLeagueNoun.one}’s roster right now.`,
              })
            : null
        }
        rosterLoading={rosterQuery.isLoading}
      />
      <SportLeagueDangerZone sportLeague={sportLeague} />
    </div>
  );
}
