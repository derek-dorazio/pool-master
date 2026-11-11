import type { TeamIconKey } from '@poolmaster/shared/domain';
import { Link } from 'react-router';
import { MineMarker } from '@/features/contests/mine-marker';
import { Chip, Text } from '@/features/shared/ui';
import { TeamAvatar } from './team-avatar';

/**
 * A team's name, linking on when there is somewhere to go, marked when it is the viewer's own
 * team or inactive.
 *
 * The icon is off by default (#1474): today's icons are placeholders, and beside a place in
 * standings they read as a second badge. Lists pass `showIcon` again once real icons exist; the
 * squad's own pages and the icon pickers draw `TeamAvatar` themselves and keep showing it.
 */
export function TeamName({
  iconKey,
  isActive = true,
  isMine = false,
  name,
  showIcon = false,
  testId,
  to,
}: {
  iconKey?: TeamIconKey;
  isActive?: boolean;
  isMine?: boolean;
  name: string;
  showIcon?: boolean;
  testId?: string;
  to?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {showIcon ? <TeamAvatar iconKey={iconKey} label={`${name} icon`} /> : null}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {to ? (
            <Text asChild size="inherit" truncate variant="strong" weight="semibold">
              <Link className="hover:underline" data-testid={testId} to={to}>{name}</Link>
            </Text>
          ) : (
            <Text data-testid={testId} size="inherit" truncate variant="strong" weight="semibold">{name}</Text>
          )}
          {isMine ? <MineMarker /> : null}
          {!isActive ? <Chip>Inactive</Chip> : null}
        </div>
      </div>
    </div>
  );
}
