import { useDashboardContests, type DashboardContestItem } from './use-dashboard-contests';

export function useActiveContests() {
  const query = useDashboardContests();

  return {
    ...query,
    data: (query.data ?? [])
      .filter((contest: DashboardContestItem) =>
        ['OPEN', 'DRAFTING', 'ACTIVE'].includes(contest.status),
      )
      .sort((a, b) => {
        const timeA = a.startsAt ? new Date(a.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
        const timeB = b.startsAt ? new Date(b.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
        return timeA - timeB;
      }),
  };
}
