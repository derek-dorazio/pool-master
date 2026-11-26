import { displayString } from '@poolmaster/shared/display-strings';
import type { FieldOrderBasis } from '@poolmaster/shared/domain';
import type { SportEventOverviewDto } from '@/lib/api';
import { formatOrList } from '@/features/shared/ui';

type FieldOrderFacts = Pick<SportEventOverviewDto, 'tierOrderBasis' | 'tierOrderCoversField' | 'tierOrderSources'>;

/** Each source's words: what it is, what a participant lacks without it, and the order it gives. */
const SOURCE_WORDS = {
  ODDS: { source: 'word.fieldOrderSourceODDS', missing: 'word.fieldOrderMissingODDS', orderedBy: 'word.fieldOrderedByODDS' },
  SEED: { source: 'word.fieldOrderSourceSEED', missing: 'word.fieldOrderMissingSEED', orderedBy: 'word.fieldOrderedBySEED' },
  RANKING: { source: 'word.fieldOrderSourceRANKING', missing: 'word.fieldOrderMissingRANKING', orderedBy: 'word.fieldOrderedByRANKING' },
} as const satisfies Record<FieldOrderBasis, { source: string; missing: string; orderedBy: string }>;

/** "odds or a seed": the sources a participant can lack, joined as the reader's language joins a choice. */
function anyOf(sources: readonly FieldOrderBasis[]): string {
  const words = sources.map((source) => displayString(SOURCE_WORDS[source].missing));
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
      source: displayString(SOURCE_WORDS[basis].source),
      missing: displayString(SOURCE_WORDS[basis].missing),
    });
  }
  const order = displayString(SOURCE_WORDS[basis].orderedBy);
  // A later source decided only because none before it covers the whole field.
  const earlier = sources.slice(0, Math.max(0, sources.indexOf(basis)));
  return earlier.length === 0
    ? displayString('word.fieldOrderCovered', { order })
    : displayString('word.fieldOrderAfterEarlier', { order, sources: anyOf(earlier) });
}
