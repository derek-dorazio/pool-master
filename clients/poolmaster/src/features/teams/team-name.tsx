import type { TeamIconKey } from '@poolmaster/shared/domain';
import { Link } from 'react-router';
import { Chip } from '@/features/shared/ui';
import { TeamAvatar } from './team-avatar';

/**
 * A team's icon and name, linking on when there is somewhere to go, marked when it is the
 * viewer's own team or inactive, with an optional line underneath (its owners, say).
 */
export function TeamName({
  iconKey,
  isActive = true,
  isMine = false,
  name,
  subtitle,
  testId,
  to,
}: {
  iconKey?: TeamIconKey;
  isActive?: boolean;
  isMine?: boolean;
  name: string;
  subtitle?: string;
  testId?: string;
  to?: string;
}) {
  const nameClass = 'truncate font-semibold text-foreground';
  return (
    <div className="flex min-w-0 items-center gap-3">
      <TeamAvatar iconKey={iconKey} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {to ? (
            <Link className={`${nameClass} hover:underline`} data-testid={testId} to={to}>
              {name}
            </Link>
          ) : (
            <span className={nameClass} data-testid={testId}>{name}</span>
          )}
          {isMine ? <Chip tone="active">You</Chip> : null}
          {!isActive ? <Chip>Inactive</Chip> : null}
        </div>
        {subtitle ? <div className="truncate text-sm text-muted-foreground">{subtitle}</div> : null}
      </div>
    </div>
  );
}
