import { MatchStatus } from '@poolmaster/shared/domain';

/** A match's status as the admin screens say it: a finished match reads Final. */
export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  [MatchStatus.SCHEDULED]: 'Scheduled',
  [MatchStatus.IN_PROGRESS]: 'In progress',
  [MatchStatus.COMPLETED]: 'Final',
  [MatchStatus.CANCELLED]: 'Cancelled',
  [MatchStatus.POSTPONED]: 'Postponed',
};

export const MATCH_STATUS_TONE: Record<MatchStatus, 'neutral' | 'active' | 'final' | 'warning'> = {
  [MatchStatus.SCHEDULED]: 'neutral',
  [MatchStatus.IN_PROGRESS]: 'active',
  [MatchStatus.COMPLETED]: 'final',
  [MatchStatus.CANCELLED]: 'warning',
  [MatchStatus.POSTPONED]: 'warning',
};
