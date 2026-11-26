import { displayString, roundLabels } from '@poolmaster/shared/display-strings';
import { useMemo, useState } from 'react';
import {
  Notice,
  SegmentedControl,
  formatDateDisplay,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import type { SportEventDto } from '@/lib/api';
import { golfRoundScoreRows } from './sport-admin-utils';
import { GolfRoundScoreCorrectionsCard } from './golf-round-score-corrections-card';
import { GolfRoundScoreUploadCard } from './golf-round-score-upload-card';
import { ScoreSyncNotice } from './score-sync-notice';
import { useSportEventFieldQuery, useSportEventRoundsQuery } from './use-sport-event';

/**
 * Stroke play's results (plans/124 §6.3): an event's round scores, one round at a time. Owns the
 * rounds and field queries and the round selector; bulk load and corrections are each their own
 * component. The event's Results page shows it for a stroke-play event.
 */
export function GolfRoundScoresPanel({ event: tournament }: { event: SportEventDto }) {
  const displayPreferences = useDisplayPreferences();
  const eventId = tournament.id;
  const [round, setRound] = useState(1);

  const roundsQuery = useSportEventRoundsQuery(eventId);

  // #236: the field carries each golfer's per-round golf results, so one read serves
  // the CSV template and the chosen round's corrections.
  const fieldQuery = useSportEventFieldQuery(eventId);

  const roundOptions = useMemo(() => {
    const total = tournament.rounds ?? 0;
    const byNumber = new Map(
      (roundsQuery.data ?? []).map((r) => [r.roundNumber, r]),
    );
    const nameOfRound = roundLabels(roundsQuery.data ?? []);
    return Array.from({ length: total }, (_, index) => {
      const number = index + 1;
      const scheduled = byNumber.get(number)?.scheduledDate;
      const label = nameOfRound(number);
      return {
        value: String(number),
        label: scheduled ? `${label} — ${formatDateDisplay(scheduled, displayPreferences)}` : label,
      };
    });
  }, [displayPreferences, roundsQuery.data, tournament.rounds]);

  const fieldPlayers = useMemo(
    () => (fieldQuery.data ?? []).map((entry) => ({
        participantId: entry.participant.id,
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
      <ScoreSyncNotice event={tournament} scores="Scores for this tournament" testId="root-admin-golf-scores-sync-alert" />

      {roundsQuery.isError ? (
        <Notice data-testid="root-admin-golf-scores-rounds-error" tone="danger">
          {extractErrorMessage(roundsQuery.error, {
            fallback:
              'We could not load the round schedule, so round dates are hidden.',
          })}
        </Notice>
      ) : null}
      {fieldQuery.isError ? (
        <Notice data-testid="root-admin-golf-scores-field-error" tone="danger">
          {extractErrorMessage(fieldQuery.error, {
            fallback:
              'We could not load the field, so the CSV template is not pre-filled with golfers.',
          })}
        </Notice>
      ) : null}

      {roundOptions.length > 0 ? (
        <SegmentedControl
          aria-label={displayString('word.roundHeading')}
          onChange={(value) => setRound(Number(value))}
          options={roundOptions}
          value={String(round)}
        />
      ) : (
        <Notice data-testid="root-admin-golf-scores-no-rounds" tone="info">
          This tournament has no rounds scheduled yet.
        </Notice>
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
