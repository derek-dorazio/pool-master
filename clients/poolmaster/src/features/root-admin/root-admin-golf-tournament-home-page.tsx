import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  adminGetGolfSeason,
  adminGetGolfTournament,
  adminGetGolfTournamentRounds,
} from '@/lib/api';
import {
  Alert,
  AsyncPage,
  Callout,
  LinkButton,
  ListCard,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminGetGolfTournamentRoundsResponses } from '@/lib/api';
import { useManageBreadcrumbOverride } from './root-admin-manage-layout';
import {
  isAdminManagedGolfTournament,
  type AdminGolfTournamentDetail,
} from './golf-admin-utils';
import { GolfTournamentScoreSourceCard } from './golf-tournament-score-source-card';
import { GolfTournamentSummaryCard } from './golf-tournament-summary-card';
import { GolfTournamentWorkflowCard } from './golf-tournament-workflow-card';

type GolfRound = AdminGetGolfTournamentRoundsResponses[200]['rounds'][number];

/**
 * plans/124 §6.3 — Tournament Home, the canonical page. Owns the tournament /
 * rounds / season queries and the block layout; each of the four blocks is its
 * own component (Summary, Workflow, Score source, Sections).
 */
export function RootAdminGolfTournamentHomePage() {
  const { eventId = '' } = useParams<{ eventId: string }>();

  const tournamentQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tournament(eventId),
    queryFn: async (): Promise<AdminGolfTournamentDetail> => {
      const response = await adminGetGolfTournament({ path: { eventId } });
      if (!response.data?.tournament) {
        throw response.error ?? new Error('Golf tournament response is missing data.');
      }
      return response.data.tournament;
    },
    enabled: eventId !== '',
    retry: false,
  });

  const roundsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.rounds(eventId),
    queryFn: async (): Promise<GolfRound[]> => {
      const response = await adminGetGolfTournamentRounds({ path: { eventId } });
      if (!response.data?.rounds) {
        throw response.error ?? new Error('Golf tournament rounds response is missing data.');
      }
      return response.data.rounds;
    },
    enabled: eventId !== '',
    retry: false,
  });

  const tournament = tournamentQuery.data;

  const seasonQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.season(tournament?.seasonId ?? null),
    queryFn: async () => {
      const response = await adminGetGolfSeason({
        path: { seasonId: tournament?.seasonId ?? '' },
      });
      if (!response.data?.season) {
        throw response.error ?? new Error('Golf season response is missing data.');
      }
      return response.data.season;
    },
    enabled: Boolean(tournament?.seasonId),
    retry: false,
  });

  useManageBreadcrumbOverride(eventId || undefined, tournament?.name);

  const rounds = useMemo(() => roundsQuery.data ?? [], [roundsQuery.data]);

  const pageState = tournamentQuery.isLoading
    ? 'loading'
    : tournamentQuery.isError
      ? 'error'
      : 'ready';

  const isReadOnly = tournament
    ? !isAdminManagedGolfTournament(tournament.syncScope)
    : false;

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
          {isReadOnly ? (
            <Alert tone="warning">
              This tournament is fully provider-owned. Setup, workflow, and score source
              are read-only here.
            </Alert>
          ) : null}

          {tournament.syncScope !== 'NONE' && tournament.fieldCount === 0 ? (
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
            readOnly={isReadOnly}
            seasonName={seasonQuery.data?.name}
            tournament={tournament}
          />

          {!isReadOnly ? (
            <GolfTournamentWorkflowCard
              eventId={eventId}
              rounds={rounds}
              roundsError={roundsQuery.isError ? roundsQuery.error : null}
              tournament={tournament}
            />
          ) : null}

          {!isReadOnly ? (
            <GolfTournamentScoreSourceCard eventId={eventId} tournament={tournament} />
          ) : null}

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
              description={`${tournament.fieldCount} golfers in the field`}
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
