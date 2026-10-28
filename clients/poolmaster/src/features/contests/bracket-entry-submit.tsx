import { ContestEntryStatus, type Sport } from '@poolmaster/shared/domain';
import { GAME_PICKS_TIEBREAKER_MAX } from '@poolmaster/shared/dto';
import { Alert, Button, FormField, Input, Tile } from '@/features/shared/ui';
import type { GamePicksResponse } from '@/lib/api';
import { formatPickProgress, parseBracketTiebreaker } from './bracket-layout';
import { contestMatchNoun, contestParticipantNoun, contestScoreUnit } from './contest-sport';

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
    <Tile className="space-y-4" data-testid="bracket-submit-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="title-card text-xl">Tiebreaker and submit</h3>
        <span className="text-sm text-muted-foreground" data-testid="bracket-progress">
          {formatPickProgress(gamePicks.pickedCount, gamePicks.gameCount)}
        </span>
      </div>
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
        <p className="text-sm text-muted-foreground" data-testid="bracket-tiebreaker-saved">
          {`Saved tiebreaker: ${gamePicks.tiebreakerValue} total ${scoreUnit}.`}
        </p>
      ) : null}
      {saveError ? <Alert data-testid="bracket-save-error" tone="danger">{saveError}</Alert> : null}

      {isSubmitted ? (
        <Alert data-testid="bracket-submitted" title="Submitted" tone="success">
          {`Your bracket counts. You can still change picks until the ${contestMatchNoun(sport).many} lock; a change that leaves a ${contestMatchNoun(sport).one} unpicked needs submitting again.`}
        </Alert>
      ) : (
        <div className="space-y-3">
          {hint ? <p className="text-sm text-muted-foreground" data-testid="bracket-submit-hint">{hint}</p> : null}
          <Button
            data-testid="bracket-submit"
            disabled={!gamePicks.canSubmit || isSubmitting || isSaving}
            onClick={onSubmit}
          >
            {isSubmitting ? 'Submitting...' : 'Submit bracket'}
          </Button>
        </div>
      )}
      {submitError ? <Alert data-testid="bracket-submit-error" tone="danger">{submitError}</Alert> : null}
    </Tile>
  );
}
