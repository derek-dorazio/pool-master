import { SportEventSyncScope } from '@poolmaster/shared/domain';
import { useMemo } from 'react';
import { useParams } from 'react-router';
import {
  Notice,
  QueryState,
  LinkButton,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { SportEventDetailsSection } from './sport-event-details-section';
import { SportEventHeader } from './sport-event-header';
import { SportEventScoreSourceCard } from './sport-event-score-source-card';
import { SportEventWorkflowCard } from './sport-event-workflow-card';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
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
  const sportLeaguesQuery = useSportLeaguesQuery(sport);
  // poolmaster-allow-list-lookup: sport leagues are reference data, a few dozen rows that do not grow with history
  const sportLeagueName = sportLeaguesQuery.data?.find((sportLeague) => sportLeague.id === tournament?.sportLeagueId)?.name;

  useManageBreadcrumbOverride(eventId || undefined, tournament?.name);

  const rounds = useMemo(() => roundsQuery.data ?? [], [roundsQuery.data]);

  return (
    <section data-testid="root-admin-sport-event-home-page">
      <QueryState
        error={extractErrorMessage(tournamentQuery.error, {
          fallback: `We could not load this ${eventNoun} right now.`,
        })}
        loading={`Loading ${eventNoun}...`}
        query={tournamentQuery}
        size="tile"
        testId="root-admin-sport-event-home"
      >
        {(tournament) => (
        <div className="space-y-6">
          <SportEventHeader current="overview" tournament={tournament} />

          {tournament.syncScope !== SportEventSyncScope.NONE && tournament.loadedParticipantCount === 0 ? (
            <Notice
              action={(
                <LinkButton
                  data-testid="root-admin-sport-event-home-load-field"
                  size="sm"
                  to={`${buildSportEventPath(tournament.sport, eventId)}/field`}
                  variant="secondary"
                >
                  Open Field
                </LinkButton>
              )}
              data-testid="root-admin-sport-event-home-field-missing"
              tone="info"
            >
              Field not loaded
            </Notice>
          ) : null}

          <SportEventDetailsSection sportLeagueName={sportLeagueName} tournament={tournament} />

          <SportEventWorkflowCard
            eventId={eventId}
            rounds={rounds}
            roundsError={roundsQuery.isError ? roundsQuery.error : null}
            tournament={tournament}
          />

          <SportEventScoreSourceCard eventId={eventId} tournament={tournament} />
        </div>
        )}
      </QueryState>
    </section>
  );
}
