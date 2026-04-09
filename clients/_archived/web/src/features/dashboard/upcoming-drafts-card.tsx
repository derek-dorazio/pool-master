import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUpcomingDrafts } from './hooks/use-upcoming-drafts';

function useCountdown(targetDate: string | null) {
  const [timeLeft, setTimeLeft] = useState(() => (targetDate ? getTimeLeft(targetDate) : null));

  useEffect(() => {
    if (!targetDate) {
      setTimeLeft(null);
      return;
    }

    const interval = setInterval(() => {
      setTimeLeft(getTimeLeft(targetDate));
    }, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return timeLeft;
}

function getTimeLeft(targetDate: string) {
  const diff = new Date(targetDate).getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0 };

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return { days, hours, minutes, seconds, totalMs: diff };
}

function formatCountdown(t: { days: number; hours: number; minutes: number; seconds: number } | null) {
  if (!t) return 'Schedule pending';
  const parts: string[] = [];
  if (t.days > 0) parts.push(`${t.days}d`);
  if (t.hours > 0) parts.push(`${t.hours}h`);
  parts.push(`${t.minutes}m`);
  parts.push(`${t.seconds}s`);
  return parts.join(' ');
}

export function UpcomingDraftsCard() {
  const { data: drafts, isLoading, isError } = useUpcomingDrafts();

  return (
    <Card data-testid="upcoming-drafts-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          Upcoming Drafts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive text-center py-6">
            Failed to load upcoming drafts.
          </p>
        ) : !drafts?.length ? (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground">No upcoming drafts.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {drafts.map((draft) => (
              <DraftRow key={draft.id} draft={draft} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DraftRow({ draft }: { draft: { id: string; name: string; leagueName: string; type: string; scheduledAt: string | null } }) {
  const countdown = useCountdown(draft.scheduledAt);
  const fiveMinutes = 5 * 60 * 1000;
  const canEnter = countdown ? countdown.totalMs <= fiveMinutes : false;

  return (
    <div className="flex items-center justify-between rounded-md p-3 border">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{draft.name}</p>
        <p className="text-xs text-muted-foreground truncate">{draft.leagueName}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {draft.type}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatCountdown(countdown)}
          </span>
        </div>
      </div>
      <div className="shrink-0 ml-4">
        {canEnter ? (
          <Button asChild size="sm">
            <Link to={`/drafts/${draft.id}`}>Enter Draft Room</Link>
          </Button>
        ) : (
          <Button size="sm" disabled title="Available 5 minutes before start">
            Enter Draft Room
          </Button>
        )}
      </div>
    </div>
  );
}
