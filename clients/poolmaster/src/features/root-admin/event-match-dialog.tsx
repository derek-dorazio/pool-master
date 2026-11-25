import { displayString, enumLabel } from '@poolmaster/shared/display-strings';
import { MatchStatus } from '@poolmaster/shared/domain';
import {
  DetailEditModal,
  formatDateTimeDisplay,
  useDisplayPreferences,
  type Fact,
} from '@/features/shared/ui';
import { type EventMatchRow } from './event-match-rows';
import { useSettleAgain } from './use-settle-again';

/**
 * A match on the Event page's Matches grid (⤢, the Event page spec): its round, sides, start,
 * status, score, winner, where the result came from and when. Results come only from the feed
 * (#2074): nothing here enters or corrects one.
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
      value: enumLabel('MatchStatus', row.status),
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
        row.resultSource === null ? 'No result yet' : enumLabel('MatchResultSource', row.resultSource),
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
        title={row.pairingLabel}
      />
      {settleAgain.confirmDialog}
    </>
  );
}
