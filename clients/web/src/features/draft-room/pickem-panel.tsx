import { useState } from 'react';
import { Clock, Check, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface PickEmEvent {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeRecord?: string;
  awayRecord?: string;
  eventTime: string;
  deadline: string;
  isLocked: boolean;
  myPick?: 'home' | 'away';
  confidencePoints?: number;
}

interface PickEmPanelProps {
  events: PickEmEvent[];
  useConfidence: boolean;
  totalPicks: number;
  madePicks: number;
  onPick: (eventId: string, side: 'home' | 'away') => void;
  onConfidence: (eventId: string, points: number) => void;
}

export function PickEmPanel({ events, useConfidence, totalPicks, madePicks, onPick, onConfidence }: PickEmPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="text-sm font-semibold">Pick Your Winners</h3>
        <Badge variant="outline">
          {madePicks} / {totalPicks} picks
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto divide-y">
        {events.map((event) => (
          <PickEmRow
            key={event.id}
            event={event}
            useConfidence={useConfidence}
            onPick={(side) => onPick(event.id, side)}
            onConfidence={(pts) => onConfidence(event.id, pts)}
          />
        ))}
      </div>
    </div>
  );
}

function PickEmRow({
  event,
  useConfidence,
  onPick,
  onConfidence,
}: {
  event: PickEmEvent;
  useConfidence: boolean;
  onPick: (side: 'home' | 'away') => void;
  onConfidence: (points: number) => void;
}) {
  const isPastDeadline = new Date(event.deadline) < new Date();
  const isLocked = event.isLocked || isPastDeadline;

  return (
    <div className={cn('px-4 py-3', isLocked && 'opacity-60')}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">
          {new Date(event.eventTime).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </span>
        {isLocked ? (
          <Badge variant="outline" className="text-xs gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
        ) : (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Lock: {new Date(event.deadline).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Away team */}
        <button
          onClick={() => !isLocked && onPick('away')}
          disabled={isLocked}
          className={cn(
            'flex-1 rounded-md border p-3 text-center transition-colors',
            event.myPick === 'away'
              ? 'border-primary bg-primary/10 ring-2 ring-primary'
              : 'hover:bg-accent',
            isLocked && 'cursor-not-allowed',
          )}
        >
          <p className="font-medium text-sm">{event.awayTeam}</p>
          {event.awayRecord && <p className="text-xs text-muted-foreground">{event.awayRecord}</p>}
          {event.myPick === 'away' && <Check className="h-4 w-4 text-primary mx-auto mt-1" />}
        </button>

        <span className="text-xs text-muted-foreground font-medium">@</span>

        {/* Home team */}
        <button
          onClick={() => !isLocked && onPick('home')}
          disabled={isLocked}
          className={cn(
            'flex-1 rounded-md border p-3 text-center transition-colors',
            event.myPick === 'home'
              ? 'border-primary bg-primary/10 ring-2 ring-primary'
              : 'hover:bg-accent',
            isLocked && 'cursor-not-allowed',
          )}
        >
          <p className="font-medium text-sm">{event.homeTeam}</p>
          {event.homeRecord && <p className="text-xs text-muted-foreground">{event.homeRecord}</p>}
          {event.myPick === 'home' && <Check className="h-4 w-4 text-primary mx-auto mt-1" />}
        </button>

        {/* Confidence points */}
        {useConfidence && !isLocked && event.myPick && (
          <div className="w-16 shrink-0">
            <Input
              type="number"
              min={1}
              placeholder="Pts"
              value={event.confidencePoints ?? ''}
              onChange={(e) => onConfidence(parseInt(e.target.value) || 0)}
              className="h-8 text-xs text-center"
            />
          </div>
        )}
      </div>
    </div>
  );
}
