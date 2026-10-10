import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DataGridPage, LinkButton, StatusBadge } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import type { SportLeagueDto } from '@/lib/api';
import { useGolfSportLeaguesQuery } from './use-golf-catalog';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { GOLF_TOUR_LIST_PATH, MANAGE_LIST_PAGE_SIZE, buildGolfTourPath } from './manage-navigation';
import { GolfSectionMenu } from './golf-section-menu';

const columnHelper = createColumnHelper<SportLeagueDto>();

/**
 * /manage/golf/leagues, the tours list: a searchable, paged grid of the golf sport
 * leagues, with New tour opening its own page and rows linking to each tour.
 */
export function RootAdminGolfLeagueListPage() {
  useManageBreadcrumbOverride('leagues', 'Tours');

  const leaguesQuery = useGolfSportLeaguesQuery();

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Tour',
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
        header: 'Tournaments',
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
    [],
  );

  return (
    <div className="space-y-4">
      <GolfSectionMenu current="tours" />
      <div className="flex justify-end">
        <LinkButton
          data-testid="root-admin-golf-league-list-new"
          to={`${GOLF_TOUR_LIST_PATH}/new`}
        >
          New tour
        </LinkButton>
      </div>

      <DataGridPage
        columns={columns}
        data={leaguesQuery.data ?? []}
        emptyMessage="No golf tours have been created yet."
        errorBody={extractErrorMessage(leaguesQuery.error, {
          fallback: 'We could not load golf tours right now.',
        })}
        filterTestIdPrefix="root-admin-golf-league-list-filter"
        getRowId={(league) => league.id}
        getRowLink={(league) => buildGolfTourPath(league.id)}
        loadingBody="Loading golf tours..."
        pageSize={MANAGE_LIST_PAGE_SIZE}
        rowTestId={(league) => `root-admin-golf-league-row-${league.id}`}
        search={{ label: 'Find a tour', testId: 'root-admin-golf-league-list-search' }}
        state={
          leaguesQuery.isLoading
            ? 'loading'
            : leaguesQuery.isError
              ? 'error'
              : 'ready'
        }
        tableTestId="root-admin-golf-league-list-table"
        testId="root-admin-golf-league-list-page"
      />
    </div>
  );
}
