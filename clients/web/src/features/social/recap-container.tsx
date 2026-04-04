import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Share2, Calendar, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRecap } from './hooks/use-recap';

function ChangeIndicator({ change }: { change: number }) {
  if (change > 0) return <span className="flex items-center gap-0.5 text-xs text-green-600"><ArrowUp className="h-3 w-3" />+{change}</span>;
  if (change < 0) return <span className="flex items-center gap-0.5 text-xs text-red-600"><ArrowDown className="h-3 w-3" />{change}</span>;
  return <span className="flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" />0</span>;
}

export function RecapContainer() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [weekId] = useState('current');
  const { data: recap, isLoading, isError, refetch } = useRecap(leagueId!, weekId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError || !recap) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Weekly Recap</h1>
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load recap</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => refetch()}>Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Weekly Recap</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium">{recap.weekLabel}</span>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Standings Movement */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Standings Movement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recap.standings.map((entry) => (
              <div key={entry.rank} className="flex items-center gap-3">
                <span className="w-6 text-center text-sm font-bold text-muted-foreground">{entry.rank}.</span>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {entry.initials}
                </div>
                <span className="flex-1 text-sm font-medium">{entry.name}</span>
                <span className="text-sm text-muted-foreground">{entry.points} pts</span>
                <ChangeIndicator change={entry.change} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Highlights */}
      <div>
        <h2 className="mb-3 text-base font-semibold">Highlights</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recap.highlights.map((h, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <p className="text-lg">{h.icon}</p>
                <p className="mt-1 text-sm font-medium">{h.title}</p>
                <p className="text-xs text-muted-foreground">{h.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Upcoming Events */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Coming Up</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recap.upcoming.map((event, i) => (
              <div key={i} className="flex items-center gap-3">
                <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{event.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.dateTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {event.daysUntil} {event.daysUntil === 1 ? 'day' : 'days'}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Share */}
      <div className="flex justify-center">
        <Button variant="outline">
          <Share2 className="mr-2 h-4 w-4" />
          Share Recap
        </Button>
      </div>
    </div>
  );
}
