import { LeagueRole } from '@poolmaster/shared/domain';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import {
  buildLeagueAdminInvitesPath,
  buildLeagueAdminTeamPath,
  buildLeagueTeamHomePath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import {
  Chip,
  DataGrid,
  ErrorState,
  LinkButton,
  LoadingState,
  PageHeader,
  SegmentedControl,
} from '@/features/shared/ui';
import { buildTeamDirectoryRows, type TeamDirectoryRow } from './team-directory';
import { TeamName } from './team-name';
import { useLeagueSquadsQuery } from './use-league-squads-query';

const TEAMS_PER_PAGE = 25;

type TeamFilter = 'all' | 'commissioners' | 'inactive';

const TEAM_FILTER_LABELS: Record<TeamFilter, string> = {
  all: 'All',
  commissioners: 'With a commissioner',
  inactive: 'Inactive',
};

const TEAM_FILTER_OPTIONS = Object.entries(TEAM_FILTER_LABELS).map(([value, label]) => ({ label, value }));

function isTeamFilter(value: string): value is TeamFilter {
  return Object.hasOwn(TEAM_FILTER_LABELS, value);
}

type ManagedTeamRow = TeamDirectoryRow & { hasCommissioner: boolean };

/** Commissioner tools › Teams: every team and its owners, each with Manage. */
export function ManageTeamsPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const teamsQuery = useLeagueSquadsQuery(leagueId);
  const [filter, setFilter] = useState<TeamFilter>('all');

  const rows = useMemo<ManagedTeamRow[]>(
    () => buildTeamDirectoryRows(teamsQuery.data ?? []).map((row) => ({
      ...row,
      hasCommissioner: row.team.members.some((member) => member.leagueRole === LeagueRole.COMMISSIONER),
    })),
    [teamsQuery.data],
  );
  const visibleRows = useMemo(
    () => rows.filter((row) => (
      filter === 'commissioners' ? row.hasCommissioner
        : filter === 'inactive' ? !row.team.isActive
          : true
    )),
    [filter, rows],
  );
  const columns = useMemo<ColumnDef<ManagedTeamRow, string>[]>(
    () => [
      {
        id: 'team',
        header: 'Name',
        accessorFn: (row) => row.team.name,
        cell: ({ row }) => (
          <TeamName
            iconKey={row.original.team.iconKey}
            isActive={row.original.team.isActive}
            name={row.original.team.name}
            testId={`league-team-home-link-${row.original.team.id}`}
            to={buildLeagueTeamHomePath(leagueCode, row.original.team.id)}
          />
        ),
      },
      {
        id: 'owners',
        header: 'Owners',
        accessorFn: (row) => row.ownerNames,
        cell: ({ getValue, row }) => (
          <div className="flex flex-wrap items-center gap-2">
            <span>{getValue() || 'No owners'}</span>
            {row.original.hasCommissioner ? <Chip>Commissioner</Chip> : null}
          </div>
        ),
      },
      {
        id: 'manage',
        header: '',
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <LinkButton
            data-testid={`admin-team-manage-${row.original.team.id}`}
            size="sm"
            to={buildLeagueAdminTeamPath(leagueCode, row.original.team.id)}
            variant="secondary"
          >
            Manage
          </LinkButton>
        ),
      },
    ],
    [leagueCode],
  );

  if (!league) {
    return null;
  }

  return (
    <section className="space-y-6" data-testid="admin-teams-page">
      <PageHeader
        actions={(
          <LinkButton data-testid="admin-teams-invite" to={buildLeagueAdminInvitesPath(leagueCode)}>
            Invite members
          </LinkButton>
        )}
        description="Every member of the league and the name they play under. Choose Manage to change a name, icon or owners."
        title="Members and owners"
      />

      {teamsQuery.isLoading ? (
        <LoadingState body="Loading members..." testId="admin-teams-loading" />
      ) : teamsQuery.isError ? (
        <ErrorState body="We couldn't load this league's members." title="Members unavailable" />
      ) : (
        <div className="grid gap-3">
          <SegmentedControl
            aria-label="Members to show"
            onChange={(value) => {
              if (isTeamFilter(value)) {
                setFilter(value);
              }
            }}
            options={TEAM_FILTER_OPTIONS}
            value={filter}
          />
          <DataGrid
            columns={columns}
            data={visibleRows}
            emptyMessage={rows.length ? 'No members match.' : 'No one has joined this league yet.'}
            getRowId={(row) => row.team.id}
            pageSize={TEAMS_PER_PAGE}
            rowTestId={(row) => `admin-team-${row.team.id}`}
            search={{ label: 'Find a member or owner', testId: 'admin-teams-search' }}
            showColumnFilters={false}
            tableTestId="admin-teams-table"
          />
        </div>
      )}
    </section>
  );
}
