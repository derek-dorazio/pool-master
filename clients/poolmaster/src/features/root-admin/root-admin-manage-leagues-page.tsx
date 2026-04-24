import { useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminListLeagues, type AdminListLeaguesResponses } from '@/lib/api';
import { useLogger } from '@/lib/logger';
import { buildLeaguePath } from '@/features/leagues/league-routing';

type ManagedLeague = AdminListLeaguesResponses[200]['leagues'][number];

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

function formatLeagueStatus(isActive: boolean) {
  return isActive ? 'Active' : 'Inactive';
}

function getLeagueStatusClasses(isActive: boolean) {
  return isActive
    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
    : 'border-amber-300 bg-amber-50 text-amber-900';
}

export function RootAdminManageLeaguesPage() {
  const logger = useLogger().child({
    feature: 'root-admin-manage-leagues-page',
  });
  const [leagueSearchDraft, setLeagueSearchDraft] = useState('');
  const deferredLeagueSearch = useDeferredValue(leagueSearchDraft);

  const leaguesQuery = useQuery({
    queryKey: [
      'poolmaster',
      'root-admin',
      'manage-leagues',
      deferredLeagueSearch.trim(),
    ],
    queryFn: async (): Promise<ManagedLeague[]> => {
      const trimmedSearch = deferredLeagueSearch.trim();
      const response = await adminListLeagues({
        query: {
          search: trimmedSearch.length > 0 ? trimmedSearch : undefined,
        },
      });

      if (!response.data?.leagues) {
        throw response.error ?? new Error('League management response is missing data.');
      }

      return response.data.leagues;
    },
    retry: false,
  });

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
              Search leagues and open the canonical League Home to act on them. Commissioner
              and root-admin lifecycle controls (inactivate, permanent delete) live on League
              Home under authority-gated sections.
            </p>
          </div>

          <label className="text-sm text-muted-foreground lg:min-w-[22rem]">
            <span className="mb-2 block font-medium text-foreground">Search by league name</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
              data-testid="root-admin-manage-leagues-search"
              onChange={(event) => setLeagueSearchDraft(event.target.value)}
              placeholder="Search leagues"
              value={leagueSearchDraft}
            />
          </label>
        </div>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        {leaguesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading leagues...</p>
        ) : leaguesQuery.isError ? (
          <p className="text-sm text-rose-700">
            {extractErrorMessage(leaguesQuery.error, 'We could not load leagues right now.')}
          </p>
        ) : (leaguesQuery.data?.length ?? 0) === 0 ? (
          <div
            className="rounded-[1.5rem] border border-dashed border-border bg-background p-6 text-sm text-muted-foreground"
            data-testid="root-admin-manage-leagues-empty"
          >
            No leagues matched the current search.
          </div>
        ) : (
          <div className="space-y-4" data-testid="root-admin-manage-leagues-list">
            {leaguesQuery.data?.map((league) => (
              <Link
                className="block rounded-[1.5rem] border border-border bg-background p-5 transition hover:border-primary/40 hover:bg-card"
                data-testid={`root-admin-manage-leagues-link-${league.id}`}
                key={league.id}
                onClick={() => {
                  logger.info(
                    {
                      action: 'rootAdmin.manageLeagues.openLeague',
                      data: {
                        leagueId: league.id,
                        leagueCode: league.leagueCode,
                      },
                    },
                    'Opened league home from root-admin manage leagues list',
                  );
                }}
                to={buildLeaguePath(league.leagueCode)}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <h4 className="text-lg font-semibold text-foreground">{league.name}</h4>
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getLeagueStatusClasses(league.isActive)}`}
                  >
                    {formatLeagueStatus(league.isActive)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Code: <span className="font-medium text-foreground">{league.leagueCode}</span>
                  {' · '}
                  Members:{' '}
                  <span className="font-medium text-foreground">{league.memberCount}</span>
                  {' · '}
                  Active contests:{' '}
                  <span className="font-medium text-foreground">{league.activeContestCount}</span>
                </p>
                {league.description ? (
                  <p className="mt-2 text-sm text-muted-foreground">{league.description}</p>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
