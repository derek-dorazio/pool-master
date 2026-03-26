import { Link } from 'react-router-dom';
import { Users, Crown, ChevronRight, Plus, Search } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useMyLeagues } from './hooks/use-my-leagues';

const sportEmoji: Record<string, string> = {
  football: '\uD83C\uDFC8',
  soccer: '\u26BD',
  basketball: '\uD83C\uDFC0',
  baseball: '\u26BE',
  hockey: '\uD83C\uDFD2',
};

const MAX_DISPLAYED = 6;

export function MyLeaguesSummary() {
  const { data: leagues, isLoading } = useMyLeagues();

  const displayed = leagues?.slice(0, MAX_DISPLAYED);
  const hasMore = (leagues?.length ?? 0) > MAX_DISPLAYED;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          My Leagues
        </CardTitle>
        {hasMore && (
          <Link
            to="/leagues"
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            View all
            <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !displayed?.length ? (
          <div className="text-center py-6 space-y-3">
            <p className="text-sm text-muted-foreground">
              You haven&apos;t joined any leagues yet.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button asChild size="sm">
                <Link to="/leagues/create">
                  <Plus className="h-4 w-4 mr-1" />
                  Create League
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/discover/leagues">
                  <Search className="h-4 w-4 mr-1" />
                  Join League
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {displayed.map((league) => (
              <Link
                key={league.id}
                to={`/leagues/${league.id}`}
                className="flex flex-col rounded-md border p-3 hover:bg-accent transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg" role="img" aria-label={league.sport}>
                      {sportEmoji[league.sport] ?? '\uD83C\uDFC6'}
                    </span>
                    <span className="text-sm font-medium truncate">
                      {league.name}
                    </span>
                  </div>
                  {league.role === 'Commissioner' && (
                    <Crown className="h-4 w-4 text-yellow-500 shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{league.memberCount} members</span>
                  <span>
                    {league.activeContestCount} active{' '}
                    {league.activeContestCount === 1 ? 'contest' : 'contests'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
