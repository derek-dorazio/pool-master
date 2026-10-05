import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listEventRounds } from '@/lib/api';
import {
  Alert,
  AsyncPage,
  LinkButton,
  SegmentedControl,
  formatDateDisplay,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { SportEventRoundDto } from '@/lib/api';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import {
  golfRoundScoreRows,
  golfTournamentHasScoreSync,
  isAdminManagedGolfTournament,
} from './golf-admin-utils';
import { GolfRoundScoreCorrectionsCard } from './golf-round-score-corrections-card';
import { GolfRoundScoreUploadCard } from './golf-round-score-upload-card';
import { useGolfFieldQuery, useGolfTournamentQuery } from './use-golf-tournament';

/**
 * plans/124 §6.3 — /manage/golf/tournaments/:eventId/scores. Owns the tournament
 * / rounds / field queries and the round selector; bulk load and
 * corrections are each their own component.
 */
export function RootAdminGolfTournamentScoresPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const [round, setRound] = useState(1);

  const tournamentQuery = useGolfTournamentQuery(eventId);

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

  // #236: the field carries each golfer's per-round golf results, so one read serves
  // the CSV template and the chosen round's corrections.
  const fieldQuery = useGolfFieldQuery(eventId);

  const tournament = tournamentQuery.data;
  useManageBreadcrumbOverride(eventId || undefined, tournament?.name);

  const roundOptions = useMemo(() => {
    const total = tournament?.rounds ?? 0;
    const byNumber = new Map(
      (roundsQuery.data ?? []).map((r) => [r.roundNumber, r]),
    );
    return Array.from({ length: total }, (_, index) => {
      const number = index + 1;
      const scheduled = byNumber.get(number)?.scheduledDate;
      return {
        value: String(number),
        label: scheduled
          ? `Round ${number} — ${formatDateDisplay(scheduled)}`
          : `Round ${number}`,
      };
    });
  }, [roundsQuery.data, tournament?.rounds]);

  const fieldPlayers = useMemo(
    () => (fieldQuery.data ?? []).map((entry) => ({
        externalId: entry.participant.externalId,
        playerName: entry.participant.name,
      })),
    [fieldQuery.data],
  );

  const roundScoreRows = useMemo(
    () => golfRoundScoreRows(fieldQuery.data ?? [], round),
    [fieldQuery.data, round],
  );

  const pageState = tournamentQuery.isLoading
    ? 'loading'
    : tournamentQuery.isError
      ? 'error'
      : 'ready';

  const readOnly = tournament
    ? !isAdminManagedGolfTournament(tournament.syncScope)
    : false;

  return (
    <AsyncPage
      errorBody={extractErrorMessage(tournamentQuery.error, {
        fallback: 'We could not load this golf tournament right now.',
      })}
      loadingBody="Loading round scores..."
      state={pageState}
      testId="root-admin-golf-tournament-scores-page"
    >
      {tournament ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LinkButton
              data-testid="root-admin-golf-scores-back"
              size="sm"
              to={`/manage/golf/tournaments/${eventId}`}
              variant="secondary"
            >
              ← Tournament Home
            </LinkButton>
          </div>

          {readOnly ? (
            <Alert tone="warning">
              This tournament is fully provider-owned. Round scores are read-only here.
            </Alert>
          ) : golfTournamentHasScoreSync(tournament.syncScope) ? (
            <Alert data-testid="root-admin-golf-scores-sync-alert" tone="warning">
              Scores for this tournament sync automatically from the linked provider.
              Manual edits here are corrections and may be overwritten by the next sync
              tick.
            </Alert>
          ) : null}

          {roundsQuery.isError ? (
            <Alert data-testid="root-admin-golf-scores-rounds-error" tone="danger">
              {extractErrorMessage(roundsQuery.error, {
                fallback:
                  'We could not load the round schedule, so round dates are hidden.',
              })}
            </Alert>
          ) : null}
          {!readOnly && fieldQuery.isError ? (
            <Alert data-testid="root-admin-golf-scores-field-error" tone="danger">
              {extractErrorMessage(fieldQuery.error, {
                fallback:
                  'We could not load the field, so the CSV template is not pre-filled with golfers.',
              })}
            </Alert>
          ) : null}

          {roundOptions.length > 0 ? (
            <SegmentedControl
              aria-label="Round"
              onChange={(value) => setRound(Number(value))}
              options={roundOptions}
              value={String(round)}
            />
          ) : (
            <Alert data-testid="root-admin-golf-scores-no-rounds" tone="info">
              This tournament has no rounds scheduled yet.
            </Alert>
          )}

          {roundOptions.length > 0 ? (
            <>
              {!readOnly ? (
                <GolfRoundScoreUploadCard
                  eventId={eventId}
                  fieldPlayers={fieldPlayers}
                  round={round}
                />
              ) : null}

              <GolfRoundScoreCorrectionsCard
                eventId={eventId}
                readOnly={readOnly}
                round={round}
                rows={roundScoreRows}
                rowsError={
                  fieldQuery.isError
                    ? extractErrorMessage(fieldQuery.error, {
                        fallback: 'We could not load this round’s scores.',
                      })
                    : null
                }
                rowsLoading={fieldQuery.isLoading}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </AsyncPage>
  );
}
