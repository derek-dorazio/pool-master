import type { SportEventDto } from '@/lib/api';
import { Alert, FormField, Select, formatDateTimeDisplay, useDisplayPreferences } from '@/features/shared/ui';
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
    return <p className="text-sm text-muted-foreground" data-testid="contest-squares-games-loading">Loading games...</p>;
  }
  if (choices.isError) {
    return <Alert tone="danger">We couldn&apos;t load this event&apos;s games. Try again in a moment.</Alert>;
  }
  if (!choices.games.length) {
    return (
      <Alert data-testid="contest-squares-no-games">
        Every game of this event has kicked off. Choose another event for a squares contest.
      </Alert>
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
