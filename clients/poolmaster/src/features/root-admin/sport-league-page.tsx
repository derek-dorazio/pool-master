import { useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router';
import type { SportLeagueDto } from '@/lib/api';
import { QueryState } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { useSportLeagueNoun, useSportLeaguesQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';
import { upperFirst } from '@/lib/upper-first';

/**
 * A page about the sport league in the route (`:leagueId`): it finds the league among the
 * sport's, names it in the breadcrumb, and says so while it loads, when the read fails and when
 * no such league exists. `children` draws the page once the league is there.
 */
export function SportLeaguePage({
  children,
  testId,
}: {
  children: (sportLeague: SportLeagueDto) => ReactNode;
  testId?: string;
}) {
  const { leagueId = '' } = useParams<{ leagueId: string }>();
  const { sport } = useManagedSport();
  const sportLeagueNoun = useSportLeagueNoun(sport, leagueId);
  const leaguesQuery = useSportLeaguesQuery(sport);
  const sportLeague = useMemo(
    // poolmaster-allow-list-lookup: sport leagues are reference data, a few dozen rows that do not grow with history
    () => leaguesQuery.data?.find((candidate) => candidate.id === leagueId),
    [leaguesQuery.data, leagueId],
  );

  useManageBreadcrumbOverride(leagueId || undefined, sportLeague?.name);

  return (
    <section data-testid={testId}>
      <QueryState
        empty={`${upperFirst(sportLeagueNoun.one)} not found.`}
        error={extractErrorMessage(leaguesQuery.error, {
          fallback: `We could not load this ${sportLeagueNoun.one} right now.`,
        })}
        isEmpty={() => !sportLeague}
        loading={`Loading ${sportLeagueNoun.one}...`}
        query={leaguesQuery}
        size="tile"
        testId={testId ? `${testId}-state` : undefined}
      >
        {() => (sportLeague ? children(sportLeague) : null)}
      </QueryState>
    </section>
  );
}
