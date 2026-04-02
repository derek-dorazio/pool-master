import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { DraftStatus } from '@poolmaster/shared/domain/enums';
import { Volume2, VolumeX, Maximize, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { DraftState } from './hooks/use-draft';

const statusColors: Record<string, string> = {
  [DraftStatus.PENDING]: 'bg-yellow-100 text-yellow-800',
  [DraftStatus.LIVE]: 'bg-green-100 text-green-800',
  [DraftStatus.PAUSED]: 'bg-orange-100 text-orange-800',
  [DraftStatus.COMPLETE]: 'bg-blue-100 text-blue-800',
};

export function DraftHeader({ draft }: { draft: DraftState }) {
  const [soundOn, setSoundOn] = useState(false);

  return (
    <div className="flex items-center justify-between border-b bg-background px-4 h-14 shrink-0">
      <div className="flex items-center gap-3">
        <Link to="/dashboard" className="text-lg font-bold text-primary">PM</Link>
        <span className="text-sm font-medium">{draft.contestName}</span>
        <Badge variant="outline" className={statusColors[draft.status]}>
          {draft.status}
        </Badge>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">
          Round {draft.currentRound}, Pick {draft.currentPickNumber} of {draft.totalPicks}
        </span>
        {draft.isMyPick && (
          <Badge className="bg-green-600 text-white animate-pulse">Your Pick!</Badge>
        )}
      </div>

      <div className="flex items-center gap-3">
        <DraftTimer deadline={draft.pickDeadline} isMyPick={draft.isMyPick} />
        <Button variant="ghost" size="icon" onClick={() => setSoundOn(!soundOn)}>
          {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => document.documentElement.requestFullscreen?.()}>
          <Maximize className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard"><LogOut className="h-4 w-4 mr-1" /> Leave</Link>
        </Button>
      </div>
    </div>
  );
}

function DraftTimer({ deadline, isMyPick }: { deadline: string | null; isMyPick: boolean }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!deadline) return;
    const update = () => {
      const diff = Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000));
      setSeconds(diff);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  if (!deadline) return <span className="text-sm text-muted-foreground">No timer</span>;

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const isWarning = seconds <= 10;

  return (
    <span
      className={`font-mono text-lg font-bold tabular-nums ${
        isWarning && isMyPick ? 'text-red-600 animate-pulse' : ''
      }`}
      aria-live="polite"
    >
      {mins}:{secs.toString().padStart(2, '0')}
    </span>
  );
}
