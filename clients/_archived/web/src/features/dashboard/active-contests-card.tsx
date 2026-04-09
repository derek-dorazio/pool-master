import { Link } from 'react-router-dom';
import { Trophy, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useActiveContests } from './hooks/use-active-contests';
import { Sport } from '@poolmaster/shared/domain';

const sportEmoji: Record<string, string> = {
  [Sport.NFL]: '\uD83C\uDFC8',
  [Sport.SOCCER]: '\u26BD',
  [Sport.NBA]: '\uD83C\uDFC0',
  [Sport.MLB]: '\u26BE',
  [Sport.NHL]: '\uD83C\uDFD2',
  [Sport.GOLF]: '\u26F3',
  [Sport.TENNIS]: '\uD83C\uDFBE',
  [Sport.NASCAR]: '\uD83C\uDFC1',
  [Sport.F1]: '\uD83C\uDFC1',
  [Sport.HORSE_RACING]: '\uD83C\uDFC7',
  [Sport.NCAA_BASKETBALL]: '\uD83C\uDFC0',
  [Sport.NCAA_FOOTBALL]: '\uD83C\uDFC8',
  [Sport.NCAA_HOCKEY]: '\uD83C\uDFD2',
  [Sport.UFC]: '\uD83E\uDD4A',
};

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatStartsAt(startsAt: string | null | undefined) {
  if (!startsAt) return 'Schedule pending';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(startsAt));
}

export function ActiveContestsCard() {
  const { data: contests, isLoading, isError } = useActiveContests();

  return (
    <Card data-testid="active-contests-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          Active Contests
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive text-center py-6">
            Failed to load active contests.
          </p>
        ) : !contests?.length ? (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground mb-2">No active contests</p>
            <Link
              to="/discover/contests"
              className="text-sm text-primary hover:underline"
            >
              Discover contests
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {contests.map((contest) => {
              const sportLabel = contest.sport ?? 'contest';
              const sportIcon = sportEmoji[contest.sport ?? ''] ?? '\uD83C\uDFC6';
              return (
                <Link
                  key={contest.id}
                  to={`/contests/${contest.id}`}
                  className="flex items-center justify-between rounded-md p-3 hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl" role="img" aria-label={sportLabel}>
                      {sportIcon}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{contest.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {contest.leagueName}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatStatus(contest.status)}</p>
                      <p className="text-xs text-muted-foreground">
                        {contest.entryCount ?? 0} entries • {formatStartsAt(contest.startsAt)}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
