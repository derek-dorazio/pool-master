import type { TeamIconKey } from '@poolmaster/shared/domain';
import { IconAvatar } from '@/features/shared/ui';
import { getTeamIconOption } from './team-icon-catalog';
import { TeamIcon } from './team-icon';

export type TeamAvatarSize = 'sm' | 'md' | 'lg';

/**
 * A team's icon in its coloured square. The icon grows with the square, and the colours come from
 * the icon's own theme, never the avatar's default tone.
 */
export function TeamAvatar({
  iconKey,
  label,
  size = 'sm',
}: {
  iconKey?: TeamIconKey;
  /** Names the avatar for screen readers; leave it out when the team's name sits beside it. */
  label?: string;
  size?: TeamAvatarSize;
}) {
  return (
    <IconAvatar className={getTeamIconOption(iconKey).themeClass} label={label} size={size} tone="custom">
      <TeamIcon iconKey={iconKey} size={size} />
    </IconAvatar>
  );
}
