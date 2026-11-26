import { displayString, enumLabel } from '@poolmaster/shared/display-strings';
import { MatchStatus } from '@poolmaster/shared/domain';
import {
  DetailEditModal,
  formatDateTimeDisplay,
  useDisplayPreferences,
  type Fact,
} from '@/features/shared/ui';
import { type EventMatchGameRow, type EventMatchRow } from './event-match-rows';
import { useSettleAgain } from './use-settle-again';

type GameResult = EventMatchGameRow['results'][number];

/** "Duke 80 (4 shoot-out)": a side's score in a game, and its shoot-out where it had one. */
function describeSideResult(result: GameResult): string {
  const score = result.score === null ? 'no score' : String(result.score);
  return `${result.name} ${score}${result.shootoutScore === null ? '' : ` (${String(result.shootoutScore)} shoot-out)`}`;
}

/** "Duke: Home, Period 1 20, Period 2 41": where a side played the game and its score at each period's end. */
function describePlace(result: GameResult): string {
  const periods = result.periodScores.map((period) => `${enumLabel('PeriodKind', period.kind)} ${String(period.periodNumber)} ${String(period.score)}`);
  return [`${result.name}: ${enumLabel('HomeAway', result.homeAway)}`, ...periods].join(', ');
}

/**
 * A match on the Event page's Matches grid (⤢, the Event page spec): its round, sides, start,
 * status, score, winner, each side and how it came out, each game with each side's result in it
 * (where it played, its score, shoot-out and period scores), and when it was settled. Results come only from the feed
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
    { id: 'round', label: displayString('word.roundHeading'), value: row.roundName, testId: `${testId}-round` },
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
    ...row.sides.map((side) => ({
      id: `side-${String(side.sideNumber)}`,
      label: `Side ${String(side.sideNumber)}`,
      value: side.name,
      detail: enumLabel('MatchSideOutcome', side.outcome),
      testId: `${testId}-side-${String(side.sideNumber)}`,
    })),
    ...row.games.map((game) => ({
      id: `game-${String(game.gameNumber)}`,
      label: `Game ${String(game.gameNumber)}`,
      value: [enumLabel('MatchStatus', game.status), ...game.results.map(describeSideResult)].join(' · '),
      detail: game.results.map(describePlace).join(' · '),
      testId: `${testId}-game-${String(game.gameNumber)}`,
    })),
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
        actions={row.match.isFinal ? [settleAgain.action] : undefined}
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
