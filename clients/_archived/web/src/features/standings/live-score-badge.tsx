import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface LiveScoreBadgeProps {
  score: number;
  className?: string;
}

/**
 * Displays a score value with a brief pulse animation when the value changes.
 * Respects prefers-reduced-motion.
 */
export function LiveScoreBadge({ score, className }: LiveScoreBadgeProps) {
  const [flash, setFlash] = useState(false);
  const prevScore = useRef(score);

  useEffect(() => {
    if (score !== prevScore.current) {
      prevScore.current = score;
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [score]);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 font-mono font-medium tabular-nums transition-colors',
        flash && 'animate-pulse bg-primary/20 text-primary motion-reduce:animate-none',
        !flash && 'bg-transparent',
        className,
      )}
      aria-live="polite"
    >
      {score}
    </span>
  );
}
