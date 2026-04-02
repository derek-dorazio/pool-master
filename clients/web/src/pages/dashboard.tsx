import { useAuthStore } from '@/stores/auth-store';
import { QuickActionsBar } from '@/features/dashboard/quick-actions-bar';
import { ActiveContestsCard } from '@/features/dashboard/active-contests-card';
import { UpcomingDraftsCard } from '@/features/dashboard/upcoming-drafts-card';
import { MyLeaguesSummary } from '@/features/dashboard/my-leagues-summary';
import { RecentActivityFeed } from '@/features/dashboard/recent-activity-feed';
import { SeasonHighlightsCard } from '@/features/dashboard/season-highlights-card';

export function Component() {
  const user = useAuthStore((s) => s.user);
  const displayName = user?.displayName ?? 'there';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="dashboard-greeting">Welcome back, {displayName}</h1>
        <p className="text-muted-foreground mt-1">
          Your leagues, active contests, and upcoming drafts at a glance.
        </p>
      </div>

      <QuickActionsBar />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <ActiveContestsCard />
          <UpcomingDraftsCard />
        </div>
        <div className="space-y-6">
          <MyLeaguesSummary />
          <RecentActivityFeed />
        </div>
      </div>

      <SeasonHighlightsCard />
    </div>
  );
}
