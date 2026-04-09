import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { FeedPost } from './hooks/use-feed';

interface PollCardProps {
  poll: NonNullable<FeedPost['poll']>;
  onVote: (optionId: string) => void;
}

function formatTimeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d remaining`;
  if (hours >= 1) return `${hours}h remaining`;
  const minutes = Math.floor(diff / 60_000);
  return `${minutes}m remaining`;
}

export function PollCard({ poll, onVote }: PollCardProps) {
  const hasVoted = poll.userVoted !== null;
  const isExpired = new Date(poll.expiresAt).getTime() <= Date.now();
  const showResults = hasVoted || isExpired;

  return (
    <div className="mt-2 rounded-md border p-3 space-y-2">
      <p className="text-sm font-medium">{poll.question}</p>

      <div className="space-y-1.5">
        {poll.options.map((opt) => {
          const pct = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
          const isSelected = poll.userVoted === opt.id;

          if (showResults) {
            return (
              <div key={opt.id} className="relative overflow-hidden rounded-md border px-3 py-1.5">
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-md',
                    isSelected ? 'bg-primary/20' : 'bg-muted',
                  )}
                  style={{ width: `${pct}%` }}
                />
                <div className="relative flex items-center justify-between text-sm">
                  <span className={cn(isSelected && 'font-medium')}>{opt.text}</span>
                  <span className="text-xs text-muted-foreground">{pct}%</span>
                </div>
              </div>
            );
          }

          return (
            <Button
              key={opt.id}
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => onVote(opt.id)}
            >
              {opt.text}
            </Button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {poll.totalVotes} votes · {formatTimeRemaining(poll.expiresAt)}
      </p>
    </div>
  );
}
