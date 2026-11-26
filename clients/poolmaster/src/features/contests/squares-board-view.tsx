import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ContestStatus, MatchStatus } from '@poolmaster/shared/domain';
import {
  claimSquaresBox,
  clearSquaresBox,
  drawSquaresNumbers,
  type ContestDto,
  type SquaresBoardResponse,
  type SquaresBoxDto,
} from '@/lib/api';
import {
  Notice,
  Button,
  ConfirmDialog,
  ErrorState,
  FormField,
  LoadingState,
  SectionCard,
  Select,
  TabbedCard,
  Text,
} from '@/features/shared/ui';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { MineMarker } from './mine-marker';
import { formatClaimedCount, formatGridTaken, squaresMomentRows, squaresScoreByPeriod } from './squares-board';
import { SquaresScoreTable } from './squares-score-table';
import { SquaresGrid, type SquaresBoxAction } from './squares-grid';
import { useSquaresBoardQuery } from './use-squares-board';
import { useContestLeagueCode } from './use-contest-league';
import { SquaresWinners } from './squares-winners';
import { entryWriteKeys } from './use-contest-entries';
import { useLandOnEntry } from './use-linked-entry';

/** The tabs above a drawn board. */
type SquaresTab = 'score' | 'winners';

/**
 * A squares contest's board (#711, design §4.2): the winners of each quarter above the grid, then
 * the grid. While claiming is open, a member taps an empty box to claim it for their entry and
 * their own box to clear it; a commissioner chooses which entry they claim for, may clear any
 * box, and draws the numbers. Every write answers with the whole board, which replaces the view.
 */
export function SquaresBoardView({
  canManage,
  contest,
  linkedEntryId = null,
  myEntryIds,
}: {
  /** Whether the viewer is a commissioner of the league (or a root admin). */
  canManage: boolean;
  contest: ContestDto;
  /**
   * The entry a link names (`?entry=`, #1762): once the board holds it, its boxes are shaded as
   * the viewer's own are and the page scrolls to the board, once. An id the board doesn't hold is ignored.
   */
  linkedEntryId?: string | null;
  /** The viewer's own entries in the contest: one, or none before they enter. */
  myEntryIds: readonly string[];
}) {
  const logger = getLogger().child({ feature: 'squares-board' });
  const queryClient = useQueryClient();
  const contestId = contest.id;
  const boardKey = QueryKeys.contests.squaresBoard(contestId);
  const boardQuery = useSquaresBoardQuery(contest);
  const leagueCode = useContestLeagueCode();
  // The entry a commissioner claims for; null is the entry on screen, else their own, else the first entry.
  const [claimForEntryId, setClaimForEntryId] = useState<string | null>(null);
  const [isDrawConfirmOpen, setIsDrawConfirmOpen] = useState(false);
  const landOn = useLandOnEntry();
  // The tab the viewer chose; until they choose, Score while the game is played and Winners once it is over.
  const [chosenTab, setChosenTab] = useState<SquaresTab | null>(null);

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
    invalidates: entryWriteKeys(contestId),
    onError: (error) => logRefusal('squares.draw.failed', error),
  });

  if (boardQuery.isLoading) {
    return <LoadingState body="Loading the squares grid..." />;
  }
  if (boardQuery.isError || !boardQuery.data) {
    return (
      <ErrorState
        body="We couldn't load this grid."
        onRetry={() => void boardQuery.refetch()}
        testId="squares-board-error"
      />
    );
  }

  const board = boardQuery.data;
  const shownLinkedEntryId = board.entries.some((entry) => entry.contestEntryId === linkedEntryId) ? linkedEntryId : null;
  landOn(shownLinkedEntryId);
  const myEntryId = myEntryIds.at(0) ?? null;
  // A commissioner claims for the entry a link names (?entry=) until they choose another.
  const claimingEntryId = canManage
    ? claimForEntryId
      ?? shownLinkedEntryId
      ?? myEntryId
      ?? board.entries.at(0)?.contestEntryId
      ?? null
    : myEntryId;
  const boxCountOf = (contestEntryId: string) => board.boxes.filter((box) => box.contestEntryId === contestEntryId).length;
  const myBoxCount = claimingEntryId === null ? 0 : boxCountOf(claimingEntryId);
  const isOver = board.contestStatus === ContestStatus.COMPLETED || board.game.status === MatchStatus.COMPLETED;
  const homeTeam = board.homeTeamName ?? 'Home team';
  const awayTeam = board.awayTeamName ?? 'Away team';
  // A winning box's entry's team, for the winner's (i) (#1564).
  const squadIdByEntryId = new Map(board.entries.map((entry) => [entry.contestEntryId, entry.squadId]));
  const winnerSquadId = (contestEntryId: string | null) => (contestEntryId === null ? undefined : squadIdByEntryId.get(contestEntryId));
  // Before the draw, a line per entry of the viewer's, and the one a commissioner claims for.
  const lineEntries = board.entries.filter((entry) => myEntryIds.includes(entry.contestEntryId) || (canManage && entry.contestEntryId === claimingEntryId));

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
    ? extractErrorMessage(boxMutation.error, { fallback: 'We could not change that box. Please try again.' })
    : null;

  return (
    <div className="space-y-6" data-testid="squares-board">
      {board.digits ? (
        <TabbedCard
          aria-label="Score and winners"
          onValueChange={(value) => setChosenTab(value === 'winners' ? 'winners' : 'score')}
          tabs={[
            {
              label: 'Score',
              value: 'score',
              testId: 'squares-tab-score',
              content: <SquaresScoreTable awayTeamName={awayTeam} homeTeamName={homeTeam} score={squaresScoreByPeriod(board.game, board.periods)} />,
            },
            {
              label: 'Winners',
              value: 'winners',
              testId: 'squares-tab-winners',
              content: (
                <SquaresWinners
                  awayTeamName={awayTeam}
                  homeTeamName={homeTeam}
                  leagueCode={leagueCode}
                  leagueId={contest.leagueId}
                  moments={squaresMomentRows(board)}
                  myEntryIds={myEntryIds}
                  squadIdOf={winnerSquadId}
                />
              ),
            },
          ]}
          testId="squares-tabs"
          value={chosenTab ?? (isOver ? 'winners' : 'score')}
        />
      ) : null}

      <SectionCard
        headingLevel={3}
        padded
        testId="squares-grid-section"
        help={board.claimsOpen
          ? 'Tap an open box to claim it, or one of yours to give it back. Once the numbers are drawn, boxes can no longer change.'
          : 'Each period is won by the box at the last digit of each team\'s score at its end.'}
        title={board.claimsOpen ? 'Claim your boxes' : 'The board'}
        trailing={board.drawOpen && canManage ? (
          <Button data-testid="squares-draw" onClick={() => setIsDrawConfirmOpen(true)} size="sm">
            Draw numbers
          </Button>
        ) : undefined}
      >
        {board.claimsOpen && claimingEntryId === null ? (
          <Text as="p" data-testid="squares-claim-help" variant="meta">Enter the contest to claim boxes.</Text>
        ) : null}

        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
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
          <Text data-testid="squares-grid-taken" variant="meta">{formatGridTaken(board.boxes.length)}</Text>
        </div>

        {board.claimsOpen && lineEntries.length > 0 ? (
          <ul className="space-y-1" data-testid="squares-entry-lines">
            {lineEntries.map((entry) => (
              <li className="flex flex-wrap items-center gap-x-2" data-testid={`squares-entry-line-${entry.contestEntryId}`} key={entry.contestEntryId}>
                <Text variant="strong" weight="semibold">{entry.entryName}</Text>
                {myEntryIds.includes(entry.contestEntryId) ? <MineMarker /> : null}
                <Text data-testid={`squares-entry-line-${entry.contestEntryId}-count`} variant="meta">
                  {formatClaimedCount(boxCountOf(entry.contestEntryId), board.maxSquaresPerEntry)}
                </Text>
              </li>
            ))}
          </ul>
        ) : null}

        {boxError ? <Notice data-testid="squares-box-error" tone="danger">{boxError}</Notice> : null}

        <SquaresGrid
          actionFor={actionFor}
          board={board}
          isBusy={boxMutation.isPending}
          linkedEntryId={shownLinkedEntryId}
          myEntryIds={myEntryIds}
          onBoxAction={changeBox}
        />
      </SectionCard>

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
          <Notice data-testid="squares-draw-error" tone="danger">
            {extractErrorMessage(drawMutation.error, { fallback: 'We could not draw the numbers. Please try again.' })}
          </Notice>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
