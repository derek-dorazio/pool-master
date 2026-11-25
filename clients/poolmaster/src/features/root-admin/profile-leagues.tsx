import { enumLabel } from '@poolmaster/shared/display-strings';
import type { SportLeagueDto } from '@/lib/api';
import { QueryState, Text } from '@/features/shared/ui';
import { useSportLeaguesQuery } from '@/features/contest-types/use-sport-leagues-query';
import { extractErrorMessage } from '@/lib/errors';

/**
 * The sport leagues naming a tier or pricing profile (#1849), by sport then name, as a profile's
 * dialog lists them: a profile any of them names can't be deleted.
 */
export function ProfileLeagues({
  names,
  testId,
}: {
  /** Whether the sport league names this profile. */
  names: (league: SportLeagueDto) => boolean;
  testId: string;
}) {
  const leaguesQuery = useSportLeaguesQuery();
  return (
    <QueryState
      error={extractErrorMessage(leaguesQuery.error, { fallback: 'We could not load the sport leagues right now.' })}
      loading="Loading sport leagues..."
      query={leaguesQuery}
      size="inline"
      testId={`${testId}-state`}
    >
      {(leagues) => {
        const naming = leagues
          .filter(names)
          .map((league) => ({ id: league.id, sport: enumLabel('Sport', league.sport), name: league.displayName ?? league.name }))
          .sort((left, right) => left.sport.localeCompare(right.sport) || left.name.localeCompare(right.name));
        if (naming.length === 0) {
          return <Text data-testid={`${testId}-none`} tone="muted">No sport league uses it.</Text>;
        }
        return (
          <ul className="space-y-1" data-testid={testId}>
            {naming.map((league) => (
              <li data-testid={`${testId}-${league.id}`} key={league.id}>
                <Text as="span" variant="strong">{league.name}</Text>
                <Text as="span" tone="muted">{` · ${league.sport}`}</Text>
              </li>
            ))}
          </ul>
        );
      }}
    </QueryState>
  );
}
