import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminListLeagues, type AdminListLeaguesResponses } from '@/lib/api';
import { buildLeaguePath } from '@/features/leagues/league-routing';
import { AdminDataGrid } from './admin-data-grid';

type ManagedLeague = AdminListLeaguesResponses[200]['leagues'][number];
const columnHelper = createColumnHelper<ManagedLeague>();

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

function getLeagueStatusClasses(isActive: boolean) {
  return isActive
    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
    : 'border-amber-300 bg-amber-50 text-amber-900';
}

export function RootAdminManageLeaguesPage() {
  const leaguesQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'manage-leagues'],
    queryFn: async (): Promise<ManagedLeague[]> => {
      const response = await adminListLeagues({
        query: {},
      });

      if (!response.data?.leagues) {
        throw response.error ?? new Error('League management response is missing data.');
      }

      return response.data.leagues;
    },
    retry: false,
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'League',
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-primary">{row.original.name}</div>
            {row.original.description ? (
              <div className="mt-1 text-xs text-muted-foreground">{row.original.description}</div>
            ) : null}
          </div>
        ),
      }),
      columnHelper.accessor('leagueCode', {
        header: 'Code',
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor((league) => (league.isActive ? 'Active' : 'Inactive'), {
        id: 'lifecycle',
        header: 'Lifecycle',
        cell: ({ getValue }) => {
          const isActive = getValue() === 'Active';

          return (
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getLeagueStatusClasses(isActive)}`}
            >
              {getValue()}
            </span>
          );
        },
      }),
      columnHelper.accessor((league) => String(league.memberCount), {
        id: 'memberCount',
        header: 'Members',
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.memberCount}</span>
        ),
      }),
      columnHelper.accessor((league) => String(league.activeContestCount), {
        id: 'activeContestCount',
        header: 'Active contests',
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.activeContestCount}</span>
        ),
      }),
    ],
    [],
  );

  return (
    <section className="space-y-6" data-testid="root-admin-manage-leagues-page">
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link
              className="text-sm font-medium text-primary transition hover:opacity-80"
              to="/manage"
            >
              Back to Manage
            </Link>
            <h2 className="mt-3 text-2xl font-semibold text-foreground">Leagues</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Filter leagues by column and open League Home to manage league details, members, and
              lifecycle actions.
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        {leaguesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading leagues...</p>
        ) : leaguesQuery.isError ? (
          <p className="text-sm text-rose-700">
            {extractErrorMessage(leaguesQuery.error, 'We could not load leagues right now.')}
          </p>
        ) : (
          <AdminDataGrid
            columns={columns}
            data={leaguesQuery.data ?? []}
            emptyMessage="No leagues matched the current filters."
            getRowId={(league) => league.id}
            getRowLink={(league) => buildLeaguePath(league.leagueCode)}
            rowTestId={(league) => `root-admin-manage-leagues-link-${league.id}`}
          />
        )}
      </section>
    </section>
  );
}
