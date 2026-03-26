import { Link } from 'react-router-dom';
import { Trophy, ArrowUp, Minus, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useActiveContests } from './hooks/use-active-contests';

const sportEmoji: Record<string, string> = {
  football: '\uD83C\uDFC8',
  soccer: '\u26BD',
  basketball: '\uD83C\uDFC0',
  baseball: '\u26BE',
  hockey: '\uD83C\uDFD2',
};

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function ActiveContestsCard() {
  const { data: contests, isLoading } = useActiveContests();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          Active Contests
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
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
            {contests.map((contest) => (
              <Link
                key={contest.id}
                to={`/contests/${contest.id}`}
                className="flex items-center justify-between rounded-md p-3 hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl" role="img" aria-label={contest.sport}>
                    {sportEmoji[contest.sport] ?? '\uD83C\uDFC6'}
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
                    <p className="text-sm font-medium">
                      {ordinal(contest.rank)} of {contest.totalEntrants}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {contest.score} pts
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {contest.delta > 0 ? (
                      <span className="flex items-center text-xs font-medium text-green-600">
                        <ArrowUp className="h-3 w-3" />
                        +{contest.delta}
                      </span>
                    ) : (
                      <span className="flex items-center text-xs text-muted-foreground">
                        <Minus className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
