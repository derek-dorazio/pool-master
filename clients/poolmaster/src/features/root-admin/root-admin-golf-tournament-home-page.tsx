import { useQuery } from '@tanstack/react-query';
import { SportEventSyncScope } from '@poolmaster/shared/domain';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { getEvent, listEventRounds } from '@/lib/api';
import {
  AsyncPage,
  Callout,
  LinkButton,
  ListCard,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { SportEventDto, SportEventRoundDto } from '@/lib/api';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { GolfTournamentScoreSourceCard } from './golf-tournament-score-source-card';
import { GolfTournamentSummaryCard } from './golf-tournament-summary-card';
import { GolfTournamentWorkflowCard } from './golf-tournament-workflow-card';
import { useGolfSportLeaguesQuery } from './use-golf-catalog';

/**
 * plans/124 §6.3 — Tournament Home, the canonical page. Owns the tournament /
 * rounds / tour queries and the block layout; each of the four blocks is its
 * own component (Summary, Workflow, Score source, Sections).
 */
export function RootAdminGolfTournamentHomePage() {
  const { eventId = '' } = useParams<{ eventId: string }>();

  const tournamentQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tournament(eventId),
    queryFn: async (): Promise<SportEventDto> => {
      const response = await getEvent({ path: { eventId } });
      if (!response.data?.event) {
        throwApiError(response.error, 'Golf tournament response is missing data.');
      }
      return response.data.event;
    },
    enabled: eventId !== '',
    retry: false,
  });

  const roundsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.rounds(eventId),
    queryFn: async (): Promise<SportEventRoundDto[]> => {
      const response = await listEventRounds({ path: { eventId } });
      if (!response.data?.rounds) {
        throwApiError(response.error, 'Golf tournament rounds response is missing data.');
      }
      return response.data.rounds;
    },
    enabled: eventId !== '',
    retry: false,
  });

  const tournament = tournamentQuery.data;

  // The tour's name, from the tour list the golf screens already share.
  const toursQuery = useGolfSportLeaguesQuery();
  const tourName = toursQuery.data?.find((tour) => tour.id === tournament?.sportLeagueId)?.name;

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
                  to={`/manage/golf/tournaments/${eventId}/field`}
                  variant="secondary"
                >
                  Open Field
                </LinkButton>
              </div>
            </Callout>
          ) : null}

          <GolfTournamentSummaryCard
            eventId={eventId}
            tourName={tourName}
            tournament={tournament}
          />

          <GolfTournamentWorkflowCard
            eventId={eventId}
            rounds={rounds}
            roundsError={roundsQuery.isError ? roundsQuery.error : null}
            tournament={tournament}
          />

          <GolfTournamentScoreSourceCard eventId={eventId} tournament={tournament} />

          <div className="grid gap-4 sm:grid-cols-3">
            <ListCard
              actions={
                <LinkButton
                  data-testid="root-admin-golf-tournament-section-field"
                  to={`/manage/golf/tournaments/${eventId}/field`}
                  variant="secondary"
                >
                  Open Field
                </LinkButton>
              }
              description={`${tournament.loadedParticipantCount} golfers in the field`}
              title="Field"
            />
            <ListCard
              actions={
                <LinkButton
                  data-testid="root-admin-golf-tournament-section-tiers"
                  to={`/manage/golf/tournaments/${eventId}/tiers`}
                  variant="secondary"
                >
                  Open Tiers
                </LinkButton>
              }
              description={`${tournament.tierCount} tiers defined`}
              title="Tiers"
            />
            <ListCard
              actions={
                <LinkButton
                  data-testid="root-admin-golf-tournament-section-scores"
                  to={`/manage/golf/tournaments/${eventId}/scores`}
                  variant="secondary"
                >
                  Open Scores
                </LinkButton>
              }
              description={`${tournament.rounds ?? 0} rounds`}
              title="Round scores"
            />
          </div>
        </div>
      ) : null}
    </AsyncPage>
  );
}
