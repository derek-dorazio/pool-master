import { useState } from 'react';
import { MatchEnding, MatchSide } from '@poolmaster/shared/domain';
import { recordEventMatchResult } from '@/lib/api';
import type { SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import { Button, InlineError, Select, Text } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { bracketErrorMessages, matchNoun } from './bracket-copy';
import { type BracketContext, useMatchWrite } from './bracket-match-write';

/** The ways a match can stop early (#704), as the admin picks one; PLAYED is the winner buttons. */
const EARLY_ENDING_LABEL: Readonly<Record<Exclude<MatchEnding, typeof MatchEnding.PLAYED>, string>> = {
  [MatchEnding.RETIREMENT]: 'Retired',
  [MatchEnding.WALKOVER]: 'Walkover',
  [MatchEnding.DEFAULT]: 'Defaulted',
};

/**
 * A match that stopped early (#704): the loser retired, never started (a walkover) or was
 * disqualified. Collapsed under one button so the usual one-tap winner stays as it is; it saves
 * the winner and the ending with no score, which every ending takes.
 */
export function EarlyEndingResult({
  match,
  home,
  away,
  context,
}: {
  match: SportEventMatchDto;
  home: SportEventParticipantDto;
  away: SportEventParticipantDto;
  context: BracketContext;
}) {
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState<keyof typeof EARLY_ENDING_LABEL>(MatchEnding.RETIREMENT);
  const [winnerSide, setWinnerSide] = useState<MatchSide>(MatchSide.HOME);
  const testId = `root-admin-bracket-early-${match.matchNumber}`;

  const save = useMatchWrite({
    context,
    failedAction: 'event.bracket.early-ending.failed',
    logData: () => ({ ending }),
    match,
    onSuccess: () => setEditing(false),
    refusedMessage: 'Early ending was rejected',
    write: (path) => recordEventMatchResult({ path, body: { winnerSide, homeScore: null, awayScore: null, ending } }),
  });

  if (!editing) {
    return (
      <Button
        data-testid={testId}
        onClick={() => {
          save.reset();
          setEnding(match.ending === MatchEnding.PLAYED ? MatchEnding.RETIREMENT : match.ending);
          setWinnerSide(match.winnerSide ?? MatchSide.HOME);
          setEditing(true);
        }}
        size="sm"
        variant="ghost"
      >
        Ended early
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-2" data-testid={`${testId}-editor`}>
      <label className="flex flex-col gap-1">
        <Text variant="caption">How it ended</Text>
        <Select data-testid={`${testId}-ending`} onChange={(change) => setEnding(change.target.value as keyof typeof EARLY_ENDING_LABEL)} value={ending}>
          {Object.entries(EARLY_ENDING_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <Text variant="caption">Winner</Text>
        <Select data-testid={`${testId}-winner`} onChange={(change) => setWinnerSide(change.target.value as MatchSide)} value={winnerSide}>
          <option value={MatchSide.HOME}>{home.participant.name}</option>
          <option value={MatchSide.AWAY}>{away.participant.name}</option>
        </Select>
      </label>
      <Button data-testid={`${testId}-save`} disabled={save.isPending} onClick={() => save.mutate()} size="sm">
        Save result
      </Button>
      <Button disabled={save.isPending} onClick={() => setEditing(false)} size="sm" variant="ghost">Cancel</Button>
      {save.isError ? (
        <InlineError className="w-full" testId={`${testId}-error`}>
          {extractErrorMessage(save.error, {
            codeMessages: bracketErrorMessages(context.vocabulary, match, context.bracket),
            fallback: `This ${matchNoun(context.vocabulary).one}'s result could not be saved. Try again.`,
          })}
        </InlineError>
      ) : null}
    </div>
  );
}
