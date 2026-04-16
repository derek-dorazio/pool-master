import type { TeamIconKey } from '@poolmaster/shared/domain';
import { getTeamIconOption, teamIconSpriteHref } from './team-icon-catalog';

type TeamIconProps = {
  iconKey?: TeamIconKey;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

function sizeClass(size: TeamIconProps['size']) {
  switch (size) {
    case 'sm':
      return 'h-5 w-5';
    case 'lg':
      return 'h-8 w-8';
    case 'md':
    default:
      return 'h-6 w-6';
  }
}

export function TeamIcon({ iconKey, size = 'md', className = '' }: TeamIconProps) {
  const icon = getTeamIconOption(iconKey);

  return (
    <svg
      aria-hidden="true"
      className={`${sizeClass(size)} ${className}`.trim()}
      fill="none"
      viewBox="0 0 64 64"
    >
      <use href={`${teamIconSpriteHref}#${icon.symbolId}`} />
    </svg>
  );
}
