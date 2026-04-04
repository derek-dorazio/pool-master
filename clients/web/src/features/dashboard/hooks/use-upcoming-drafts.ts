import { SelectionType } from '@poolmaster/shared/domain';
import { useDashboardContests, type DashboardContestItem } from './use-dashboard-contests';

export interface UpcomingDraft {
  id: string;
  name: string;
  leagueName: string;
  type: string;
  scheduledAt: string;
}

export function useUpcomingDrafts() {
  const query = useDashboardContests();

  return {
    ...query,
    data: (query.data ?? [])
      .filter((contest: DashboardContestItem) => contest.selectionType === SelectionType.SNAKE_DRAFT)
      .filter((contest: DashboardContestItem) => ['DRAFT', 'OPEN'].includes(contest.status))
      .map((contest: DashboardContestItem) => ({
        id: contest.id,
        name: contest.name,
        leagueName: contest.leagueName,
        type: 'Snake Draft',
        scheduledAt: contest.startsAt ?? new Date().toISOString(),
      }))
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
  };
}
