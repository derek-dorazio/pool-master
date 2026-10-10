import { ContestStatus } from '@poolmaster/shared/domain';
import { useQueries } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ContestDto, SportEventDto } from '@/lib/api';
import {
  buildLeagueAdminContestCreatePath,
  buildLeagueAdminContestPath,
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
} from '@/features/shared/ui';
import { useLeagueSquadsQuery } from '@/features/teams/use-league-squads-query';
import { formatSelectionTypeName } from './contest-rules';
import { ContestStatusBadge } from './contest-status-badge';
import { isHistoricalContest } from './contest-status';
import { sportEventQueryOptions } from './use-contest-schedule';
import { useLeagueContestsQuery } from './use-league-contests-query';

const CONTESTS_PER_PAGE = 25;

type ContestFilter = 'active' | 'history';

type ContestRow = {
  contest: ContestDto;
  event: SportEventDto | null;
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

function EventCell({ contest, event }: { contest: ContestDto; event: SportEventDto | null }) {
  if (!event) {
    return <span className="text-muted-foreground">Event unavailable</span>;
  }
  const when = contest.status === ContestStatus.OPEN
    ? 'Entries close'
    : contest.status === ContestStatus.DRAFT ? 'Starts' : 'Started';

  return (
    <div>
      <div>{event.name}</div>
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
      {contest.status === ContestStatus.OPEN ? <span className="text-muted-foreground"> of {teamCount} teams</span> : null}
    </span>
  );
}

/**
 * Commissioner tools › Contests: every contest in the league in one table with search, an Active
 * / History switch and paging, and one action per row naming the next step.
 */
export function ManageContestsPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const contestsQuery = useLeagueContestsQuery(leagueId);
  const teamsQuery = useLeagueSquadsQuery(leagueId);
  const [filter, setFilter] = useState<ContestFilter>('active');

  const contests = useMemo(() => contestsQuery.data ?? [], [contestsQuery.data]);
  const activeContests = useMemo(() => contests.filter((contest) => !isHistoricalContest(contest.status)), [contests]);
  const historyContests = useMemo(() => contests.filter((contest) => isHistoricalContest(contest.status)), [contests]);
  const shownContests = filter === 'active' ? activeContests : historyContests;

  // The event's name and start sort and search the table, so every shown contest's event is read,
  // once per event, through the key every contest page shares.
  const eventIds = useMemo(
    () => [...new Set(shownContests.map((contest) => contest.sportEventId).filter((id): id is string => Boolean(id)))],
    [shownContests],
  );
  // The table waits for every read to settle, so no row reorders or says its event is
  // unavailable while its read is still in flight; a failed read shows as "Event unavailable".
  const { eventsById, eventsLoading } = useQueries({
    queries: eventIds.map((eventId) => sportEventQueryOptions(eventId)),
    combine: (results) => {
      const byId = new Map<string, SportEventDto>();
      for (const result of results) {
        if (result.data) {
          byId.set(result.data.id, result.data);
        }
      }
      return { eventsById: byId, eventsLoading: results.some((result) => result.isPending) };
    },
  });

  const rows = useMemo<ContestRow[]>(() => {
    const built = shownContests.map((contest) => {
      const event = contest.sportEventId ? eventsById.get(contest.sportEventId) ?? null : null;
      return {
        contest,
        event,
        eventName: event?.name ?? '',
        formatName: formatSelectionTypeName(contest.selectionType),
      };
    });
    return built.sort(filter === 'active' ? compareContestRows : compareHistoryRows);
  }, [eventsById, filter, shownContests]);

  const teamCount = (teamsQuery.data ?? []).filter((team) => team.isActive).length;

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
            <LinkButton
              data-testid="manage-contests-create-link"
              to={buildLeagueAdminContestCreatePath(league.leagueCode)}
            >
              Create contest
            </LinkButton>
          ) : (
            <Chip tone="inactive">League inactive</Chip>
          )
        }
        description="Members see a contest once you open it to the league."
        title="Contests"
      />

      {contestsQuery.isLoading || eventsLoading ? (
        <LoadingState body="Loading contests..." />
      ) : contestsQuery.isError ? (
        <ErrorState body="We couldn't load contests for this league." />
      ) : !contests.length ? (
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
              { label: `Active · ${activeContests.length}`, testId: 'manage-contests-filter-active', value: 'active' },
              { label: `History · ${historyContests.length}`, testId: 'manage-contests-filter-history', value: 'history' },
            ]}
            value={filter}
          />
          <DataGrid
            columns={columns}
            data={rows}
            emptyMessage={shownContests.length
              ? 'No contest matches.'
              : filter === 'active' ? 'No contests are in setup, open or live.' : 'No contest has finished yet.'}
            getRowId={(row) => row.contest.id}
            key={filter}
            pageSize={CONTESTS_PER_PAGE}
            rowTestId={(row) => `manage-contests-row-${row.contest.id}`}
            search={{ label: 'Find a contest or event', testId: 'manage-contests-search' }}
            showColumnFilters={false}
            tableTestId="manage-contests-table"
          />
        </div>
      )}
    </section>
  );
}
