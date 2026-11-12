import { ContestEntryStatus, type Sport } from '@poolmaster/shared/domain';
import { GAME_PICKS_TIEBREAKER_MAX } from '@poolmaster/shared/dto';
import { Notice, Button, FormField, Input, Text } from '@/features/shared/ui';
import type { GamePicksResponse } from '@/lib/api';
import { formatPickProgress, parseBracketTiebreaker } from './bracket-layout';
import { contestMatchNoun, contestParticipantNoun, contestScoreUnit } from './contest-sport';
import { EntrySubmitBar } from './entry-submit-bar';

/** Why the bracket cannot be submitted yet, in the order the entry would fix it, or null. */
function submitHint(gamePicks: GamePicksResponse, sport: Sport | null | undefined): string | null {
  const stillToPick = gamePicks.gameCount - gamePicks.pickedCount;
  if (stillToPick > 0) {
    return `Pick every ${contestMatchNoun(sport).one} to submit: ${stillToPick} still to pick.`;
  }
  if (gamePicks.tiebreakerValue === null) {
    return 'Save your tiebreaker to submit.';
  }
  return null;
}

/**
 * The entry's tiebreaker (the final's total points, both sides together) and the Submit action
 * (#721). The tiebreaker saves on its own, with no picks; Submit follows the server's `canSubmit`,
 * so it opens once every game is picked and the tiebreaker is saved.
 */
export function BracketSubmitPanel({
  gamePicks,
  sport,
  isSaving,
  isSubmitting,
  onSaveTiebreaker,
  onSubmit,
  onTiebreakerChange,
  saveError,
  submitError,
  tiebreakerText,
}: {
  gamePicks: GamePicksResponse;
  /** The contest's sport, whose words the copy reads (#704): "sets" and "players" in tennis. */
  sport: Sport | null | undefined;
  isSaving: boolean;
  isSubmitting: boolean;
  onSaveTiebreaker: (value: number) => void;
  onSubmit: () => void;
  onTiebreakerChange: (text: string) => void;
  /** Why the last tiebreaker save was refused, or null. */
  saveError: string | null;
  /** Why the last submit was refused, or null. */
  submitError: string | null;
  tiebreakerText: string;
}) {
  const parsed = parseBracketTiebreaker(tiebreakerText);
  const isTyped = tiebreakerText.trim() !== '';
  const isUnchanged = parsed !== null && parsed === gamePicks.tiebreakerValue;
  const isSubmitted = gamePicks.status === ContestEntryStatus.SUBMITTED;
  const hint = isSubmitted ? null : submitHint(gamePicks, sport);
  const scoreUnit = contestScoreUnit(sport);

  return (
    <EntrySubmitBar
      error={submitError}
      errorTestId="bracket-submit-error"
      hint={hint}
      hintTestId="bracket-submit-hint"
      progress={formatPickProgress(gamePicks.pickedCount, gamePicks.gameCount)}
      progressTestId="bracket-progress"
      submit={isSubmitted ? null : {
        disabled: !gamePicks.canSubmit || isSubmitting || isSaving,
        isSubmitting,
        label: 'Submit bracket',
        onSubmit,
        testId: 'bracket-submit',
      }}
      testId="bracket-submit-panel"
      title="Tiebreaker and submit"
    >
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed !== null && !isUnchanged) {
            onSaveTiebreaker(parsed);
          }
        }}
      >
        <FormField
          className="min-w-[12rem] flex-1"
          error={isTyped && parsed === null ? `Enter a whole number from 0 to ${GAME_PICKS_TIEBREAKER_MAX}.` : undefined}
          helperText={`Total ${scoreUnit} in the final, both ${contestParticipantNoun(sport).many} together. It only breaks a tie on points.`}
          label="Tiebreaker"
        >
          <Input
            data-testid="bracket-tiebreaker-input"
            disabled={isSaving}
            inputMode="numeric"
            max={GAME_PICKS_TIEBREAKER_MAX}
            min={0}
            onChange={(event) => onTiebreakerChange(event.target.value)}
            type="number"
            value={tiebreakerText}
          />
        </FormField>
        <Button
          data-testid="bracket-tiebreaker-save"
          disabled={parsed === null || isUnchanged || isSaving}
          type="submit"
          variant="secondary"
        >
          {isSaving ? 'Saving...' : 'Save tiebreaker'}
        </Button>
      </form>
      {gamePicks.tiebreakerValue !== null ? (
        <Text as="p" data-testid="bracket-tiebreaker-saved" variant="meta">
          {`Saved tiebreaker: ${gamePicks.tiebreakerValue} total ${scoreUnit}.`}
        </Text>
      ) : null}
      {saveError ? <Notice data-testid="bracket-save-error" tone="danger">{saveError}</Notice> : null}
      {isSubmitted ? (
        <Notice data-testid="bracket-submitted" title="Submitted" tone="success">
          {`Your bracket counts. You can still change picks until the ${contestMatchNoun(sport).many} lock; a change that leaves a ${contestMatchNoun(sport).one} unpicked needs submitting again.`}
        </Notice>
      ) : null}
    </EntrySubmitBar>
  );
}
