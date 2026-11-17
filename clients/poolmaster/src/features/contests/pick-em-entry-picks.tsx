import { useQuery } from '@tanstack/react-query';
import type { ContestDto } from '@/lib/api';
import { Text, formatDateTimeDisplay, useDisplayPreferences } from '@/features/shared/ui';
import { pickEmBoardGames, pickLabel, reportMissingTeam, teamNameIn, teamNamesOf } from './pick-em-board';
import { eventFieldQueryOptions, eventGamesQueryOptions } from './use-event-games';
import { gamePicksQueryOptions } from './use-game-picks';

/** The game, then the pick. */
const GRID_COLUMNS = 'minmax(6rem,1fr) minmax(48px,auto)';

/**
 * The viewer's own pick'em entry opened on the entry list (#1751): every game of the week, each
 * with its kickoff and the entry's pick, as the leaderboard will list them once the week is on.
 */
export function PickEmEntryPicks({
  contest,
  entryId,
  sportEventId,
}: {
  contest: Pick<ContestDto, 'id' | 'status'>;
  entryId: string;
  sportEventId: string;
}) {
  const displayPreferences = useDisplayPreferences();
  const gamesQuery = useQuery(eventGamesQueryOptions(sportEventId));
  const namesQuery = useQuery({ ...eventFieldQueryOptions(sportEventId), select: teamNamesOf });
  const picksQuery = useQuery(gamePicksQueryOptions(contest, entryId, sportEventId));
  const names = namesQuery.data;
  if (!names || !gamesQuery.data || !picksQuery.data) {
    return null;
  }
  const teamName = teamNameIn(names, reportMissingTeam(sportEventId));
  const picks = new Map(picksQuery.data.games.flatMap((game) => (game.pick ? [[game.sportEventMatchId, game.pick] as const] : [])));
  const games = pickEmBoardGames(gamesQuery.data, teamName, (startsAt) => formatDateTimeDisplay(startsAt, displayPreferences));
  return (
    <div className="divide-y divide-border" data-testid={`contest-entry-picks-${entryId}`}>
      <div className="grid gap-2 px-4 py-2" style={{ gridTemplateColumns: GRID_COLUMNS }}>
        <Text variant="label">Game</Text>
        <Text className="text-right" variant="label">Your pick</Text>
      </div>
      {games.map((game) => {
        const pick = picks.get(game.id);
        return (
          <div
            className="grid items-baseline gap-2 px-4 py-2"
            data-testid={`contest-entry-pick-${entryId}-${game.id}`}
            key={game.id}
            style={{ gridTemplateColumns: GRID_COLUMNS }}
          >
            <span className="block min-w-0">
              <Text as="span" className="block truncate" size="sm" tone="default" variant="body">{game.matchup}</Text>
              <Text as="span" className="block" tone="muted" variant="caption">{game.progress}</Text>
            </span>
            <Text className="text-right" data-testid={`contest-entry-pick-value-${entryId}-${game.id}`} size="sm" tone="default" variant="value">
              {pick ? pickLabel(pick.sportEventParticipantId, teamName) : '—'}
            </Text>
          </div>
        );
      })}
    </div>
  );
}
