import { useQuery } from '@tanstack/react-query';
import type { BracketLeaderboardResponse, ContestDto } from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';
import { ErrorState, LoadingState, ReadOnlyDetailModal, formatPlace } from '@/features/shared/ui';
import { describeBracketTiebreaker, formatPoints } from './bracket-layout';
import { BracketView } from './bracket-view';
import { drawBracket } from './bracket-view-model';
import { contestScoreUnit } from './contest-sport';
import { MineMarker } from './mine-marker';
import { gamePicksQueryOptions } from './use-game-picks';

export type BracketBoardRow = BracketLeaderboardResponse['entries'][number];

/** The line under the dialog's title: "2nd · 88 pts · 36 right · 172 max · Champion: Auburn". */
function describeBracketStanding(row: BracketBoardRow): string {
  return [
    formatPlace(row),
    formatPoints(row.points),
    `${row.correctPickCount} right`,
    `${row.maxPossiblePoints} max`,
    row.champion ? `Champion: ${row.champion.name}` : null,
  ].filter((part) => part !== null).join(' · ');
}

/** The entry's bracket, drawn read-only once its picks load. */
function EntryBracket({ contest, entryId, isMine, sportEventId }: { contest: ContestDto; entryId: string; isMine: boolean; sportEventId: string }) {
  const picksQuery = useQuery(gamePicksQueryOptions(contest, entryId, sportEventId));
  if (picksQuery.isError) {
    return (
      <ErrorState
        body={extractErrorMessage(picksQuery.error, { fallback: 'We couldn\'t load this bracket.' })}
        onRetry={() => void picksQuery.refetch()}
        testId="bracket-dialog-error"
      />
    );
  }
  if (!picksQuery.data) {
    return <LoadingState body="Loading bracket..." testId="bracket-dialog-loading" />;
  }
  const { games, tiebreakerValue } = picksQuery.data;
  return (
    <BracketView
      drawing={drawBracket(games)}
      isOwnEntry={isMine}
      picking={null}
      tiebreaker={describeBracketTiebreaker(tiebreakerValue, contestScoreUnit(contest.sport))}
    />
  );
}

/**
 * One entry's whole bracket (#1753), opened from the leaderboard's bracket icon: read-only, in
 * the large dialog the setup's pick preview uses, the whole screen on a phone. Its title is the
 * entry, marked when it is the viewer's, and the line under it its place, points, right picks,
 * most possible and champion.
 */
export function BracketEntryDialog({
  contest,
  isMine,
  onClose,
  row,
  sportEventId,
}: {
  contest: ContestDto;
  isMine: boolean;
  onClose: () => void;
  /** The entry shown; null while the dialog is closed. */
  row: BracketBoardRow | null;
  sportEventId: string;
}) {
  return (
    <ReadOnlyDetailModal
      description={row ? <span data-testid="bracket-dialog-standing">{describeBracketStanding(row)}</span> : undefined}
      detailContent={row ? <EntryBracket contest={contest} entryId={row.entryId} isMine={isMine} sportEventId={sportEventId} /> : null}
      isFullScreenOnPhone
      onCancel={onClose}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={row !== null}
      size="xl"
      testId="bracket-dialog"
      title={row ? (
        <span className="inline-flex flex-wrap items-center gap-2">
          {row.entryName}
          {isMine ? <MineMarker /> : null}
        </span>
      ) : ''}
    />
  );
}
