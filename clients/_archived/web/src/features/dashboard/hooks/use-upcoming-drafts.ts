import { SelectionType } from '@poolmaster/shared/domain';
import { useDashboardContests, type DashboardContestItem } from './use-dashboard-contests';

export interface UpcomingDraft {
  id: string;
  name: string;
  leagueName: string;
  type: string;
  scheduledAt: string | null;
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
        scheduledAt: contest.startsAt ?? null,
      }))
      .sort((a, b) => {
        if (!a.scheduledAt && !b.scheduledAt) return 0;
        if (!a.scheduledAt) return 1;
        if (!b.scheduledAt) return -1;
        return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
      }),
  };
}
