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
  RowActionsMenu,
} from '@/features/shared/ui';
import { buildTeamDirectoryRows, type TeamDirectoryRow } from './team-directory';
import { teamNameColumn } from './team-name-column';
import { useLeagueSquadsQuery } from './use-league-squads-query';

const TEAMS_PER_PAGE = 25;

type TeamFilter = 'all' | 'commissioners' | 'inactive';

const TEAM_FILTER_LABELS: Record<TeamFilter, string> = {
  all: 'All',
  commissioners: 'With a commissioner',
  inactive: 'Inactive',
};

const TEAM_FILTERS = Object.keys(TEAM_FILTER_LABELS).filter(isTeamFilter);

function isTeamFilter(value: string): value is TeamFilter {
  return Object.hasOwn(TEAM_FILTER_LABELS, value);
}

type ManagedTeamRow = TeamDirectoryRow & { hasCommissioner: boolean };

function matchesTeamFilter(row: ManagedTeamRow, filter: TeamFilter) {
  return filter === 'commissioners' ? row.hasCommissioner
    : filter === 'inactive' ? !row.team.isActive
      : true;
}

/** Commissioner tools › Teams: every team and its owners; a row opens the team's Manage page. */
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
    () => rows.filter((row) => matchesTeamFilter(row, filter)),
    [filter, rows],
  );
  const filterOptions = useMemo(
    () => TEAM_FILTERS.map((value) => ({
      count: rows.filter((row) => matchesTeamFilter(row, value)).length,
      label: TEAM_FILTER_LABELS[value],
      testId: `admin-teams-filter-${value}`,
      value,
    })),
    [rows],
  );
  const columns = useMemo<ColumnDef<ManagedTeamRow, string>[]>(
    () => [
      teamNameColumn<ManagedTeamRow>(leagueCode, { link: 'row' }),
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
        title="Members and owners"
      />

      {teamsQuery.isLoading ? (
        <LoadingState rows={3} body="Loading members..." testId="admin-teams-loading" />
      ) : teamsQuery.isError ? (
        <ErrorState body="We couldn't load this league's members." onRetry={() => void teamsQuery.refetch()} title="Members unavailable" />
      ) : (
        <DataGrid
          columns={columns}
          data={visibleRows}
          emptyMessage={rows.length ? 'No members match.' : 'No one has joined this league yet.'}
          getRowId={(row) => row.team.id}
          getRowLink={(row) => buildLeagueAdminTeamPath(leagueCode, row.team.id)}
          pageSize={TEAMS_PER_PAGE}
          rowActions={(row) => (
            <RowActionsMenu
              actions={[{
                label: 'View team page',
                testId: `admin-team-actions-${row.team.id}-view`,
                to: buildLeagueTeamHomePath(leagueCode, row.team.id),
              }]}
              label={`Actions for ${row.team.name}`}
              testId={`admin-team-actions-${row.team.id}`}
            />
          )}
          rowTestId={(row) => `admin-team-${row.team.id}`}
          search={{ label: 'Find a member or owner', testId: 'admin-teams-search' }}
          showColumnFilters={false}
          tableTestId="admin-teams-table"
          views={{
            label: 'Members to show',
            onChange: (value) => {
              if (isTeamFilter(value)) {
                setFilter(value);
              }
            },
            options: filterOptions,
            value: filter,
          }}
        />
      )}
    </section>
  );
}
