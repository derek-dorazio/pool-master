import { SportEventSyncScope } from '@poolmaster/shared/domain';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  AsyncPage,
  Callout,
  LinkButton,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { GolfTournamentDetailsSection } from './golf-tournament-details-section';
import { GolfTournamentHeader } from './golf-tournament-header';
import { GolfTournamentScoreSourceCard } from './golf-tournament-score-source-card';
import { GolfTournamentWorkflowCard } from './golf-tournament-workflow-card';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { buildGolfTournamentPath } from './manage-navigation';
import { useGolfSportLeaguesQuery } from './use-golf-catalog';
import { useGolfRoundsQuery, useGolfTournamentQuery } from './use-golf-tournament';

/**
 * A tournament's Overview: the shared tournament header, its details with one Edit, the
 * workflow (release, transitions, round schedule) and its score source. Field, Tiers and
 * Scores are the header's other pages.
 */
export function RootAdminGolfTournamentHomePage() {
  const { eventId = '' } = useParams<{ eventId: string }>();

  const tournamentQuery = useGolfTournamentQuery(eventId);
  const roundsQuery = useGolfRoundsQuery(eventId);

  const tournament = tournamentQuery.data;

  // The tour's name, from the tour list the golf screens already share.
  const toursQuery = useGolfSportLeaguesQuery();
  const tourName = toursQuery.data?.find((tour) => tour.id === tournament?.sportLeagueId)?.name;

  useManagePageOwnsHeading();
  useManageBreadcrumbOverride(eventId || undefined, tournament?.name);

  const rounds = useMemo(() => roundsQuery.data ?? [], [roundsQuery.data]);

  const pageState = tournamentQuery.isLoading
    ? 'loading'
    : tournamentQuery.isError
      ? 'error'
      : 'ready';

  return (
    <AsyncPage
      errorBody={extractErrorMessage(tournamentQuery.error, {
        fallback: 'We could not load this golf tournament right now.',
      })}
      loadingBody="Loading golf tournament..."
      state={pageState}
      testId="root-admin-golf-tournament-home-page"
    >
      {tournament ? (
        <div className="space-y-6">
          <GolfTournamentHeader current="overview" tournament={tournament} />

          {tournament.syncScope !== SportEventSyncScope.NONE && tournament.loadedParticipantCount === 0 ? (
            <Callout tone="info">
              <p className="font-medium">The participant field is not loaded yet</p>
              <p className="mt-1 text-sm">
                This tournament is linked to a provider event. Open Field and use Load
                Participant Field to pull the field in.
              </p>
              <div className="mt-3">
                <LinkButton
                  data-testid="root-admin-golf-tournament-home-load-field"
                  to={`${buildGolfTournamentPath(eventId)}/field`}
                  variant="secondary"
                >
                  Open Field
                </LinkButton>
              </div>
            </Callout>
          ) : null}

          <GolfTournamentDetailsSection tourName={tourName} tournament={tournament} />

          <GolfTournamentWorkflowCard
            eventId={eventId}
            rounds={rounds}
            roundsError={roundsQuery.isError ? roundsQuery.error : null}
            tournament={tournament}
          />

          <GolfTournamentScoreSourceCard eventId={eventId} tournament={tournament} />
        </div>
      ) : null}
    </AsyncPage>
  );
}
