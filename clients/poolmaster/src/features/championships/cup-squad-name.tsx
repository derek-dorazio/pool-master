import type { TeamIconKey } from '@poolmaster/shared/domain';
import { Link } from 'react-router-dom';
import { Chip, IconAvatar } from '@/features/shared/ui';
import { getTeamIconOption } from '@/features/teams/team-icon-catalog';
import { TeamIcon } from '@/features/teams/team-icon';

/**
 * A squad in a cup or championship list: its icon and name, linking on when there is somewhere
 * to go, marked when it is the focus squad or inactive.
 */
export function CupSquadName({
  iconKey,
  isActive = true,
  isFocus,
  name,
  testId,
  to,
}: {
  iconKey: TeamIconKey;
  isActive?: boolean;
  isFocus: boolean;
  name: string;
  testId?: string;
  to?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <IconAvatar className={getTeamIconOption(iconKey).themeClass} size="sm">
        <TeamIcon iconKey={iconKey} size="sm" />
      </IconAvatar>
      {to ? (
        <Link className="truncate font-semibold text-foreground hover:underline" data-testid={testId} to={to}>
          {name}
        </Link>
      ) : (
        <span className="truncate font-semibold text-foreground" data-testid={testId}>{name}</span>
      )}
      {isFocus ? <Chip tone="active">You</Chip> : null}
      {!isActive ? <Chip>Inactive</Chip> : null}
    </div>
  );
}
