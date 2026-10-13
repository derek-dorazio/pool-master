import { SportEventSyncScope } from '@poolmaster/shared/domain';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  AsyncPage,
  Callout,
  LinkButton,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { SportEventDetailsSection } from './sport-event-details-section';
import { SportEventHeader } from './sport-event-header';
import { SportEventScoreSourceCard } from './sport-event-score-source-card';
import { SportEventWorkflowCard } from './sport-event-workflow-card';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { buildSportEventPath } from './manage-navigation';
import { useSportLeaguesQuery } from './use-sport-catalog';
import { useSportEventRoundsQuery, useSportEventQuery } from './use-sport-event';
import { useManagedSport } from './use-managed-sport';

/**
 * An event's Overview, in any sport: the shared event header, its details with one Edit, the
 * workflow (release, transitions, round schedule) and its score source. Field, Tiers and
 * the results page are the header's other pages.
 */
export function RootAdminSportEventHomePage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const { sport, definition } = useManagedSport();
  const eventNoun = definition.vocabulary.event.one;

  const tournamentQuery = useSportEventQuery(eventId);
  const roundsQuery = useSportEventRoundsQuery(eventId);

  const tournament = tournamentQuery.data;

  // The sport league's name, from the list the sport's screens already share.
  const toursQuery = useSportLeaguesQuery(sport);
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
        fallback: `We could not load this ${eventNoun} right now.`,
      })}
      loadingBody={`Loading ${eventNoun}...`}
      state={pageState}
      testId="root-admin-sport-event-home-page"
    >
      {tournament ? (
        <div className="space-y-6">
          <SportEventHeader current="overview" tournament={tournament} />

          {tournament.syncScope !== SportEventSyncScope.NONE && tournament.loadedParticipantCount === 0 ? (
            <Callout tone="info">
              <p className="font-medium">The participant field is not loaded yet</p>
              <p className="mt-1 text-sm">
                {`This ${eventNoun} is linked to a provider event. Open Field and use Load Participant Field to pull the field in.`}
              </p>
              <div className="mt-3">
                <LinkButton
                  data-testid="root-admin-sport-event-home-load-field"
                  to={`${buildSportEventPath(tournament.sport, eventId)}/field`}
                  variant="secondary"
                >
                  Open Field
                </LinkButton>
              </div>
            </Callout>
          ) : null}

          <SportEventDetailsSection tourName={tourName} tournament={tournament} />

          <SportEventWorkflowCard
            eventId={eventId}
            rounds={rounds}
            roundsError={roundsQuery.isError ? roundsQuery.error : null}
            tournament={tournament}
          />

          <SportEventScoreSourceCard eventId={eventId} tournament={tournament} />
        </div>
      ) : null}
    </AsyncPage>
  );
}
