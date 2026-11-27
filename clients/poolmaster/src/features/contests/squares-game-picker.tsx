import type { SportEventDto } from '@/lib/api';
import { ErrorState, FormField, LoadingState, Notice, Select, formatDateTimeDisplay, useDisplayPreferences } from '@/features/shared/ui';
import { formatSquaresGameTeams } from './squares-board';
import { useEventRoundNames } from './use-bracket-round-label';
import type { useSquaresGameChoices } from './use-squares-game-choices';

/** The game picker of Create contest for a squares contest: one of the event's games still to kick off. */
export function SquaresGamePicker({
  choices,
  event,
  onChange,
  value,
}: {
  choices: ReturnType<typeof useSquaresGameChoices>;
  event: SportEventDto;
  onChange: (sportEventRoundMatchGameId: string) => void;
  value: string;
}) {
  const displayPreferences = useDisplayPreferences();
  const rounds = useEventRoundNames(event.id);
  const nameOfRound = rounds.nameOfRound;
  // The games wait for their round names, so a game never shows as "Round N" first (#2200).
  if (choices.isLoading || rounds.isLoading) {
    return <LoadingState body="Loading games..." testId="contest-squares-games-loading" />;
  }
  if (choices.isError) {
    return <ErrorState body="We couldn't load this event's games." onRetry={choices.retry} testId="contest-squares-games-error" />;
  }
  if (!choices.games.length) {
    return (
      <Notice data-testid="contest-squares-no-games">
        Every game of this event has kicked off. Choose another event for a squares contest.
      </Notice>
    );
  }
  return (
    <FormField helperText="Boxes can be claimed until this game kicks off." label="Game">
      <Select data-testid="contest-squares-game" onChange={(changeEvent) => onChange(changeEvent.target.value)} value={value}>
        {choices.games.map((choice) => (
          <option key={choice.sportEventRoundMatchGameId} value={choice.sportEventRoundMatchGameId}>
            {[
              nameOfRound(choice.match.roundNumber),
              formatSquaresGameTeams(choice.match, choices.namesById),
              formatDateTimeDisplay(choice.scheduledDate, displayPreferences, 'Kickoff to be announced'),
            ].join(' · ')}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
