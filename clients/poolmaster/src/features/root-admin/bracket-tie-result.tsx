import { useState } from 'react';
import { MatchStatus } from '@poolmaster/shared/domain';
import { recordEventMatchResult } from '@/lib/api';
import type { SportEventMatchDto } from '@/lib/api';
import { tieWord } from '@/features/contests/contest-sport';
import { Button, InlineError, Input, Text } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { bracketErrorMessages } from './bracket-copy';
import { type BracketContext, useMatchWrite } from './bracket-match-write';

/**
 * A game of a week that ended level (#792), called by the sport's word ("Draw" in soccer): a tie
 * needs its score, the same for both sides, so the button asks for it before saving.
 */
export function TieResult({ match, context }: { match: SportEventMatchDto; context: BracketContext }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const word = tieWord(context.vocabulary);
  const isTie = match.status === MatchStatus.COMPLETED && match.winnerSide === null;
  const score = /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null;
  const testId = `root-admin-bracket-tie-${match.matchNumber}`;

  const save = useMatchWrite({
    context,
    failedAction: 'event.bracket.tie.failed',
    match,
    onSuccess: () => setEditing(false),
    refusedMessage: 'Tie result was rejected',
    write: (path, level: number) => recordEventMatchResult({ path, body: { winnerSide: null, homeScore: level, awayScore: level } }),
  });

  if (!editing) {
    return (
      <Button
        aria-pressed={isTie}
        data-testid={testId}
        disabled={isTie}
        onClick={() => {
          save.reset();
          setValue('');
          setEditing(true);
        }}
        size="sm"
        variant={isTie ? 'primary' : 'secondary'}
      >
        {isTie ? `${word} ${match.awayScore ?? ''}-${match.homeScore ?? ''}` : word}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid={`${testId}-editor`}>
      <label className="flex w-36 flex-col gap-1">
        <Text variant="caption">Each side scored</Text>
        <Input
          data-testid={`${testId}-score`}
          inputMode="numeric"
          min="0"
          onChange={(change) => setValue(change.target.value)}
          type="number"
          value={value}
        />
      </label>
      <Button
        data-testid={`${testId}-save`}
        disabled={save.isPending || score === null}
        onClick={() => {
          if (score !== null) save.mutate(score);
        }}
        size="sm"
      >
        {`Save ${word.toLowerCase()}`}
      </Button>
      <Button disabled={save.isPending} onClick={() => setEditing(false)} size="sm" variant="ghost">Cancel</Button>
      {save.isError ? (
        <InlineError className="w-full" testId={`${testId}-error`}>
          {extractErrorMessage(save.error, {
            codeMessages: bracketErrorMessages(context.vocabulary, match, context.bracket),
            fallback: `This ${word.toLowerCase()} could not be saved. Try again.`,
          })}
        </InlineError>
      ) : null}
    </div>
  );
}
