import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, cn } from '@/features/shared/ui';

/**
 * One choice on a pick screen (#1278): a team in a pick'em, survivor or bracket game, or a pick'em
 * game's tie. Pressed and marked "Your pick" once it is the entry's pick; tapping it again does
 * nothing, since the other side is how a pick changes. A survivor team the entry used in another
 * week says Used and cannot be picked.
 */
export function PickOption({
  children,
  isBusy,
  isPicked,
  isUsed = false,
  onPick,
  testId,
}: {
  /** What the choice is: the team's name, with its spread when the pool has one, or "Tie". */
  children: ReactNode;
  /** A pick is saving, so no other can start. */
  isBusy: boolean;
  isPicked: boolean;
  /** A survivor entry picked the team in another week, so cannot pick it again. */
  isUsed?: boolean;
  onPick: () => void;
  testId: string;
}) {
  return (
    <Button
      aria-pressed={isPicked}
      className="justify-between"
      data-testid={testId}
      data-used={isUsed || undefined}
      disabled={isBusy || isUsed}
      layout="row"
      onClick={() => {
        if (!isPicked) {
          onPick();
        }
      }}
      size="sm"
      variant={isPicked ? 'subtle' : 'secondary'}
    >
      {children}
      {isPicked ? <Check aria-label="Your pick" size={16} /> : null}
      {isUsed && !isPicked ? <span className="text-xs text-muted-foreground">Used</span> : null}
    </Button>
  );
}

/**
 * A choice once picks are locked: the same line as `PickOption`, no longer a button, marked
 * "Picked" when it was the entry's pick.
 */
export function PickedLine({ children, isPicked, testId }: { children: ReactNode; isPicked: boolean; testId: string }) {
  return (
    <div
      className={cn(
        'flex h-9 items-center justify-between gap-2 rounded-2xl border px-3 text-sm',
        isPicked ? 'border-primary/30 bg-primary/10 font-semibold' : 'border-border text-muted-foreground',
      )}
      data-picked={isPicked || undefined}
      data-testid={testId}
    >
      {children}
      {isPicked ? <Check aria-label="Picked" size={16} /> : null}
    </div>
  );
}
