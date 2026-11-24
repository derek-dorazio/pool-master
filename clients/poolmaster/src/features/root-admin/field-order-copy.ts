import { FieldOrderBasis, fieldOrderDecision } from '@poolmaster/shared/domain';
import type { EventFieldEntry } from './event-field-patch';

/** Each value as the order names it, and as a participant without it is said to lack it. */
const VALUE_WORD: Record<FieldOrderBasis, { name: string; missing: string }> = {
  [FieldOrderBasis.ODDS]: { name: 'odds', missing: 'odds' },
  [FieldOrderBasis.SEED]: { name: 'seed', missing: 'a seed' },
  [FieldOrderBasis.RANKING]: { name: 'rank', missing: 'a rank' },
};

/**
 * Which value auto-assigned tiers and prices put this field in order by (#1807), as the server
 * will: the same `fieldOrderDecision` over the active field. Said in the auto-assign dialogs, so
 * the admin knows which value the field needs before replacing anything.
 */
export function describeFieldOrder(
  field: readonly Pick<EventFieldEntry, 'isActive' | 'oddsToWin' | 'seedNumber' | 'ranking' | 'participant'>[],
): string {
  const decision = fieldOrderDecision(field
    .filter((entry) => entry.isActive)
    .map((entry) => ({ oddsToWin: entry.oddsToWin, seedNumber: entry.seedNumber, ranking: entry.ranking, name: entry.participant.name })));
  if (decision === null) {
    return 'Not ordered: no participant has odds, a seed or a rank, so nothing is assigned.';
  }
  const { basis, coversField } = decision;
  const word = VALUE_WORD[basis];
  if (!coversField) {
    return `Ordered by ${word.name}, participants without ${word.missing} last (no value is set for every participant).`;
  }
  switch (basis) {
    case FieldOrderBasis.ODDS:
      return 'Ordered by odds, shortest first.';
    case FieldOrderBasis.SEED:
      return `Ordered by seed (not every participant has odds).`;
    case FieldOrderBasis.RANKING:
      return `Ordered by rank (not every participant has odds or a seed).`;
  }
}
