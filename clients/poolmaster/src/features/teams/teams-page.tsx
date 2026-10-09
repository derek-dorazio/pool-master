import type { ColumnDef } from '@tanstack/react-table';
import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { DataGrid, ErrorState, formatDateDisplay, LoadingState, PageHeader } from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { buildTeamDirectoryRows, type TeamDirectoryRow } from './team-directory';
import { TeamNameCell } from './team-name-cell';
import { useLeagueSquadsQuery } from './use-league-squads-query';

const TEAMS_PER_PAGE = 25;

/** Teams: the league's directory of teams and their owners, for every member. */
export function TeamsPage() {
  const logger = getLogger().child({ feature: 'teams-page' });
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { query: leagueQuery, league } = useLeagueContext(leagueCode);
  const teamsQuery = useLeagueSquadsQuery(league?.id ?? '');

  useEffect(() => {
    if (!leagueQuery.isError) {
      return;
    }

    logger.warn(
      { action: 'teams.league.failed', data: { leagueCode }, err: leagueQuery.error },
      'Teams page failed to load league detail',
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const rows = useMemo(() => buildTeamDirectoryRows(teamsQuery.data ?? []), [teamsQuery.data]);
  const columns = useMemo<ColumnDef<TeamDirectoryRow, string>[]>(
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
        cell: ({ getValue }) => getValue() || <span className="text-muted-foreground">No owners</span>,
      },
      {
        // A team joins the league with its first owner, so its creation date is the date it joined.
        id: 'joined',
        header: 'Joined',
        accessorFn: (row) => row.team.createdAt,
        enableGlobalFilter: false,
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{formatDateDisplay(getValue())}</span>
        ),
      },
    ],
    [leagueCode],
  );

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading teams...' });
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }

  return (
    <section className="space-y-6" data-testid="teams-page">
      <PageHeader description={`Every team in ${league.name} and who owns it.`} title="Teams" />

      {teamsQuery.isLoading ? (
        <LoadingState body="Loading teams..." testId="teams-page-teams-loading" />
      ) : teamsQuery.isError ? (
        <ErrorState
          body="We couldn't load teams for this league."
          testId="teams-page-teams-error"
          title="Teams unavailable"
        />
      ) : (
        <DataGrid
          columns={columns}
          data={rows}
          emptyMessage={rows.length ? 'No team or owner matches that search.' : 'No teams exist for this league yet.'}
          getRowId={(row) => row.team.id}
          pageSize={TEAMS_PER_PAGE}
          rowTestId={(row) => `league-team-${row.team.id}`}
          search={{ label: 'Find a team or owner', testId: 'teams-search' }}
          showColumnFilters={false}
          tableTestId="teams-table"
        />
      )}
    </section>
  );
}
