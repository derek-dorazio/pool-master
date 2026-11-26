import { FieldOrderBasis } from './enums';

/**
 * The one order an event's field is put in before it is tiered or priced (#1807): auto-assigned
 * tiers and auto-assigned prices both read it, so the two never disagree about who is best.
 *
 * The values come from the profile doing the ordering, in its own order (#2160: a tier or pricing
 * profile's source list, such as ODDS, SEED, RANKING, or SEED alone). One value decides the order
 * for the whole field, never row by row: the first listed value every participant has. Only the
 * listed values after it break ties, then the name. A value only some participants have never lets
 * them jump ahead of the rest, which is what mixing row by row would do with partial data. When no
 * listed value covers the whole field, the first listed value anyone has decides, those without it
 * last. With none at all there is no order (#2040): a name orders nothing
 * (`rules/domain-model-conventions-rules.md` §17), so such a field is never tiered or priced
 * automatically.
 */

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
  /** False when no listed value covers the whole field and `basis` is the first one anyone has. */
  coversField: boolean;
}

/** An entry's value of one basis, lower is better; null or undefined when it has none. */
export function fieldOrderValue(entry: OrderableFieldEntry, basis: FieldOrderBasis): number | null | undefined {
  switch (basis) {
    case FieldOrderBasis.ODDS: return entry.oddsToWin;
    case FieldOrderBasis.SEED: return entry.seedNumber;
    case FieldOrderBasis.RANKING: return entry.ranking;
  }
}

/** Which of `sources` decides the order of `field` (its active participants); null when no one has any of them. */
export function fieldOrderDecision(field: readonly OrderableFieldEntry[], sources: readonly FieldOrderBasis[]): FieldOrderDecision | null {
  const covering = field.length === 0 ? undefined : sources.find((basis) => field.every((entry) => fieldOrderValue(entry, basis) != null));
  if (covering) return { basis: covering, coversField: true };
  const partial = sources.find((basis) => field.some((entry) => fieldOrderValue(entry, basis) != null));
  return partial ? { basis: partial, coversField: false } : null;
}

/**
 * `field` best first, by `fieldOrderDecision`'s value, then each later listed value, then name; a
 * full tie keeps the given order. Null when no participant has any of `sources`: the field has no order.
 */
export function orderField<Entry extends OrderableFieldEntry>(
  field: readonly Entry[],
  sources: readonly FieldOrderBasis[],
): { ordered: Entry[]; decision: FieldOrderDecision } | null {
  const decision = fieldOrderDecision(field, sources);
  if (decision === null) return null;
  const tieBreakers = sources.slice(sources.indexOf(decision.basis));
  const ordered = [...field].sort((left, right) => {
    for (const basis of tieBreakers) {
      const byValue = compareNullsLast(fieldOrderValue(left, basis), fieldOrderValue(right, basis));
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
