import type { ColumnDef } from '@tanstack/react-table';
import { buildLeagueTeamHomePath } from '@/features/leagues/league-routing';
import type { TeamDirectoryRow } from './team-directory';
import { TeamName } from './team-name';

/**
 * The Name column of a league's team lists: the team's icon and name, linked to its team page.
 * `link: 'row'` leaves the name unlinked, for a list whose rows open the team elsewhere.
 */
export function teamNameColumn<Row extends TeamDirectoryRow>(
  leagueCode: string,
  { link = 'team-page' }: { link?: 'team-page' | 'row' } = {},
): ColumnDef<Row, string> {
  return {
    id: 'team',
    header: 'Name',
    accessorFn: (row) => row.team.name,
    cell: ({ row }) => (
      <TeamName
        iconKey={row.original.team.iconKey}
        isActive={row.original.team.isActive}
        name={row.original.team.name}
        testId={`league-team-home-link-${row.original.team.id}`}
        to={link === 'team-page' ? buildLeagueTeamHomePath(leagueCode, row.original.team.id) : undefined}
      />
    ),
  };
}
