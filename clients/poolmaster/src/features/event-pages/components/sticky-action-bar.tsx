import type { ReactNode, RefObject } from 'react';
import { useScrolledPast } from './use-scrolled-past';

/**
 * The slim bar a phone keeps at the bottom once `watch`, the hero's own button, has scrolled
 * away. Wider screens never show it. Leave room under the page for it (`pb-20 md:pb-0`).
 */
export function StickyActionBar({ children, testId, watch }: {
  children: ReactNode;
  testId: string;
  watch: RefObject<HTMLElement | null>;
}) {
  const isPast = useScrolledPast(watch);
  if (!isPast) {
    return null;
  }
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-3 md:hidden" data-testid={testId}>
      {children}
    </div>
  );
}
