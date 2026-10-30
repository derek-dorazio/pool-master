import type { ColumnDef } from '@tanstack/react-table';
import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { DataGrid, ErrorState, formatDateDisplay, LoadingState, PageHeader, useDisplayPreferences } from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { buildTeamDirectoryRows, type TeamDirectoryRow } from './team-directory';
import { teamNameColumn } from './team-name-column';
import { useLeagueSquadsQuery } from './use-league-squads-query';

const TEAMS_PER_PAGE = 25;

/** Teams: the league's directory of teams and their owners, for every member. */
export function TeamsPage() {
  const displayPreferences = useDisplayPreferences();
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
      teamNameColumn<TeamDirectoryRow>(leagueCode),
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
          <span className="text-muted-foreground">{formatDateDisplay(getValue(), displayPreferences)}</span>
        ),
      },
    ],
    [displayPreferences, leagueCode],
  );

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading members...' });
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }

  return (
    <section className="space-y-6" data-testid="teams-page">
      <PageHeader description={`Every member of ${league.name} and the name they play under.`} title="Members" />

      {teamsQuery.isLoading ? (
        <LoadingState body="Loading members..." testId="teams-page-teams-loading" />
      ) : teamsQuery.isError ? (
        <ErrorState
          body="We couldn't load this league's members."
          testId="teams-page-teams-error"
          title="Members unavailable"
        />
      ) : (
        <DataGrid
          columns={columns}
          data={rows}
          emptyMessage={rows.length ? 'No members match that search.' : 'No one has joined this league yet.'}
          getRowId={(row) => row.team.id}
          pageSize={TEAMS_PER_PAGE}
          rowTestId={(row) => `league-team-${row.team.id}`}
          search={{ label: 'Find a member or owner', testId: 'teams-search' }}
          showColumnFilters={false}
          tableTestId="teams-table"
        />
      )}
    </section>
  );
}
