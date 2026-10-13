import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DataGridPage, LinkButton, StatusBadge } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import type { SportLeagueDto } from '@/lib/api';
import { useSportLeaguesQuery } from './use-sport-catalog';
import { MANAGE_LIST_PAGE_SIZE, buildSportLeagueListPath, buildSportLeaguePath, capitalize } from './manage-navigation';
import { SportSectionMenu } from './sport-section-menu';
import { useManagedSport } from './use-managed-sport';

const columnHelper = createColumnHelper<SportLeagueDto>();

/**
 * /manage/sports/:sport/leagues, a sport's leagues (golf's tours, horse racing's circuits): a
 * searchable, paged grid, with New opening its own page and rows linking to each one.
 */
export function RootAdminSportLeagueListPage() {
  const { sport, definition } = useManagedSport();
  const { sportLeague, event } = definition.vocabulary;

  const leaguesQuery = useSportLeaguesQuery(sport);

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: capitalize(sportLeague.one),
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('matchKeyword', {
        header: 'Match keyword',
        cell: ({ getValue }) => getValue() || '—',
      }),
      columnHelper.accessor('affiliationCount', {
        header: 'Roster size',
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor('sportEventCount', {
        header: capitalize(event.many),
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor('currentEventYear', {
        header: 'Current year',
        cell: ({ getValue }) => getValue() ?? '—',
      }),
      columnHelper.accessor('isActive', {
        header: 'Active',
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() ? 'active' : 'inactive'}>
            {getValue() ? 'Active' : 'Inactive'}
          </StatusBadge>
        ),
      }),
    ],
    [event.many, sportLeague.one],
  );

  return (
    <div className="space-y-4">
      <SportSectionMenu current="leagues" />
      <div className="flex justify-end">
        <LinkButton
          data-testid="root-admin-sport-league-list-new"
          to={`${buildSportLeagueListPath(sport)}/new`}
        >
          {`New ${sportLeague.one}`}
        </LinkButton>
      </div>

      <DataGridPage
        columns={columns}
        data={leaguesQuery.data ?? []}
        emptyMessage={`No ${definition.name.toLowerCase()} ${sportLeague.many} have been created yet.`}
        errorBody={extractErrorMessage(leaguesQuery.error, {
          fallback: `We could not load ${sportLeague.many} right now.`,
        })}
        filterTestIdPrefix="root-admin-sport-league-list-filter"
        getRowId={(league) => league.id}
        getRowLink={(league) => buildSportLeaguePath(sport, league.id)}
        loadingBody={`Loading ${sportLeague.many}...`}
        pageSize={MANAGE_LIST_PAGE_SIZE}
        rowTestId={(league) => `root-admin-sport-league-row-${league.id}`}
        search={{ label: `Find a ${sportLeague.one}`, testId: 'root-admin-sport-league-list-search' }}
        state={
          leaguesQuery.isLoading
            ? 'loading'
            : leaguesQuery.isError
              ? 'error'
              : 'ready'
        }
        tableTestId="root-admin-sport-league-list-table"
        testId="root-admin-sport-league-list-page"
      />
    </div>
  );
}
