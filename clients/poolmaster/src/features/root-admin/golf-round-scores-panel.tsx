import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { getSportDefinition } from '@poolmaster/shared/domain';
import { listEventRounds } from '@/lib/api';
import {
  Alert,
  SegmentedControl,
  formatDateDisplay,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { SportEventDto, SportEventRoundDto } from '@/lib/api';
import {
  golfRoundScoreRows,
  sportEventHasScoreSync,
} from './sport-admin-utils';
import { GolfRoundScoreCorrectionsCard } from './golf-round-score-corrections-card';
import { GolfRoundScoreUploadCard } from './golf-round-score-upload-card';
import { useSportEventFieldQuery } from './use-sport-event';

/**
 * Stroke play's results (plans/124 §6.3): an event's round scores, one round at a time. Owns the
 * rounds and field queries and the round selector; bulk load and corrections are each their own
 * component. The event's Results page shows it for a stroke-play event.
 */
export function GolfRoundScoresPanel({ event: tournament }: { event: SportEventDto }) {
  const displayPreferences = useDisplayPreferences();
  const eventId = tournament.id;
  const [round, setRound] = useState(1);
  const { roundLabel } = getSportDefinition(tournament.sport);

  const roundsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.rounds(eventId),
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
  const fieldQuery = useSportEventFieldQuery(eventId);

  const roundOptions = useMemo(() => {
    const total = tournament.rounds ?? 0;
    const byNumber = new Map(
      (roundsQuery.data ?? []).map((r) => [r.roundNumber, r]),
    );
    return Array.from({ length: total }, (_, index) => {
      const number = index + 1;
      const scheduled = byNumber.get(number)?.scheduledDate;
      const label = roundLabel(number, total);
      return {
        value: String(number),
        label: scheduled ? `${label} — ${formatDateDisplay(scheduled, displayPreferences)}` : label,
      };
    });
  }, [displayPreferences, roundLabel, roundsQuery.data, tournament.rounds]);

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

  return (
    <div className="space-y-6" data-testid="root-admin-golf-tournament-scores-page">
      {sportEventHasScoreSync(tournament.syncScope) ? (
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
      {fieldQuery.isError ? (
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
          <GolfRoundScoreUploadCard
            eventId={eventId}
            fieldPlayers={fieldPlayers}
            round={round}
          />

          <GolfRoundScoreCorrectionsCard
            eventId={eventId}
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
  );
}
