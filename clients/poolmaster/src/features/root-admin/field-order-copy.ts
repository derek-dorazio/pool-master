import { FieldOrderBasis, fieldOrderDecision, type SportNoun } from '@poolmaster/shared/domain';
import type { EventFieldEntry } from './event-field-patch';

/** Each value as the order names it, and as a participant without it is said to lack it. */
const VALUE_WORD: Record<Exclude<FieldOrderBasis, typeof FieldOrderBasis.NAME>, { name: string; missing: string }> = {
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
  participant: SportNoun,
): string {
  const { basis, coversField } = fieldOrderDecision(field
    .filter((entry) => entry.isActive)
    .map((entry) => ({ oddsToWin: entry.oddsToWin, seedNumber: entry.seedNumber, ranking: entry.ranking, name: entry.participant.name })));
  if (basis === FieldOrderBasis.NAME) {
    return `Ordered by name (no ${participant.one} has odds, a seed or a rank).`;
  }
  const word = VALUE_WORD[basis];
  if (!coversField) {
    return `Ordered by ${word.name}, ${participant.many} without ${word.missing} last (no value is set for every ${participant.one}).`;
  }
  switch (basis) {
    case FieldOrderBasis.ODDS:
      return 'Ordered by odds, shortest first.';
    case FieldOrderBasis.SEED:
      return `Ordered by seed (not every ${participant.one} has odds).`;
    case FieldOrderBasis.RANKING:
      return `Ordered by rank (not every ${participant.one} has odds or a seed).`;
  }
}
