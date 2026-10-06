import type { TeamIconKey } from '@poolmaster/shared/domain';
import type { SquadDto } from '@/lib/api';
import { Chip, IconAvatar, LinkButton, Tile } from '@/features/shared/ui';
import { buildLeaguePath } from '@/features/leagues/league-routing';
import { getTeamIconOption } from './team-icon-catalog';
import { TeamIcon } from './team-icon';

export function MyTeamHeader({
  selectedTeam,
  currentIconKey,
  isManagingAnotherTeam,
  canCreateOwnTeam,
  leagueCode,
}: {
  selectedTeam: SquadDto | null;
  currentIconKey: TeamIconKey;
  isManagingAnotherTeam: boolean;
  canCreateOwnTeam: boolean;
  leagueCode: string;
}) {
  const selectedIcon = getTeamIconOption(currentIconKey);

  return (
    <Tile padding="lg">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <IconAvatar className={selectedIcon.themeClass} size="lg">
            <TeamIcon iconKey={currentIconKey} size="lg" />
          </IconAvatar>
          <div>
            <Chip>
              {isManagingAnotherTeam ? 'Commissioner team view' : 'Team'}
            </Chip>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
              {selectedTeam ? selectedTeam.name : 'Create your team'}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {isManagingAnotherTeam
                ? 'Review this team, update its details, and manage its owners.'
                : !selectedTeam && !canCreateOwnTeam
                  ? 'Select a team from Teams and Owners to manage it here. Root admins can review any team without becoming league members.'
                  : 'Manage your team name, icon, owners, and lifecycle.'}
            </p>
          </div>
        </div>
        <LinkButton to={buildLeaguePath(leagueCode)} variant="secondary">
          Back to league
        </LinkButton>
      </div>
    </Tile>
  );
}
