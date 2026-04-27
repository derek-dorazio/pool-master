import { createColumnHelper } from '@tanstack/react-table';
import { useDeferredValue, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminListTeams, type AdminListTeamsResponses } from '@/lib/api';
import { buildLeagueTeamHomePath } from '@/features/leagues/league-routing';
import { TeamIcon } from '@/features/teams/team-icon';
import { getTeamIconOption } from '@/features/teams/team-icon-catalog';
import { AdminDataGrid } from './admin-data-grid';

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

function getActiveStateClasses(isActive: boolean) {
  return isActive
    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
    : 'border-amber-300 bg-amber-50 text-amber-900';
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
  const [searchDraft, setSearchDraft] = useState('');
  const [leagueCodeDraft, setLeagueCodeDraft] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const deferredSearch = useDeferredValue(searchDraft);
  const deferredLeagueCode = useDeferredValue(leagueCodeDraft);

  const teamsQuery = useQuery({
    queryKey: [
      'poolmaster',
      'root-admin',
      'manage-teams',
      deferredSearch.trim(),
      deferredLeagueCode.trim().toUpperCase(),
      activeFilter,
    ],
    queryFn: async (): Promise<ManagedTeam[]> => {
      const trimmedSearch = deferredSearch.trim();
      const trimmedLeagueCode = deferredLeagueCode.trim().toUpperCase();
      const response = await adminListTeams({
        query: {
          search: trimmedSearch.length > 0 ? trimmedSearch : undefined,
          leagueCode: trimmedLeagueCode.length > 0 ? trimmedLeagueCode : undefined,
          isActive:
            activeFilter === 'ALL'
              ? undefined
              : activeFilter === 'ACTIVE',
        },
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
                <div className="mt-1 text-xs text-muted-foreground">
                  Open Team Home to manage lifecycle.
                </div>
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
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getActiveStateClasses(isActive)}`}
            >
              {formatActiveState(isActive)}
            </span>
          );
        },
      }),
    ],
    [],
  );

  return (
    <section className="space-y-6" data-testid="root-admin-manage-teams-page">
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-col gap-4">
          <div>
            <Link
              className="text-sm font-medium text-primary transition hover:opacity-80"
              to="/manage"
            >
              Back to Manage
            </Link>
            <h2 className="mt-3 text-2xl font-semibold text-foreground">Teams</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Search teams across leagues, sort results, and open Team Home for owner and
              lifecycle actions.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.7fr)]">
            <label className="text-sm text-muted-foreground">
              <span className="mb-2 block font-medium text-foreground">Search by team name</span>
              <input
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
                data-testid="root-admin-manage-teams-search"
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Search teams"
                value={searchDraft}
              />
            </label>

            <label className="text-sm text-muted-foreground">
              <span className="mb-2 block font-medium text-foreground">Filter by league code</span>
              <input
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm uppercase text-foreground"
                data-testid="root-admin-manage-teams-league-code"
                onChange={(event) => setLeagueCodeDraft(event.target.value)}
                placeholder="BIGDAWGS"
                value={leagueCodeDraft}
              />
            </label>

            <label className="text-sm text-muted-foreground">
              <span className="mb-2 block font-medium text-foreground">Lifecycle</span>
              <select
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
                data-testid="root-admin-manage-teams-is-active-filter"
                onChange={(event) =>
                  setActiveFilter(event.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')
                }
                value={activeFilter}
              >
                <option value="ALL">All teams</option>
                <option value="ACTIVE">Active only</option>
                <option value="INACTIVE">Inactive only</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        {teamsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading teams...</p>
        ) : teamsQuery.isError ? (
          <p className="text-sm text-rose-700">
            {extractErrorMessage(teamsQuery.error, 'We could not load teams right now.')}
          </p>
        ) : (
          <AdminDataGrid
            columns={columns}
            data={teamsQuery.data ?? []}
            emptyMessage="No teams matched the current filters."
            getRowId={(team) => team.id}
            getRowLink={(team) => buildLeagueTeamHomePath(team.leagueCode, team.id)}
            rowTestId={(team) => `root-admin-manage-team-row-${team.id}`}
          />
        )}
      </section>
    </section>
  );
}
