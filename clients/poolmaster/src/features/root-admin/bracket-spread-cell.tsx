import { useState } from 'react';
import { MatchSide, MatchStatus, formatSpread } from '@poolmaster/shared/domain';
import { updateEventBracketMatch } from '@/lib/api';
import type { SportEventMatchDto } from '@/lib/api';
import { Button, InlineError, Input } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { bracketErrorMessages, sideEntry } from './bracket-copy';
import { type BracketContext, useMatchWrite } from './bracket-match-write';

/** "Chiefs -3.5": the spread told from the home team's side, or "No spread" while it has none. */
function describeSpread(match: SportEventMatchDto, context: BracketContext): string {
  if (match.homeSpread === null) {
    return 'No spread';
  }
  const home = sideEntry(match, MatchSide.HOME, context.fieldById);
  const spread = formatSpread(match.homeSpread);
  return home ? `${home.participant.name} ${spread}` : `Home ${spread}`;
}

/**
 * A game's points spread from the home side (#720), used by pools scored against the spread. An
 * admin sets it before release, and after release while no entry has picked the game, which the
 * server checks, though never back to none; a cancelled game keeps its spread.
 */
export function SpreadCell({ match, released, context }: { match: SportEventMatchDto; released: boolean; context: BracketContext }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(match.homeSpread === null ? '' : String(match.homeSpread));
  const home = sideEntry(match, MatchSide.HOME, context.fieldById);
  const parsed = value.trim() === '' ? null : Number(value);
  // A released game keeps its spread once set: only a draft one can go back to none.
  const clearing = parsed === null && released;
  const valid = parsed === null ? !clearing : Number.isFinite(parsed) && Math.abs(parsed) <= 99.5 && Number.isInteger(parsed * 2);

  const save = useMatchWrite({
    context,
    failedAction: 'event.bracket.spread.failed',
    logData: (homeSpread: number | null) => ({ homeSpread }),
    match,
    onSuccess: () => setEditing(false),
    refusedMessage: 'Spread edit was rejected',
    write: (path, homeSpread) => updateEventBracketMatch({ path, body: { homeSpread } }),
  });

  if (!editing) {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className={match.homeSpread === null ? 'text-muted-foreground' : undefined}>{describeSpread(match, context)}</span>
        {match.status !== MatchStatus.CANCELLED ? (
          <Button
            data-testid={`root-admin-bracket-spread-edit-${match.matchNumber}`}
            onClick={() => {
              save.reset();
              setValue(match.homeSpread === null ? '' : String(match.homeSpread));
              setEditing(true);
            }}
            size="sm"
            variant="ghost"
          >
            {match.homeSpread === null ? 'Set spread' : 'Change spread'}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {`${home ? home.participant.name : 'Home'} spread`}
        <Input
          data-testid={`root-admin-bracket-spread-input-${match.matchNumber}`}
          inputMode="decimal"
          onChange={(change) => setValue(change.target.value)}
          placeholder="-3.5"
          step="0.5"
          type="number"
          value={value}
        />
      </label>
      {valid ? null : (
        <InlineError>
          {clearing
            ? `The ${context.vocabulary.event.one} has been released, so this spread can be changed but not cleared.`
            : 'Enter a spread in half points, such as -3.5 or 7, between -99.5 and 99.5.'}
        </InlineError>
      )}
      <div className="flex gap-2">
        <Button
          data-testid={`root-admin-bracket-spread-save-${match.matchNumber}`}
          disabled={save.isPending || !valid}
          onClick={() => save.mutate(parsed)}
          size="sm"
        >
          Save spread
        </Button>
        <Button disabled={save.isPending} onClick={() => setEditing(false)} size="sm" variant="ghost">Cancel</Button>
      </div>
      {save.isError ? (
        <InlineError testId={`root-admin-bracket-spread-error-${match.matchNumber}`}>
          {extractErrorMessage(save.error, {
            codeMessages: bracketErrorMessages(context.vocabulary, match, context.bracket),
            fallback: 'This spread could not be saved. Try again.',
          })}
        </InlineError>
      ) : null}
    </div>
  );
}
