/**
 * The one order an event's field is put in before it is tiered or priced (#1807): auto-assigned
 * tiers and auto-assigned prices both read it, so the two never disagree about who is best.
 *
 * The values, in precedence: odds to win (shortest first), then seed, then rank (both lowest
 * first). One value decides the order for the whole field, never row by row: the first value
 * every participant has. Only the values after it break ties, then the name. A value only some
 * participants have never lets them jump ahead of the rest, which is what mixing row by row would
 * do with partial data. When no value covers the whole field, the first value anyone has decides,
 * those without it last. With none at all there is no order (#2040): a name orders nothing
 * (`rules/domain-model-conventions-rules.md` §17), so such a field is never tiered or priced
 * automatically.
 */
export const FieldOrderBasis = {
  ODDS: 'ODDS',
  SEED: 'SEED',
  RANKING: 'RANKING',
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

const PRECEDENCE: ReadonlyArray<readonly [FieldOrderBasis, (entry: OrderableFieldEntry) => number | null | undefined]> = [
  [FieldOrderBasis.ODDS, (entry) => entry.oddsToWin],
  [FieldOrderBasis.SEED, (entry) => entry.seedNumber],
  [FieldOrderBasis.RANKING, (entry) => entry.ranking],
];

/** Which value decides the order of `field` (its active participants); null when no one has any. */
export function fieldOrderDecision(field: readonly OrderableFieldEntry[]): FieldOrderDecision | null {
  const covering = field.length === 0 ? undefined : PRECEDENCE.find(([, read]) => field.every((entry) => read(entry) != null));
  if (covering) return { basis: covering[0], coversField: true };
  const partial = PRECEDENCE.find(([, read]) => field.some((entry) => read(entry) != null));
  return partial ? { basis: partial[0], coversField: false } : null;
}

/**
 * `field` best first, by `fieldOrderDecision`'s value, then each later value, then name; a full tie
 * keeps the given order. Null when no participant has any of the values: the field has no order.
 */
export function orderField<Entry extends OrderableFieldEntry>(field: readonly Entry[]): { ordered: Entry[]; decision: FieldOrderDecision } | null {
  const decision = fieldOrderDecision(field);
  if (decision === null) return null;
  const from = PRECEDENCE.findIndex(([basis]) => basis === decision.basis);
  const reads = PRECEDENCE.slice(from).map(([, read]) => read);
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
