import { LeagueRole } from '@poolmaster/shared/domain';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  buildLeagueAdminInvitesPath,
  buildLeagueAdminTeamPath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useLeagueMembersQuery } from '@/features/leagues/use-league-members-query';
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
import { TeamNameCell } from './team-name-cell';
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
  const { membersByUserId } = useLeagueMembersQuery(leagueId);
  const [filter, setFilter] = useState<TeamFilter>('all');

  const rows = useMemo<ManagedTeamRow[]>(
    () => buildTeamDirectoryRows(teamsQuery.data ?? []).map((row) => ({
      ...row,
      hasCommissioner: (row.team.members ?? []).some(
        (member) => membersByUserId.get(member.userId)?.role === LeagueRole.COMMISSIONER,
      ),
    })),
    [membersByUserId, teamsQuery.data],
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
        header: 'Team',
        accessorFn: (row) => row.team.name,
        cell: ({ row }) => <TeamNameCell leagueCode={leagueCode} team={row.original.team} />,
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
        description="Every team in the league. Manage a team to change its name, icon or owners."
        title="Teams and owners"
      />

      {teamsQuery.isLoading ? (
        <LoadingState body="Loading teams..." testId="admin-teams-loading" />
      ) : teamsQuery.isError ? (
        <ErrorState body="We couldn't load teams for this league." title="Teams unavailable" />
      ) : (
        <div className="grid gap-3">
          <SegmentedControl
            aria-label="Teams to show"
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
            emptyMessage={rows.length ? 'No team matches.' : 'No teams exist for this league yet.'}
            getRowId={(row) => row.team.id}
            pageSize={TEAMS_PER_PAGE}
            rowTestId={(row) => `admin-team-${row.team.id}`}
            search={{ label: 'Find a team or owner', testId: 'admin-teams-search' }}
            showColumnFilters={false}
            tableTestId="admin-teams-table"
          />
        </div>
      )}
    </section>
  );
}
