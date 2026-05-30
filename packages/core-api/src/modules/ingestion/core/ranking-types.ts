import { Sport } from '@poolmaster/shared/domain';

export function resolveRankingType(sport: Sport): string {
  if (sport === Sport.GOLF) {
    return 'OWGR';
  }

  return 'default';
}
