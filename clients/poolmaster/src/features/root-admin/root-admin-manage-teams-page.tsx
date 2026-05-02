import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminListTeams, type AdminListTeamsResponses } from '@/lib/api';
import { buildLeagueTeamHomePath } from '@/features/leagues/league-routing';
import { ManagementListPage, StatusBadge } from '@/features/shared/ui';
import { TeamIcon } from '@/features/teams/team-icon';
import { getTeamIconOption } from '@/features/teams/team-icon-catalog';

type ManagedTeam = AdminListTeamsResponses[200]['teams'][number];

const columnHelper = createColumnHelper<ManagedTeam>();

function extractErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const candidate = error as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return fallback;
}

function formatActiveState(isActive: boolean) {
  return isActive ? 'Active' : 'Inactive';
}

function buildOwnerLabel(team: ManagedTeam) {
  if (team.owners.length === 0) {
    return 'No active owners';
  }

  return team.owners
    .map((owner) => [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim() || 'Unknown owner')
    .join(', ');
}

export function RootAdminManageTeamsPage() {
  const teamsQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'manage-teams'],
    queryFn: async (): Promise<ManagedTeam[]> => {
      const response = await adminListTeams({
        query: {},
      });

      if (!response.data?.teams) {
        throw response.error ?? new Error('Team management response is missing data.');
      }

      return response.data.teams;
    },
    retry: false,
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        id: 'team',
        header: 'Team',
        cell: ({ row }) => {
          const icon = getTeamIconOption(row.original.iconKey);

          return (
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] ${icon.surfaceClass} ${icon.accentClass}`}
              >
                <TeamIcon iconKey={row.original.iconKey} size="sm" />
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{row.original.name}</div>
              </div>
            </div>
          );
        },
      }),
      columnHelper.accessor('leagueName', {
        header: 'League',
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">{row.original.leagueName}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {row.original.leagueCode}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor('owners', {
        id: 'owners',
        header: 'Owners',
        sortingFn: (left, right) =>
          buildOwnerLabel(left.original).localeCompare(buildOwnerLabel(right.original)),
        cell: ({ row }) => (
          <div>
            <div className="text-foreground">{buildOwnerLabel(row.original)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {row.original.ownerCount} active owner{row.original.ownerCount === 1 ? '' : 's'}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor('isActive', {
        header: 'Lifecycle',
        cell: ({ getValue }) => {
          const isActive = getValue();

          return (
            <StatusBadge tone={isActive ? 'active' : 'inactive'}>
              {formatActiveState(isActive)}
            </StatusBadge>
          );
        },
      }),
    ],
    [],
  );

  return (
    <ManagementListPage
      columns={columns}
      data={teamsQuery.data ?? []}
      emptyMessage="No teams matched the current filters."
      errorBody={extractErrorMessage(
        teamsQuery.error,
        'We could not load teams right now.',
      )}
      getRowId={(team) => team.id}
      getRowLink={(team) => buildLeagueTeamHomePath(team.leagueCode, team.id)}
      loadingBody="Loading teams..."
      rowTestId={(team) => `root-admin-manage-team-row-${team.id}`}
      state={
        teamsQuery.isLoading ? 'loading' : teamsQuery.isError ? 'error' : 'ready'
      }
      testId="root-admin-manage-teams-page"
    />
  );
}
