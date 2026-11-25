import { displayString } from '@poolmaster/shared/display-strings';
import type { FieldOrderBasis } from '@poolmaster/shared/domain';
import type { SportEventOverviewDto } from '@/lib/api';
import { formatOrList } from '@/features/shared/ui';

type FieldOrderFacts = Pick<SportEventOverviewDto, 'tierOrderBasis' | 'tierOrderCoversField' | 'tierOrderSources'>;

/** "odds or a seed": the sources a participant can lack, joined as the reader's language joins a choice. */
function anyOf(sources: readonly FieldOrderBasis[]): string {
  const words = sources.map((source) => displayString(`word.fieldOrderMissing${source}`));
  return formatOrList(words);
}

/**
 * Which value auto-assigned tiers and prices put this field in order by (#1807, #2160), as the
 * event's overview says the server decided it from the league's profile's sources. Said in the
 * auto-assign dialogs, so the admin knows which value the field needs before replacing anything.
 */
export function describeFieldOrder(overview: FieldOrderFacts | undefined, hasActiveField: boolean): string {
  if (!hasActiveField) return displayString('word.fieldOrderNoField');
  if (overview === undefined) return '…';
  const { tierOrderBasis: basis, tierOrderCoversField, tierOrderSources: sources } = overview;
  if (basis === null) return displayString('word.fieldOrderNone', { sources: anyOf(sources) });
  if (!tierOrderCoversField) {
    return displayString('word.fieldOrderPartial', {
      source: displayString(`word.fieldOrderSource${basis}`),
      missing: displayString(`word.fieldOrderMissing${basis}`),
    });
  }
  const order = displayString(`word.fieldOrderedBy${basis}`);
  // A later source decided only because none before it covers the whole field.
  const earlier = sources.slice(0, Math.max(0, sources.indexOf(basis)));
  return earlier.length === 0
    ? displayString('word.fieldOrderCovered', { order })
    : displayString('word.fieldOrderAfterEarlier', { order, sources: anyOf(earlier) });
}
