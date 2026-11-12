import type { ReactNode } from 'react';
import { cn, Text } from '@/features/shared/ui';

/**
 * One game of a pick'em week or a bracket (#1579): a bordered box, a caption line naming the
 * game (its kickoff, or "Game 3") with its markers at the right, and the game's choices under it.
 * `compact` is the bracket's tighter box, which sits four to a row.
 */
export function GameCard({
  aside,
  children,
  density = 'roomy',
  label,
  testId,
}: {
  /** Markers at the right of the caption line: a tiebreaker chip, a lock, the pick's outcome. */
  aside?: ReactNode;
  children: ReactNode;
  density?: 'compact' | 'roomy';
  /** The caption line's left side. */
  label: ReactNode;
  testId: string;
}) {
  return (
    <li
      className={cn('rounded-lg border border-border bg-background', density === 'compact' ? 'space-y-2 p-3' : 'space-y-3 p-4')}
      data-testid={testId}
    >
      <Text as="div" className="flex flex-wrap items-center justify-between gap-2" variant="caption">
        {label}
        {aside ? <span className="flex flex-wrap items-center gap-2">{aside}</span> : null}
      </Text>
      {children}
    </li>
  );
}
