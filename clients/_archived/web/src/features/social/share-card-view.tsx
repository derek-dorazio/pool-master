import { useParams, Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useShareCard } from './hooks/use-share';

function ShareCardImage({ data }: { data: NonNullable<ReturnType<typeof useShareCard>['data']> }) {
  return (
    <Card className="mx-auto max-w-md overflow-hidden">
      <CardContent className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {data.sportIcon} {data.title}
        </p>

        <div className="mt-6 flex flex-col items-center">
          <Trophy className="h-8 w-8 text-yellow-500" />
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Winner</p>
          <div className="mt-2 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
            {data.winnerName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
          </div>
          <p className="mt-2 text-lg font-bold">{data.winnerName}</p>
          <p className="text-sm text-muted-foreground">{data.winnerScore}</p>
        </div>

        <div className="mt-6 border-t pt-4">
          <div className="space-y-2">
            {data.leaderboard.map((entry) => (
              <div key={entry.rank} className="flex items-center justify-between text-sm">
                <span>
                  <span className="font-medium">{entry.rank}.</span> {entry.name}
                </span>
                <span className="text-muted-foreground">{entry.score}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">{data.dateRange}</p>
      </CardContent>
    </Card>
  );
}

function JoinCTA() {
  return (
    <div className="mt-8 text-center">
      <p className="text-lg font-semibold">Think you can do better?</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Create leagues, draft squads, and compete with friends across every sport.
      </p>
      <div className="mt-4 flex justify-center gap-3">
        <Button asChild>
          <Link to="/register">Join Ultimate Pool Manager</Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link to="/">Learn More</Link>
        </Button>
      </div>
    </div>
  );
}

export function ShareCardView() {
  const { shareId } = useParams<{ shareId: string }>();
  const { data, isLoading, isError } = useShareCard(shareId!);

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-12">
      <div className="mx-auto max-w-lg">
        <p className="mb-8 text-center text-xl font-bold text-primary">Ultimate Pool Manager</p>

        {isLoading ? (
          <div className="mx-auto max-w-md space-y-4">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-8 w-48 mx-auto" />
          </div>
        ) : isError || !data ? (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">This share link is no longer available.</p>
          </div>
        ) : (
          <>
            <ShareCardImage data={data} />
            <JoinCTA />
          </>
        )}
      </div>
    </div>
  );
}
