import { MatchStatus } from '@poolmaster/shared/domain';

export const MATCH_STATUS_TONE: Record<MatchStatus, 'neutral' | 'active' | 'final' | 'warning'> = {
  [MatchStatus.SCHEDULED]: 'neutral',
  [MatchStatus.IN_PROGRESS]: 'active',
  [MatchStatus.COMPLETED]: 'final',
  [MatchStatus.CANCELLED]: 'warning',
  [MatchStatus.POSTPONED]: 'warning',
};
