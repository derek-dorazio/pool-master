import { cn } from '@/lib/utils';
import type { Reaction } from './hooks/use-feed';

const availableEmojis = ['👍', '🔥', '😂', '😢', '🏆'];

interface ReactionBarProps {
  reactions: Reaction[];
  onToggle: (emoji: string) => void;
}

export function ReactionBar({ reactions, onToggle }: ReactionBarProps) {
  const reactionMap = new Map(reactions.map((r) => [r.emoji, r]));

  return (
    <div className="flex flex-wrap gap-1">
      {availableEmojis.map((emoji) => {
        const reaction = reactionMap.get(emoji);
        const count = reaction?.count ?? 0;
        const reacted = reaction?.reacted ?? false;

        if (count === 0 && !reacted) {
          return (
            <button
              key={emoji}
              onClick={() => onToggle(emoji)}
              className="rounded-full px-1.5 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent"
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          );
        }

        return (
          <button
            key={emoji}
            onClick={() => onToggle(emoji)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors',
              reacted
                ? 'bg-primary/10 text-primary font-medium'
                : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
            aria-label={`${emoji} ${count}${reacted ? ', you reacted' : ''}`}
          >
            {emoji} {count}
          </button>
        );
      })}
    </div>
  );
}
