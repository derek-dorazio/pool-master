import { displayString } from '@poolmaster/shared/display-strings';
import { MatchStatus } from '@poolmaster/shared/domain';
import {
  DetailEditModal,
  formatDateTimeDisplay,
  useDisplayPreferences,
  type Fact,
} from '@/features/shared/ui';
import { MATCH_RESULT_SOURCE_LABELS, type EventMatchRow } from './event-match-rows';
import { MATCH_STATUS_LABEL } from './match-status';
import { useSettleAgain } from './use-settle-again';

/**
 * A match on the Event page's Matches grid (⤢, the Event page spec): its round, sides, start,
 * status, score, winner, who set the result and when. Results are entered and corrected in the
 * results tools below the grids on an event no feed syncs; a synced event's results are the feed's.
 * Once the match has a result, Settle again rebuilds the event's contests' boards from the results.
 */
export function EventMatchDialog({
  eventId,
  onClose,
  row,
}: {
  eventId: string;
  onClose: () => void;
  row: EventMatchRow;
}) {
  const preferences = useDisplayPreferences();
  const testId = 'root-admin-event-match-dialog';
  const settleAgain = useSettleAgain(eventId, testId);
  const facts: Fact[] = [
    { id: 'round', label: displayString('word.roundHeading'), value: row.roundLabel, testId: `${testId}-round` },
    {
      id: 'starts',
      label: 'Starts',
      value: formatDateTimeDisplay(row.scheduledDate, preferences, 'Not announced'),
      testId: `${testId}-starts`,
    },
    {
      id: 'status',
      label: 'Status',
      value: MATCH_STATUS_LABEL[row.status],
      testId: `${testId}-status`,
    },
    { id: 'score', label: 'Score', value: row.score ?? 'None yet', testId: `${testId}-score` },
    {
      id: 'winner',
      label: 'Winner',
      value: row.winner ?? (row.status === MatchStatus.COMPLETED ? 'Tie' : 'Not decided'),
      testId: `${testId}-winner`,
    },
    {
      id: 'source',
      label: 'Result from',
      value:
        row.resultSource === null ? 'No result yet' : MATCH_RESULT_SOURCE_LABELS[row.resultSource],
      testId: `${testId}-source`,
    },
    {
      id: 'settled',
      label: 'Settled',
      value: formatDateTimeDisplay(row.completedAt, preferences, 'Not yet'),
      testId: `${testId}-settled`,
    },
  ];

  return (
    <>
      <DetailEditModal
        actions={row.resultSource === null ? undefined : [settleAgain.action]}
        facts={facts}
        factsTitle="Details"
        mode="view"
        onCancel={onClose}
        onOpenChange={(open) => (open ? undefined : onClose())}
        open={!settleAgain.confirmOpen}
        testId={testId}
        title={row.pairing}
      />
      {settleAgain.confirmDialog}
    </>
  );
}
