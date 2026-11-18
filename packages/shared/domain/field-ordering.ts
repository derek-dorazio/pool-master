/**
 * The one order an event's field is put in before it is tiered or priced (#1807): auto-assigned
 * tiers and auto-assigned prices both read it, so the two never disagree about who is best.
 *
 * The values, in precedence: odds to win (shortest first), then seed, then rank (both lowest
 * first). One value decides the order for the whole field, never row by row: the first value
 * every participant has. Only the values after it break ties, then the name. A value only some
 * participants have never lets them jump ahead of the rest, which is what mixing row by row would
 * do with partial data. When no value covers the whole field, the first value anyone has decides,
 * those without it last; with none at all, the field is in name order.
 */
export const FieldOrderBasis = {
  ODDS: 'ODDS',
  SEED: 'SEED',
  RANKING: 'RANKING',
  NAME: 'NAME',
} as const;
export type FieldOrderBasis = (typeof FieldOrderBasis)[keyof typeof FieldOrderBasis];

/** A field entry as the ordering reads it. */
export interface OrderableFieldEntry {
  oddsToWin?: number | null;
  seedNumber?: number | null;
  ranking?: number | null;
  name: string;
}

/** The value that decides a field's order, and whether every participant has it. */
export interface FieldOrderDecision {
  basis: FieldOrderBasis;
  /** False when no value covers the whole field and `basis` is the first one anyone has. */
  coversField: boolean;
}

type ValueBasis = Exclude<FieldOrderBasis, typeof FieldOrderBasis.NAME>;

const PRECEDENCE: ReadonlyArray<readonly [ValueBasis, (entry: OrderableFieldEntry) => number | null | undefined]> = [
  [FieldOrderBasis.ODDS, (entry) => entry.oddsToWin],
  [FieldOrderBasis.SEED, (entry) => entry.seedNumber],
  [FieldOrderBasis.RANKING, (entry) => entry.ranking],
];

/** Which value decides the order of `field` (its active participants). */
export function fieldOrderDecision(field: readonly OrderableFieldEntry[]): FieldOrderDecision {
  const covering = field.length === 0 ? undefined : PRECEDENCE.find(([, read]) => field.every((entry) => read(entry) != null));
  if (covering) return { basis: covering[0], coversField: true };
  const partial = PRECEDENCE.find(([, read]) => field.some((entry) => read(entry) != null));
  return partial ? { basis: partial[0], coversField: false } : { basis: FieldOrderBasis.NAME, coversField: true };
}

/** `field` best first, by `fieldOrderDecision`'s value, then each later value, then name; a full tie keeps the given order. */
export function orderField<Entry extends OrderableFieldEntry>(field: readonly Entry[]): { ordered: Entry[]; decision: FieldOrderDecision } {
  const decision = fieldOrderDecision(field);
  const from = PRECEDENCE.findIndex(([basis]) => basis === decision.basis);
  const reads = from === -1 ? [] : PRECEDENCE.slice(from).map(([, read]) => read);
  const ordered = [...field].sort((left, right) => {
    for (const read of reads) {
      const byValue = compareNullsLast(read(left), read(right));
      if (byValue !== 0) return byValue;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
  return { ordered, decision };
}

/** Ascending, with a missing number after every present one; two missing numbers tie. */
export function compareNullsLast(left: number | null | undefined, right: number | null | undefined): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}
