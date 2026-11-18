/**
 * The natural order of a shared enum, declared on the enum itself in `enums.ts` (#1841), so
 * every list, grid and sort shows its values the same way and no consumer keeps an order of
 * its own (`rules/domain-model-conventions-rules.md`).
 *
 * An order is one of two kinds:
 * - `explicit`: a position for every value. The map is exhaustive over the enum, so adding a
 *   value without a place fails the type check.
 * - `alphabetical`: the enum has no natural order; its values sort A to Z by the words the
 *   screen shows for them, which the web app passes in (labels are product copy, UI only).
 */
export type ExplicitEnumOrder<V extends string> = {
  readonly kind: 'explicit';
  readonly orderIndex: Readonly<Record<V, number>>;
};
export type AlphabeticalEnumOrder = { readonly kind: 'alphabetical' };
// `V` only types the values an alphabetical order is used with.
export type EnumOrder<V extends string> = ExplicitEnumOrder<V> | AlphabeticalEnumOrder;

/** An order giving every value its place; lower comes first. */
export function explicitOrder<V extends string>(orderIndex: Readonly<Record<V, number>>): ExplicitEnumOrder<V> {
  return { kind: 'explicit', orderIndex };
}

/** An enum with no natural order: A to Z by the label each screen shows. */
export function alphabeticalOrder(): AlphabeticalEnumOrder {
  return { kind: 'alphabetical' };
}

/**
 * Compares two values of an enum by its declared order. An alphabetical order compares the
 * labels (`label`, else the values themselves), ignoring case and accents.
 */
export function compareByEnumOrder<V extends string>(
  order: EnumOrder<V>,
  label: (value: V) => string = (value) => value,
): (left: V, right: V) => number {
  if (order.kind === 'explicit') {
    return (left, right) => order.orderIndex[left] - order.orderIndex[right];
  }
  return (left, right) => label(left).localeCompare(label(right), undefined, { sensitivity: 'base' });
}

/** The values, sorted by the enum's order: a new array, the given one untouched. */
export function sortByEnumOrder<V extends string>(
  values: readonly V[],
  order: EnumOrder<V>,
  label?: (value: V) => string,
): V[] {
  return [...values].sort(compareByEnumOrder(order, label));
}

/** An explicit order's values, first to last. */
export function explicitOrderValues<V extends string>(order: ExplicitEnumOrder<V>): V[] {
  return (Object.keys(order.orderIndex) as V[]).sort((left, right) => order.orderIndex[left] - order.orderIndex[right]);
}
