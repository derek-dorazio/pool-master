import type { ReactNode, RefObject } from 'react';
import { useScrolledPast } from './use-scrolled-past';

/**
 * The slim bar a phone keeps at the bottom while `watch`, the full block it stands in for, is out
 * of view: an event page's hero button once it has scrolled away, or a pick page's submit section
 * until it scrolls into view. Wider screens never show it. A page whose watched block is above
 * the end of the page leaves room under it for the bar (`pb-20 md:pb-0`).
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
