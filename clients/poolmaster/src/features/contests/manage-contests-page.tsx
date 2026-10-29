import { ContestStatus, formatSelectionTypeName  } from '@poolmaster/shared/domain';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { ContestDto } from '@/lib/api';
import {
  buildLeagueAdminContestCreatePath,
  buildLeagueAdminContestPath,
  buildLeagueContestTypesPath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import {
  Chip,
  DataGrid,
  DateDisplay,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingState,
  PageHeader,
  SegmentedControl,
  Select,
} from '@/features/shared/ui';
import { firstContestEvent, type ContestSportEvent } from './contest-events';
import { ContestStatusBadge } from './contest-status-badge';
import { chooseContestHistoryYear } from './contest-history';
import {
  useContestFinishedYearsQuery,
  useLeagueContestsQuery,
  useLeagueFinishedContestsQuery,
} from './use-league-contests-query';

const CONTESTS_PER_PAGE = 25;

type ContestFilter = 'active' | 'history';

type ContestRow = {
  contest: ContestDto;
  event: ContestSportEvent | null;
  eventName: string;
  formatName: string;
};

/** Not yet open first, then by event start (soonest first); a contest whose event is unknown last. */
function compareContestRows(left: ContestRow, right: ContestRow) {
  const leftNotOpen = left.contest.status === ContestStatus.DRAFT ? 0 : 1;
  const rightNotOpen = right.contest.status === ContestStatus.DRAFT ? 0 : 1;
  if (leftNotOpen !== rightNotOpen) {
    return leftNotOpen - rightNotOpen;
  }
  const leftStart = left.event ? Date.parse(left.event.startDate) : Number.POSITIVE_INFINITY;
  const rightStart = right.event ? Date.parse(right.event.startDate) : Number.POSITIVE_INFINITY;
  return leftStart - rightStart;
}

/** The finished contests read newest first: the latest event is the one a commissioner looks for. */
function compareHistoryRows(left: ContestRow, right: ContestRow) {
  return compareContestRows(right, left);
}

function EventCell({ contest, event }: { contest: ContestDto; event: ContestSportEvent | null }) {
  if (!event) {
    return <span className="text-muted-foreground">No event</span>;
  }
  const when = contest.status === ContestStatus.OPEN
    ? 'Entries close'
    : contest.status === ContestStatus.DRAFT ? 'Starts' : 'Started';

  return (
    <div>
      <div>
        {event.name}
        {contest.sportEvents.length > 1 ? <span className="text-muted-foreground">{` and ${contest.sportEvents.length - 1} more`}</span> : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {when} <DateDisplay className="text-muted-foreground" value={event.startDate} />
      </div>
    </div>
  );
}

function EntriesCell({ contest, teamCount }: { contest: ContestDto; teamCount: number }) {
  if (contest.status === ContestStatus.DRAFT) {
    return <span className="text-muted-foreground">Not open</span>;
  }
  const entryCount = contest.entryCount ?? 0;
  return (
    <span className="tabular-nums">
      {entryCount}
      {contest.status === ContestStatus.OPEN ? <span className="text-muted-foreground"> of {teamCount} members</span> : null}
    </span>
  );
}

/**
 * Commissioner tools › Contests: the league's contests in one table with search, an Active /
 * History switch and paging, and one action per row naming the next step. History shows one
 * year's finished contests at a time (#1161), the year in the link (`?year=2025`), else the newest.
 */
export function ManageContestsPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { query: leagueQuery, league } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const contestsQuery = useLeagueContestsQuery(leagueId);
  const yearsQuery = useContestFinishedYearsQuery(leagueId);
  const [filter, setFilter] = useState<ContestFilter>('active');
  const [searchParams, setSearchParams] = useSearchParams();
  const years = useMemo(() => yearsQuery.data ?? [], [yearsQuery.data]);
  const year = chooseContestHistoryYear(years, searchParams.get('year'));
  const historyQuery = useLeagueFinishedContestsQuery(leagueId, filter === 'history' ? year : null);

  const activeContests = useMemo(() => contestsQuery.data ?? [], [contestsQuery.data]);
  const historyContests = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);
  const shownContests = filter === 'active' ? activeContests : historyContests;

  // The first event's name and start sort and search the table; the contest list carries them (#577).
  const rows = useMemo<ContestRow[]>(() => {
    const built = shownContests.map((contest) => {
      const event = firstContestEvent(contest);
      return {
        contest,
        event,
        eventName: event?.name ?? '',
        formatName: formatSelectionTypeName(contest.selectionType),
      };
    });
    return built.sort(filter === 'active' ? compareContestRows : compareHistoryRows);
  }, [filter, shownContests]);

  const teamCount = leagueQuery.data?.activeTeamCount ?? 0;

  const columns = useMemo<ColumnDef<ContestRow, string>[]>(
    () => [
      {
        id: 'contest',
        header: 'Contest',
        accessorFn: (row) => row.contest.name,
        enableSorting: false,
        cell: ({ row }) => (
          <div>
            <div className="font-semibold">{row.original.contest.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.formatName}</div>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => <ContestStatusBadge status={row.original.contest.status} />,
      },
      {
        id: 'event',
        header: 'Event',
        accessorFn: (row) => row.eventName,
        enableSorting: false,
        cell: ({ row }) => <EventCell contest={row.original.contest} event={row.original.event} />,
      },
      {
        id: 'entries',
        header: 'Entries',
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => <EntriesCell contest={row.original.contest} teamCount={teamCount} />,
      },
      {
        id: 'action',
        header: '',
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const { contest } = row.original;
          const isNotOpen = contest.status === ContestStatus.DRAFT;
          return (
            <LinkButton
              data-testid={`manage-contests-action-${contest.id}`}
              size="sm"
              to={buildLeagueAdminContestPath(leagueCode, contest.id)}
              variant={isNotOpen ? 'primary' : 'secondary'}
            >
              {isNotOpen ? 'Finish setup' : 'Manage'}
            </LinkButton>
          );
        },
      },
    ],
    [leagueCode, teamCount],
  );

  if (!league) {
    return null;
  }

  return (
    <section className="space-y-6" data-testid="manage-contests-page">
      <PageHeader
        actions={
          league.isActive ? (
            <>
              <LinkButton
                data-testid="manage-contests-contest-types-link"
                to={buildLeagueContestTypesPath(league.leagueCode)}
                variant="secondary"
              >
                Browse contest types
              </LinkButton>
              <LinkButton
                data-testid="manage-contests-create-link"
                to={buildLeagueAdminContestCreatePath(league.leagueCode)}
              >
                Create contest
              </LinkButton>
            </>
          ) : (
            <Chip tone="inactive">League inactive</Chip>
          )
        }
        description="Members see a contest once you open it to the league."
        title="Contests"
      />

      {contestsQuery.isLoading || yearsQuery.isLoading ? (
        <LoadingState body="Loading contests..." />
      ) : contestsQuery.isError || yearsQuery.isError ? (
        <ErrorState body="We couldn't load contests for this league." />
      ) : !activeContests.length && !years.length ? (
        <EmptyState
          action={
            league.isActive ? (
              <LinkButton to={buildLeagueAdminContestCreatePath(league.leagueCode)} variant="secondary">
                Create contest
              </LinkButton>
            ) : null
          }
          body="Create the first contest for this league."
          testId="manage-contests-empty"
          title="No contests yet"
        />
      ) : (
        <div className="grid gap-3">
          <SegmentedControl
            aria-label="Contests to show"
            onChange={(value) => setFilter(value === 'history' ? 'history' : 'active')}
            options={[
              // poolmaster-allow-list-lookup: counts the league's current contests, listed right below it
              { label: `Active · ${activeContests.length}`, testId: 'manage-contests-filter-active', value: 'active' },
              { label: 'History', testId: 'manage-contests-filter-history', value: 'history' },
            ]}
            value={filter}
          />
          {filter === 'history' && year !== null ? (
            <Select
              aria-label="Year"
              className="w-auto justify-self-start"
              data-testid="manage-contests-history-year"
              onChange={(event) => setSearchParams({ year: event.target.value }, { replace: true })}
              value={year}
            >
              {years.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
          ) : null}
          {filter === 'history' && historyQuery.isError ? (
            <ErrorState body={`We couldn't load the contests finished in ${year}.`} testId="manage-contests-history-error" />
          ) : filter === 'history' && historyQuery.isLoading ? (
            <LoadingState body="Loading finished contests..." />
          ) : (
          <DataGrid
            columns={columns}
            data={rows}
            emptyMessage={shownContests.length
              ? 'No contest matches.'
              : filter === 'active' ? 'No contests are in setup, open or live.' : 'No contest has finished yet.'}
            getRowId={(row) => row.contest.id}
            key={filter === 'active' ? filter : `${filter}-${year}`}
            pageSize={CONTESTS_PER_PAGE}
            rowTestId={(row) => `manage-contests-row-${row.contest.id}`}
            search={{ label: 'Find a contest or event', testId: 'manage-contests-search' }}
            showColumnFilters={false}
            tableTestId="manage-contests-table"
          />
          )}
        </div>
      )}
    </section>
  );
}
