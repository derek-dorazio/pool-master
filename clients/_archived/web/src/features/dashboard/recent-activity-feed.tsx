import { Link } from 'react-router-dom';
import { Activity, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useRecentActivity, type ActivityType } from './hooks/use-recent-activity';

const activityEmoji: Record<ActivityType, string> = {
  score_update: '\uD83D\uDCCA',
  draft_pick: '\uD83C\uDFAF',
  announcement: '\uD83D\uDCE2',
  contest_completed: '\uD83C\uDFC6',
  member_joined: '\uD83D\uDC4B',
};

export function RecentActivityFeed() {
  const { data: activities, isLoading, isError } = useRecentActivity();

  return (
    <Card data-testid="recent-activity-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive text-center py-6">
            Failed to load recent activity.
          </p>
        ) : !activities?.length ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No recent activity.
          </p>
        ) : (
          <div className="space-y-1">
            {activities.map((item) => {
              const content = (
                <div className="flex items-center justify-between rounded-md p-2.5 hover:bg-accent transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-base" role="img" aria-label={item.type}>
                      {activityEmoji[item.type]}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm truncate">{item.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.relativeTime}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              );

              return item.linkTo ? (
                <Link key={item.id} to={item.linkTo}>
                  {content}
                </Link>
              ) : (
                <div key={item.id}>{content}</div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
