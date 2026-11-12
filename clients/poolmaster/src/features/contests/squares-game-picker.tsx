import type { SportEventDto } from '@/lib/api';
import { ErrorState, FormField, LoadingState, Notice, Select, formatDateTimeDisplay, useDisplayPreferences } from '@/features/shared/ui';
import { bracketRoundCount } from './bracket-start-round';
import { formatSquaresGameTeams } from './squares-board';
import { useSportLeagueRoundLabel } from './use-bracket-round-label';
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
  onChange: (sportEventMatchId: string) => void;
  value: string;
}) {
  const displayPreferences = useDisplayPreferences();
  const roundLabel = useSportLeagueRoundLabel(event.sport, event.sportLeagueId);
  const roundCount = bracketRoundCount(event);
  if (choices.isLoading) {
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
        {choices.games.map((game) => (
          <option key={game.id} value={game.id}>
            {[
              roundLabel(game.roundNumber, roundCount),
              formatSquaresGameTeams(game, choices.namesById),
              formatDateTimeDisplay(game.scheduledDate, displayPreferences, 'Kickoff to be announced'),
            ].join(' · ')}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
