import type { ReactNode } from 'react';
import { Text } from '@/features/shared/ui';

/**
 * The dashed line standing in for a side of a game not known yet (#1579): "To be decided" in a
 * pick'em week, or the earlier game that fills it in a bracket. It is the height of a choice.
 */
export function EmptyPickSlot({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <Text as="div" className="flex h-9 items-center rounded-lg border border-dashed border-border px-3" data-testid={testId} variant="meta">
      {children}
    </Text>
  );
}
