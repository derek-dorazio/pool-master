import { Link } from 'react-router-dom';
import type { SquadDto } from '@/lib/api';
import { buildLeagueTeamHomePath } from '@/features/leagues/league-routing';
import { Chip } from '@/features/shared/ui';
import { getTeamIconOption } from './team-icon-catalog';
import { TeamIcon } from './team-icon';

/** A team's icon and name, linking to its Team Home, marked when inactive. */
export function TeamNameCell({ leagueCode, team }: { leagueCode: string; team: SquadDto }) {
  const icon = getTeamIconOption(team.iconKey);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${icon.themeClass}`}>
        <TeamIcon iconKey={team.iconKey} size="sm" />
      </span>
      <Link
        className="truncate font-semibold text-foreground hover:underline"
        data-testid={`league-team-home-link-${team.id}`}
        to={buildLeagueTeamHomePath(leagueCode, team.id)}
      >
        {team.name}
      </Link>
      {!team.isActive ? <Chip>Inactive</Chip> : null}
    </div>
  );
}
