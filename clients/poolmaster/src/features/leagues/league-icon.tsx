import type { LeagueIconKey } from '@poolmaster/shared/domain';
import { getLeagueIconOption, leagueIconSpriteHref } from './league-icon-catalog';

type LeagueIconProps = {
  iconKey?: LeagueIconKey;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

function sizeClass(size: LeagueIconProps['size']) {
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

export function LeagueIcon({ iconKey, size = 'md', className = '' }: LeagueIconProps) {
  const icon = getLeagueIconOption(iconKey);

  return (
    <svg
      aria-hidden="true"
      className={`${sizeClass(size)} ${className}`.trim()}
      fill="none"
      viewBox="0 0 64 64"
    >
      <use href={`${leagueIconSpriteHref}#${icon.symbolId}`} />
    </svg>
  );
}
