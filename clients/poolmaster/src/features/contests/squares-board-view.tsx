import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ContestStatus } from '@poolmaster/shared/domain';
import {
  claimSquaresBox,
  clearSquaresBox,
  drawSquaresNumbers,
  type ContestDto,
  type SquaresBoardResponse,
  type SquaresBoxDto,
} from '@/lib/api';
import {
  Alert,
  Button,
  ConfirmDialog,
  ErrorState,
  Eyebrow,
  FormField,
  LoadingState,
  Select,
  Tile,
} from '@/features/shared/ui';
import { ApiError, extractErrorMessage, throwApiError, type ErrorCodeMessages } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { formatClaimedCount, formatGridTaken, squaresMomentRows } from './squares-board';
import { SquaresGrid, type SquaresBoxAction } from './squares-grid';
import { useSquaresBoardQuery } from './use-squares-board';

/** Copy for the refusals a claim, a clear and the draw can meet (#711). The codes are the contract. */
const SQUARES_CODE_MESSAGES: ErrorCodeMessages = {
  SQUARES_BOX_TAKEN: 'Someone claimed that box first. The grid has been refreshed.',
  SQUARES_BOX_LIMIT_REACHED: 'That entry holds all the boxes it may claim. Clear one to claim another.',
  SQUARES_BOX_NOT_CLAIMED: 'That box is already empty. The grid has been refreshed.',
  SQUARES_CLAIMING_CLOSED: 'Boxes can no longer change: the numbers are drawn or the game has kicked off.',
  SQUARES_ALREADY_DRAWN: 'The numbers are already drawn.',
  SQUARES_DRAW_CLOSED: 'The numbers can no longer be drawn: the first quarter\'s score is in.',
  ENTRY_ACCESS_DENIED: 'Only that entry\'s owners or a commissioner can change its boxes.',
};

/**
 * A squares contest's board (#711, design §4.2): the winners of each quarter above the grid, then
 * the grid. While claiming is open, a member taps an empty box to claim it for their entry and
 * their own box to clear it; a commissioner chooses which entry they claim for, may clear any
 * box, and draws the numbers. Every write answers with the whole board, which replaces the view.
 */
export function SquaresBoardView({
  canManage,
  contest,
  myEntryIds,
  shownEntryId = null,
}: {
  /** Whether the viewer is a commissioner of the league (or a root admin). */
  canManage: boolean;
  contest: ContestDto;
  /** The viewer's own entries in the contest: one, or none before they enter. */
  myEntryIds: readonly string[];
  /** The entry the page is showing, if any: a commissioner claims for it until they choose another. */
  shownEntryId?: string | null;
}) {
  const logger = getLogger().child({ feature: 'squares-board' });
  const queryClient = useQueryClient();
  const contestId = contest.id;
  const boardKey = QueryKeys.contests.squaresBoard(contestId);
  const boardQuery = useSquaresBoardQuery(contest);
  // The entry a commissioner claims for; null is the entry on screen, else their own, else the first entry.
  const [claimForEntryId, setClaimForEntryId] = useState<string | null>(null);
  const [isDrawConfirmOpen, setIsDrawConfirmOpen] = useState(false);

  const logRefusal = (action: string, error: Error) => {
    const payload = { action, data: { contestId }, err: error };
    if (error instanceof ApiError) {
      logger.warn(payload, 'Squares write was rejected');
    } else {
      logger.error(payload, 'Squares write failed unexpectedly');
    }
  };

  const boxMutation = useInvalidatingMutation({
    mutationFn: async (change: { rowIndex: number; columnIndex: number; action: Exclude<SquaresBoxAction, null>; contestEntryId: string | null }) => {
      const path = { contestId, rowIndex: change.rowIndex, columnIndex: change.columnIndex };
      const response = change.action === 'claim' && change.contestEntryId !== null
        ? await claimSquaresBox({ path, body: { contestEntryId: change.contestEntryId } })
        : await clearSquaresBox({ path });
      if (!response.data) {
        throwApiError(response.error, 'Squares box response is missing data.');
      }
      return response.data;
    },
    onSuccess: (board, change) => {
      logger.info({ action: `squares.${change.action}.succeeded`, data: { contestId, rowIndex: change.rowIndex, columnIndex: change.columnIndex } }, 'Changed a squares box');
      queryClient.setQueryData<SquaresBoardResponse>(boardKey, board);
    },
    // The board read carries every box; the entry list does not change with a box.
    invalidates: [],
    onError: (error, change) => {
      logRefusal(`squares.${change.action}.failed`, error);
      // A refused claim or clear means the grid on screen is not the server's: read it again.
      void queryClient.invalidateQueries({ queryKey: boardKey });
    },
  });

  const drawMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await drawSquaresNumbers({ path: { contestId } });
      if (!response.data) {
        throwApiError(response.error, 'Squares draw response is missing data.');
      }
      return response.data;
    },
    onSuccess: (board) => {
      logger.info({ action: 'squares.draw.succeeded', data: { contestId } }, 'Drew the squares numbers');
      queryClient.setQueryData<SquaresBoardResponse>(boardKey, board);
      setIsDrawConfirmOpen(false);
    },
    // The draw submits every entry holding a box.
    invalidates: [QueryKeys.contestEntries.byContest(contestId), QueryKeys.contests.detail(contestId)],
    onError: (error) => logRefusal('squares.draw.failed', error),
  });

  if (boardQuery.isLoading) {
    return <LoadingState body="Loading the squares grid..." />;
  }
  if (boardQuery.isError || !boardQuery.data) {
    return (
      <ErrorState
        body="Try refreshing or return to the contest board."
        testId="squares-board-error"
        title="We couldn't load this grid."
      />
    );
  }

  const board = boardQuery.data;
  const myEntryId = myEntryIds.at(0) ?? null;
  const claimingEntryId = canManage
    ? claimForEntryId
      ?? board.entries.find((entry) => entry.contestEntryId === shownEntryId)?.contestEntryId
      ?? myEntryId
      ?? board.entries.at(0)?.contestEntryId
      ?? null
    : myEntryId;
  const myBoxCount = board.boxes.filter((box) => box.contestEntryId === claimingEntryId).length;
  const claimingEntry = board.entries.find((entry) => entry.contestEntryId === claimingEntryId) ?? null;
  const isFinal = board.contestStatus === ContestStatus.COMPLETED;
  const moments = squaresMomentRows(board);

  const actionFor = (box: SquaresBoxDto | null): SquaresBoxAction => {
    if (!board.claimsOpen) {
      return null;
    }
    if (box === null) {
      return claimingEntryId === null || myBoxCount >= board.maxSquaresPerEntry ? null : 'claim';
    }
    return canManage || myEntryIds.includes(box.contestEntryId) ? 'clear' : null;
  };
  const changeBox = (rowIndex: number, columnIndex: number, action: Exclude<SquaresBoxAction, null>) => {
    boxMutation.reset();
    boxMutation.mutate({ rowIndex, columnIndex, action, contestEntryId: claimingEntryId });
  };
  const boxError = boxMutation.error
    ? extractErrorMessage(boxMutation.error, { codeMessages: SQUARES_CODE_MESSAGES, fallback: 'We could not change that box. Please try again.' })
    : null;

  return (
    <div className="space-y-6" data-testid="squares-board">
      {board.digits ? (
        <Tile data-testid="squares-winners">
          <h3 className="mb-3 text-lg font-semibold">{isFinal ? 'Winners' : 'Winners so far'}</h3>
          <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
            {moments.map((moment) => (
              <li
                className="rounded-xl border border-border px-3 py-2 text-sm"
                data-testid={`squares-winner-${moment.periodNumber}`}
                key={moment.periodNumber}
              >
                <Eyebrow tone="muted">{moment.label}</Eyebrow>
                {moment.winner ? (
                  <>
                    <div className="font-semibold">{moment.winner.entryName ?? 'No winner'}</div>
                    <div className="text-muted-foreground">
                      {`${board.awayTeamName ?? 'Away'} ${moment.winner.awayScore}, ${board.homeTeamName ?? 'Home'} ${moment.winner.homeScore}`}
                    </div>
                  </>
                ) : (
                  <div className="text-muted-foreground">Not scored yet</div>
                )}
              </li>
            ))}
          </ul>
        </Tile>
      ) : null}

      <Tile>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">{board.claimsOpen ? 'Claim your boxes' : 'The grid'}</h3>
            <p className="text-sm text-muted-foreground" data-testid="squares-claim-help">
              {board.claimsOpen
                ? claimingEntryId === null
                  ? 'Enter the contest to claim boxes.'
                  : 'Tap an empty box to claim it, or one of yours to clear it. The numbers are drawn once the boxes are claimed.'
                : board.digits
                  ? 'The numbers are drawn. Each quarter is won by the box matching the last digit of each team\'s score.'
                  : 'Boxes can no longer be claimed.'}
            </p>
          </div>
          {board.drawOpen && canManage ? (
            <Button data-testid="squares-draw" onClick={() => setIsDrawConfirmOpen(true)}>
              Draw numbers
            </Button>
          ) : null}
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-4 text-sm">
          {canManage && board.claimsOpen && board.entries.length > 0 ? (
            <FormField label="Claim for">
              <Select
                data-testid="squares-claim-for"
                onChange={(event) => setClaimForEntryId(event.target.value)}
                value={claimingEntryId ?? ''}
              >
                {board.entries.map((entry) => (
                  <option key={entry.contestEntryId} value={entry.contestEntryId}>{entry.entryName}</option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {claimingEntry ? (
            <span className="font-semibold" data-testid="squares-claimed-count">
              {`${canManage && claimingEntry.contestEntryId !== myEntryId ? `${claimingEntry.entryName}: ` : ''}${formatClaimedCount(myBoxCount, board.maxSquaresPerEntry)}`}
            </span>
          ) : null}
          <span className="text-muted-foreground" data-testid="squares-grid-taken">{formatGridTaken(board.boxes.length)}</span>
        </div>

        {boxError ? <Alert className="mb-4" data-testid="squares-box-error" tone="danger">{boxError}</Alert> : null}

        <SquaresGrid
          actionFor={actionFor}
          board={board}
          isBusy={boxMutation.isPending}
          myEntryIds={myEntryIds}
          onBoxAction={changeBox}
        />
      </Tile>

      <ConfirmDialog
        confirmLabel="Draw numbers"
        confirmTestId="squares-draw-confirm"
        description="The draw shuffles 0 to 9 along each side of the grid. It's final: it can't be undone or run again, and no box can be claimed or cleared afterwards. Empty boxes stay empty."
        isPending={drawMutation.isPending}
        onCancel={() => {
          if (!drawMutation.isPending) {
            drawMutation.reset();
            setIsDrawConfirmOpen(false);
          }
        }}
        onConfirm={() => void drawMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={(open) => {
          if (!drawMutation.isPending) {
            drawMutation.reset();
            setIsDrawConfirmOpen(open);
          }
        }}
        open={isDrawConfirmOpen}
        pendingLabel="Drawing..."
        testId="squares-draw-dialog"
        title="Draw the numbers?"
      >
        {drawMutation.isError ? (
          <Alert data-testid="squares-draw-error" tone="danger">
            {extractErrorMessage(drawMutation.error, { codeMessages: SQUARES_CODE_MESSAGES, fallback: 'We could not draw the numbers. Please try again.' })}
          </Alert>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
