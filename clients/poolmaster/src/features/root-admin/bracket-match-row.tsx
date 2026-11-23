import { useState } from 'react';
import { isMatchUnplayed, MatchResultSource, MatchSide, MatchStatus } from '@poolmaster/shared/domain';
import { cancelEventMatch, clearEventMatchResult, postponeEventMatch, recordEventMatchResult } from '@/lib/api';
import type { SportEventMatchDto } from '@/lib/api';
import { Button, ConfirmDialog, formatDateTimeDisplay, InlineError, StatusBadge, TableCell, TableRow, useDisplayPreferences } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { bracketErrors, feederOf, formsNoBracket, MATCH_ENDING_MARK, matchNoun, sideEntry } from './bracket-copy';
import { MatchScoresRow } from './match-scores-row';
import { EarlyEndingResult } from './bracket-early-ending';
import { type BracketContext, describePairing, describeSide, useMatchWrite } from './bracket-match-write';
import { PairingEditor } from './bracket-pairing-editor';
import { SpreadCell } from './bracket-spread-cell';
import { TieResult } from './bracket-tie-result';
import { MATCH_STATUS_LABEL, MATCH_STATUS_TONE } from './match-status';

/**
 * One match of the bracket tab (#700). Before release an admin edits the pairing of any side no
 * earlier match fills; once the event is released one tap names the winner, and a final result
 * can be switched or cleared while the next match has none. A released game of a week that forms
 * no bracket can be cancelled once it is postponed (#715), or end in a tie (#792). A released game
 * not yet under way can be postponed (#1791), and keeps its picks open until its new time. A match that
 * stopped early, in any sport (#704), is entered under "Ended early".
 */
export function BracketMatchRow({ match, released, context }: { match: SportEventMatchDto; released: boolean; context: BracketContext }) {
  const displayPreferences = useDisplayPreferences();
  const [editing, setEditing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const noun = matchNoun(context.vocabulary);
  const errorCopy = bracketErrors(context.vocabulary, match, context.bracket);

  const result = useMatchWrite({
    context,
    failedAction: 'event.bracket.result.failed',
    logData: (winnerSide: MatchSide | null) => ({ winnerSide }),
    match,
    refusedMessage: 'Match result was rejected',
    write: (path, winnerSide) => (winnerSide === null
      ? clearEventMatchResult({ path })
      : recordEventMatchResult({ path, body: { winnerSide, homeScore: null, awayScore: null } })),
  });

  const cancel = useMatchWrite({
    context,
    failedAction: 'event.bracket.cancel.failed',
    match,
    onSuccess: () => setConfirmingCancel(false),
    refusedMessage: 'Game cancellation was rejected',
    write: (path) => cancelEventMatch({ path }),
  });

  const postpone = useMatchWrite({
    context,
    failedAction: 'event.bracket.postpone.failed',
    match,
    refusedMessage: 'Game postponement was rejected',
    write: (path) => postponeEventMatch({ path }),
  });

  const home = sideEntry(match, MatchSide.HOME, context.fieldById);
  const away = sideEntry(match, MatchSide.AWAY, context.fieldById);
  const decided = match.status === MatchStatus.COMPLETED;
  const homeFed = feederOf(match, MatchSide.HOME, context.bracket) !== undefined;
  const awayFed = feederOf(match, MatchSide.AWAY, context.bracket) !== undefined;
  const pairingEditable = !released && !(homeFed && awayFed);
  const weekGame = formsNoBracket(context.bracket);
  const cancellable = released && isMatchUnplayed(match.status) && weekGame;
  const postponable = released && match.status === MatchStatus.SCHEDULED && match.periodScores.length === 0;
  const closeCancel = () => {
    if (!cancel.isPending) {
      cancel.reset();
      setConfirmingCancel(false);
    }
  };

  // A released game with both teams keeps its score by period, for a sport that has periods.
  const periods = released && home && away && match.status !== MatchStatus.CANCELLED ? context.periods : undefined;

  return (
    <>
      <TableRow className="align-top" data-testid={`root-admin-bracket-match-${match.matchNumber}`}>
        <TableCell className="font-medium">{match.matchNumber}</TableCell>
        <TableCell data-testid={`root-admin-bracket-pairing-${match.matchNumber}`}>
          {editing ? (
            <PairingEditor context={context} homeFed={homeFed} awayFed={awayFed} match={match} onDone={() => setEditing(false)} />
          ) : describePairing(match, context)}
        </TableCell>
        {context.spreads ? (
          <TableCell data-testid={`root-admin-bracket-spread-${match.matchNumber}`}>
            <SpreadCell context={context} match={match} released={released} />
          </TableCell>
        ) : null}
        <TableCell className="text-muted-foreground">{formatDateTimeDisplay(match.scheduledDate, displayPreferences, 'To be announced')}</TableCell>
        <TableCell>
          <StatusBadge tone={MATCH_STATUS_TONE[match.status]}>{MATCH_STATUS_LABEL[match.status]}</StatusBadge>
          {match.status === MatchStatus.IN_PROGRESS && match.homeScore !== null && match.awayScore !== null ? (
            <p className="mt-1 text-xs text-muted-foreground" data-testid={`root-admin-bracket-live-${match.matchNumber}`}>
              {`${describeSide(match, MatchSide.AWAY, context)} ${match.awayScore}, ${describeSide(match, MatchSide.HOME, context)} ${match.homeScore}, from ${context.feedName}`}
            </p>
          ) : null}
          {match.resultSource === MatchResultSource.PROVIDER ? (
            <p className="mt-1 text-xs text-muted-foreground" data-testid={`root-admin-bracket-source-${match.matchNumber}`}>From {context.feedName}</p>
          ) : null}
        </TableCell>
        <TableCell>
          {pairingEditable && !editing ? (
            <Button data-testid={`root-admin-bracket-edit-${match.matchNumber}`} onClick={() => setEditing(true)} size="sm" variant="secondary">
              Edit pairing
            </Button>
          ) : null}
          {released && home && away && match.status !== MatchStatus.CANCELLED ? (
            <div className="flex flex-wrap gap-2">
              {([[MatchSide.HOME, home], [MatchSide.AWAY, away]] as const).map(([side, entry]) => {
                const won = decided && match.winnerSide === side;
                const mark = MATCH_ENDING_MARK[match.ending];
                return (
                  <Button
                    aria-pressed={won}
                    data-testid={`root-admin-bracket-winner-${match.matchNumber}-${side}`}
                    disabled={won || result.isPending}
                    key={side}
                    onClick={() => result.mutate(side)}
                    size="sm"
                    variant={won ? 'primary' : 'secondary'}
                  >
                    {won ? `${entry.participant.name} won${mark ? ` (${mark})` : ''}` : `${entry.participant.name} wins`}
                  </Button>
                );
              })}
              {weekGame ? <TieResult context={context} match={match} /> : null}
              <EarlyEndingResult away={away} context={context} home={home} match={match} />
              {decided ? (
                <Button
                  data-testid={`root-admin-bracket-clear-${match.matchNumber}`}
                  disabled={result.isPending}
                  onClick={() => result.mutate(null)}
                  size="sm"
                  variant="ghost"
                >
                  Clear result
                </Button>
              ) : null}
              {postponable ? (
                <Button
                  data-testid={`root-admin-bracket-postpone-${match.matchNumber}`}
                  disabled={result.isPending || postpone.isPending}
                  onClick={() => postpone.mutate()}
                  size="sm"
                  variant="ghost"
                >
                  {`Postpone ${noun.one}`}
                </Button>
              ) : null}
              {cancellable ? (
                <Button
                  data-testid={`root-admin-bracket-cancel-${match.matchNumber}`}
                  disabled={result.isPending}
                  onClick={() => setConfirmingCancel(true)}
                  size="sm"
                  variant="ghost"
                >
                  {`Cancel ${noun.one}`}
                </Button>
              ) : null}
            </div>
          ) : null}
          <ConfirmDialog
            cancelLabel={`Keep ${noun.one}`}
            confirmLabel={`Cancel ${noun.one}`}
            confirmTestId={`root-admin-bracket-cancel-confirm-${match.matchNumber}`}
            description={`${describePairing(match, context)} will count for nothing in every contest. If it is played later, add it to the week it moves to before that week is released.`}
            isPending={cancel.isPending}
            onCancel={closeCancel}
            onConfirm={() => cancel.mutate()}
            onOpenChange={(open) => (open ? setConfirmingCancel(true) : closeCancel())}
            open={confirmingCancel}
            pendingLabel="Cancelling..."
            title={`Cancel ${noun.one} ${match.matchNumber}?`}
            tone="danger"
          >
            {cancel.isError ? (
              <InlineError testId={`root-admin-bracket-cancel-error-${match.matchNumber}`}>
                {extractErrorMessage(cancel.error, { ...errorCopy, fallback: `This ${noun.one} could not be cancelled. Try again.` })}
              </InlineError>
            ) : null}
          </ConfirmDialog>
          {released && (!home || !away) ? (
            <p className="text-sm text-muted-foreground">{`Waiting on both ${context.vocabulary.participant.many}`}</p>
          ) : null}
          {postpone.isError ? (
            <InlineError className="mt-2" testId={`root-admin-bracket-postpone-error-${match.matchNumber}`}>
              {extractErrorMessage(postpone.error, { ...errorCopy, fallback: `This ${noun.one} could not be postponed. Try again.` })}
            </InlineError>
          ) : null}
          {result.isError ? (
            <InlineError className="mt-2" testId={`root-admin-bracket-error-${match.matchNumber}`}>
              {extractErrorMessage(result.error, { ...errorCopy, fallback: `This ${noun.one}'s result could not be saved. Try again.` })}
            </InlineError>
          ) : null}
        </TableCell>
      </TableRow>
      {periods ? <MatchScoresRow columns={context.spreads ? 6 : 5} context={context} match={match} periods={periods} /> : null}
    </>
  );
}
