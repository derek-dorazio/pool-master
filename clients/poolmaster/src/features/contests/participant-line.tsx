import type { ReactNode } from 'react';
import { Text } from '@/features/shared/ui';

/**
 * A player, team or horse in a lineup (#1579): the name, and under it the team or affiliation
 * when there is one. `compact` is the smaller second line of a list or table row; `card` is the
 * tier field's larger one.
 */
export function ParticipantLine({
  affiliation,
  density = 'card',
  name,
  truncate = false,
}: {
  affiliation?: ReactNode;
  density?: 'card' | 'compact';
  name: ReactNode;
  truncate?: boolean;
}) {
  return (
    <>
      <Text as="div" tone="default" truncate={truncate} variant="strong">{name}</Text>
      {affiliation ? (
        <Text as="div" className="mt-1" size={density === 'compact' ? 'xs' : 'sm'} variant="meta">{affiliation}</Text>
      ) : null}
    </>
  );
}
